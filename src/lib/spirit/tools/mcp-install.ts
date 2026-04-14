/**
 * install_mcp 工具：让器灵能自主安装 MCP 服务器
 *
 * 接受两种输入：
 *   1. npm 包名字符串（如 "@modelcontextprotocol/server-brave-search"）
 *   2. 完整的 MCPServerConfig JSON（含 command/args/env）
 *
 * 若 env 中存在占位值（中文描述、your_xxx 等），返回提示要求用户补全；
 * 否则直接调用 addMCPServerRuntime 载入并注册工具。
 */

import { registerTool }            from '../registry'
import { addMCPServerRuntime }     from '../mcp-loader'
import { invalidateAgentCache }    from '../langgraph/agents'
import { invalidateToolCache }     from '../langgraph/tools'
import { invalidateGraphCache }    from '../langgraph/graph'
import config                      from '../../../../codelife.config'
import type { MCPServerConfig }    from '@/lib/config'

// ── 占位值检测 ────────────────────────────────────────────────────────────────

/**
 * 判断一个 env value 是否是占位符（用户尚未填写真实值）。
 * 匹配：
 *   - 含中文字符（如"你的用户名"、"请填入"）
 *   - 以 your_ 开头（如 your_api_key）
 *   - 全大写下划线占位（如 YOUR_API_KEY、REPLACE_ME）
 *   - 空字符串
 */
function isPlaceholder(value: string): boolean {
  if (!value || value.trim() === '') return true
  if (/[\u4e00-\u9fff]/.test(value)) return true          // 含中文
  if (/^your[_-]/i.test(value)) return true               // your_xxx
  if (/^(REPLACE|FILL|INSERT|TODO|PLACEHOLDER|YOUR)[-_]/i.test(value)) return true
  if (/^<.+>$/.test(value.trim())) return true            // <placeholder>
  return false
}

function detectPlaceholders(env?: Record<string, string>): string[] {
  if (!env) return []
  return Object.entries(env)
    .filter(([, v]) => isPlaceholder(v))
    .map(([k]) => k)
}

// ── 从包名构造最简 MCPServerConfig ────────────────────────────────────────────

function packageNameToConfig(pkg: string): MCPServerConfig {
  const name = pkg.split('/').pop()?.replace(/^server-/, '') ?? pkg
  return {
    name,
    transport: 'stdio',
    command:   'npx',
    args:      ['-y', pkg],
  }
}

// ── 工具注册 ──────────────────────────────────────────────────────────────────

registerTool({
  name:        'install_mcp',
  description: `安装并载入一个 MCP 服务器，让器灵获得新工具。
接受两种格式：
  1. npm 包名字符串，如 "@modelcontextprotocol/server-brave-search"
  2. 完整配置对象（JSON），含 name / command / args / env 等字段

若 env 中有未填写的占位值，工具会列出缺失的字段并要求用户补全，不执行安装。
安装成功后立即可用，无需重启。`,
  parameters: {
    type: 'object',
    properties: {
      config: {
        description: 'npm 包名（字符串），或包含 name/command/args/env 的 MCPServerConfig JSON 对象',
      },
      name: {
        type:        'string',
        description: '服务器展示名（config 传包名时可选，用于覆盖自动生成的名称）',
      },
    },
    required: ['config'],
  },
}, async ({ config: cfgInput, name: overrideName }) => {
  if (!config.spirit?.allowDynamicInstall) {
    return {
      content: '当前配置未开启动态安装（allowDynamicInstall: false）。请在 codelife.config.ts 中将其设为 true 后重试。',
      brief:   '未授权',
    }
  }

  // ── 解析输入 ─────────────────────────────────────────────────────────────
  let serverCfg: MCPServerConfig

  if (typeof cfgInput === 'string') {
    // 尝试解析为 JSON；若失败则视为包名
    try {
      const parsed = JSON.parse(cfgInput)
      serverCfg = parsed as MCPServerConfig
    } catch {
      serverCfg = packageNameToConfig(cfgInput.trim())
    }
  } else if (typeof cfgInput === 'object' && cfgInput !== null) {
    serverCfg = cfgInput as MCPServerConfig
  } else {
    return { content: 'config 参数格式无法识别，请传入包名字符串或 MCPServerConfig JSON。', brief: '参数错误' }
  }

  // 覆盖名称（可选）
  if (overrideName) serverCfg = { ...serverCfg, name: overrideName as string }

  // ── 必填字段校验 ─────────────────────────────────────────────────────────
  if (!serverCfg.name) {
    return { content: '缺少 name 字段，请提供服务器展示名。', brief: '参数缺失' }
  }
  if (serverCfg.transport === 'http' && !serverCfg.url) {
    return { content: 'HTTP transport 缺少 url 字段。', brief: '参数缺失' }
  }
  if (serverCfg.transport !== 'http' && !serverCfg.command) {
    return { content: 'stdio transport 缺少 command 字段。', brief: '参数缺失' }
  }

  // ── 占位值检测 ───────────────────────────────────────────────────────────
  const missing = detectPlaceholders(serverCfg.env)
  if (missing.length > 0) {
    const lines = missing.map(k => `  - ${k}`).join('\n')
    return {
      content: `以下环境变量尚未填写真实值，请提供后重试：\n${lines}\n\n示例：再次调用时传入补全后的 config，或告诉我各字段的值，我来帮你组装。`,
      brief:   `需要补全 ${missing.length} 个环境变量`,
    }
  }

  // ── 安装 ─────────────────────────────────────────────────────────────────
  // 确保 transport 有默认值
  if (!serverCfg.transport) serverCfg = { ...serverCfg, transport: 'stdio' }

  const result = await addMCPServerRuntime(serverCfg)

  if (!result.ok) {
    return {
      content: `安装失败：${result.error}`,
      brief:   '安装失败',
    }
  }

  // 安装成功后使缓存失效，下一轮对话即可使用新工具
  invalidateToolCache()
  invalidateAgentCache()
  invalidateGraphCache()

  const configSnippet = JSON.stringify({
    name:      serverCfg.name,
    transport: serverCfg.transport ?? 'stdio',
    command:   serverCfg.command,
    args:      serverCfg.args,
    ...(serverCfg.env ? { env: serverCfg.env } : {}),
  }, null, 2)

  return {
    content: `「${serverCfg.name}」已成功载入，新增 ${result.toolCount ?? '若干'} 个工具，当前对话即可使用。

注意：此安装仅在当前进程内有效，服务器重启后失效。如需永久保留，请将以下配置添加到 codelife.config.ts 的 spirit.mcpServers 数组：

\`\`\`ts
${configSnippet}
\`\`\``,
    brief:   `已载入 ${result.toolCount ?? '?'} 个工具`,
  }
}, { displayName: '安装 MCP 服务器', domain: 'meta' })

// ── list_mcp_servers 工具 ─────────────────────────────────────────────────────

registerTool({
  name:        'list_mcp_servers',
  description: '列出当前已载入的 MCP 服务器及其工具数量。包括：配置文件预加载的服务器，以及本次进程内通过 install_mcp 动态安装的服务器。',
  parameters:  { type: 'object', properties: {}, required: [] },
}, async () => {
  const { getRuntimeServers }  = await import('../mcp-loader')
  const { getMCPAdapters, getToolDefinitions } = await import('../registry')

  const adapters = getMCPAdapters()   // { namespace, name }[]
  if (adapters.length === 0) {
    return { content: '当前没有已载入的 MCP 服务器。', brief: '无服务器' }
  }

  // 按命名空间统计工具数量（MCP 工具名格式：namespace__toolname）
  const allTools = getToolDefinitions()
  const countByNs = new Map<string, number>()
  for (const t of allTools) {
    const sep = t.name.indexOf('__')
    if (sep > 0) {
      const ns = t.name.slice(0, sep)
      countByNs.set(ns, (countByNs.get(ns) ?? 0) + 1)
    }
  }

  const runtimeNames = new Set(getRuntimeServers().map(s => s.name))
  const lines = adapters.map(a => {
    const count = countByNs.get(a.namespace) ?? 0
    const tag   = runtimeNames.has(a.name) ? '（本次动态安装，重启失效）' : '（配置文件预加载）'
    return `- 【${a.name}】${count} 个工具 ${tag}`
  })

  const hasRuntime = getRuntimeServers().length > 0
  const note = hasRuntime
    ? '\n\n动态安装的服务器重启后失效，如需永久保留请将配置加入 codelife.config.ts 的 spirit.mcpServers。'
    : ''

  return {
    content: `已载入 ${adapters.length} 个 MCP 服务器：\n${lines.join('\n')}${note}`,
    brief:   `共 ${adapters.length} 个服务器`,
  }
}, { displayName: '查看 MCP 服务器', domain: 'meta' })
