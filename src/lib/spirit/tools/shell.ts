/**
 * run_shell 工具：让器灵在服务器本地执行 shell 命令
 *
 * 安全分级：
 *   safe        — 只读命令（ls/cat/git status 等），直接执行
 *   moderate    — 有副作用但可恢复（npm install/git commit 等），首次需用户批准
 *   destructive — 破坏性（rm -rf/sudo/kill 等），每次都需用户批准
 *
 * 安全机制：
 *   - 不存在 confirmed: true 旁路——批准必须走 /api/spirit/approve 接口
 *   - 令牌由服务端生成，一次性使用，绑定具体命令（AI 无法伪造或复用）
 *   - 令牌 5 分钟过期
 */

import { exec }          from 'child_process'
import { promisify }     from 'util'
import { registerTool }  from '../registry'
import {
  createApprovalToken,
  consumeToken,
  isSessionModerateAllowed,
} from '../shell-permissions'

const execAsync = promisify(exec)

// ── 命令安全分级 ────────────────────────────────────────────────

const DESTRUCTIVE = [
  /\brm\s+-[a-z]*[rf][a-z]*/i,
  /\brm\s+.*\*/,
  /\bsudo\b/,
  /\b(kill|killall|pkill)\s/,
  /\b(chmod|chown)\s/,
  /\b(dd|mkfs|shred|truncate)\s/,
  /\b(shutdown|reboot|halt|poweroff)\b/,
  />\s*\/dev\/(sd|hd|nvme)/,
  /\bgit\s+reset\s+--hard\b/,
  /\bgit\s+clean\s+-[a-z]*f/,
  /\bgit\s+push\s+.*--force\b/,
]

const SAFE = [
  /^\s*(ls|ll|la)\b/,
  /^\s*(cat|head|tail|less|more|tac)\b/,
  /^\s*(echo|printf|pwd|whoami|date|which|type|env|printenv|uname)\b/,
  /^\s*(grep|egrep|fgrep|rg|ag)\s/,
  /^\s*find\b(?!.*-exec.*rm)/,
  /^\s*git\s+(status|log|diff|branch|remote|show|describe|tag|stash list|fetch --dry-run)\b/,
  /^\s*(node|npm|yarn|pnpm|python|python3|ruby|go|java|rustc|tsc)\s+(--version|-v)\b/,
  /^\s*npm\s+(list|ls|outdated|audit)\b/,
  /^\s*(wc|sort|uniq|awk|sed|cut|tr|jq)\s/,
  /^\s*curl\s+(?!.*\s-[a-zA-Z]*o)(?!.*>)/,
  /^\s*(stat|file|du|df)\s/,
  /^\s*(ps|top|htop)\s/,
]

function classifyCommand(cmd: string): 'safe' | 'moderate' | 'destructive' {
  const t = cmd.trim()
  if (DESTRUCTIVE.some(re => re.test(t))) return 'destructive'
  if (SAFE.some(re => re.test(t)))        return 'safe'
  return 'moderate'
}

// ── 工具注册 ────────────────────────────────────────────────────

registerTool({
  name:        'run_shell',
  description: `在服务器本地执行 shell 命令。

安全分级：
- 安全命令（ls/cat/git status/grep 等只读）：直接执行
- 中等风险（npm install/git commit/mkdir 等）：首次返回权限请求，UI 弹确认按钮
- 高危命令（rm -rf/sudo/kill 等）：每次都需要确认

权限流程：
1. 工具返回权限请求（含一次性令牌）
2. 用户在 UI 点击确认按钮（调用服务端 approve 接口，令牌被批准）
3. 用下相同命令 + approval_token 重新调用此工具执行

注意：workdir 必须每次指定绝对路径；approval_token 来自工具上一次返回的令牌，不能自行构造。`,
  parameters: {
    type: 'object',
    properties: {
      command: {
        type:        'string',
        description: '要执行的 shell 命令',
      },
      workdir: {
        type:        'string',
        description: '工作目录绝对路径（必须明确指定）',
      },
      approval_token: {
        type:        'string',
        description: '用户批准后服务端颁发的一次性令牌（来自上次权限请求的返回值）',
      },
      session_allow: {
        type:        'boolean',
        description: '（保留参数，由 approve 接口设置，工具侧忽略此参数）',
      },
    },
    required: ['command'],
  },
}, async ({ command, workdir, approval_token }) => {
  const cmd   = (command as string).trim()
  const wdir  = (workdir as string | undefined) ?? ''
  const token = approval_token as string | undefined

  const safety = classifyCommand(cmd)

  // ── 令牌路径：AI 携带令牌，验证后执行 ────────────────────────
  if (token) {
    const valid = consumeToken(token, cmd)
    if (!valid) {
      return {
        content: '令牌无效、已过期或命令与批准时不一致，请重新发起权限请求。',
        brief:   '令牌验证失败',
      }
    }
    // 令牌有效，直接执行
    return executeCommand(cmd, wdir)
  }

  // ── 无令牌路径：判断是否需要权限 ─────────────────────────────
  const canRunDirectly = safety === 'safe'
    || (safety === 'moderate' && isSessionModerateAllowed())

  if (canRunDirectly) {
    return executeCommand(cmd, wdir)
  }

  // 需要用户确认 → 生成令牌
  const newToken = createApprovalToken({ command: cmd, workdir: wdir, level: safety })
  return {
    content: `PERMISSION_REQUIRED::${newToken}::${safety}::${cmd}::${wdir}`,
    brief:   '等待确认',
  }
}, { displayName: '执行 Shell' })

// ── 实际执行（抽取为函数，令牌验证和直接执行共用） ──────────────

async function executeCommand(cmd: string, wdir: string) {
  try {
    const { stdout, stderr } = await execAsync(cmd, {
      cwd:       wdir || undefined,
      timeout:   30_000,
      maxBuffer: 100 * 1024,
      shell:     '/bin/zsh',
    })
    const out = [stdout, stderr].filter(Boolean).join('\n').trim()
    const truncated = out.length > 8000
      ? out.slice(0, 8000) + `\n\n[输出过长，已截断（原始 ${out.length} 字符）]`
      : out
    return {
      content: truncated || '（命令执行成功，无输出）',
      brief:   `✓ ${cmd}`,
    }
  } catch (err: unknown) {
    const e = err as { code?: number; killed?: boolean; stdout?: string; stderr?: string; message?: string }
    if (e.killed) return { content: `命令超时（30s）：\n${cmd}`, brief: '超时' }
    const errOut = [e.stdout, e.stderr, e.message].filter(Boolean).join('\n').trim()
    return {
      content: `退出码 ${e.code ?? '?'}：\n${errOut.slice(0, 4000)}`,
      brief:   `退出码 ${e.code ?? '?'}`,
    }
  }
}
