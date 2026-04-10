/**
 * 文件系统工具
 *
 * 代替 run_shell 的 ls/cat/find，让 AI 高效探索和读取文件：
 *   list_files  — 列出目录结构（支持 glob 过滤）
 *   read_file   — 读取文件内容（支持行号范围）
 */

import { registerTool } from '../registry'
import fs   from 'fs'
import path from 'path'

const PROJECT_ROOT = process.cwd()

/** 把用户路径安全地解析到项目根下，防止路径穿越 */
function safePath(p: string): string {
  const resolved = path.resolve(PROJECT_ROOT, p || '.')
  if (!resolved.startsWith(PROJECT_ROOT)) {
    throw new Error(`路径超出项目目录：${p}`)
  }
  return resolved
}

// ── list_files ────────────────────────────────────────────────

registerTool({
  name: 'list_files',
  description: `列出目录下的文件和子目录，支持简单 glob 过滤。

使用时机：
- 探索代码结构（"看看 src 下有什么"、"梳理代码结构"）
- 查找特定类型文件（"所有 .ts 文件"、"找配置文件"）
- 比 run_shell ls/find 更高效：一次调用返回完整结构

路径相对于项目根目录，不填则列出根目录。`,
  parameters: {
    type: 'object',
    properties: {
      dir:       { type: 'string', description: '目录路径（相对于项目根，默认 "."）' },
      pattern:   { type: 'string', description: '文件名过滤，支持 * 通配符（如 "*.ts"、"*.json"）' },
      recursive: { type: 'boolean', description: '是否递归子目录（默认 true）' },
      maxDepth:  { type: 'number',  description: '最大递归深度（默认 4）' },
    },
    required: [],
  },
}, async ({ dir = '.', pattern, recursive = true, maxDepth = 4 }) => {
  let root: string
  try {
    root = safePath(dir as string)
  } catch (e) {
    return { content: String(e), brief: '路径错误' }
  }

  if (!fs.existsSync(root)) {
    return { content: `目录不存在：${dir}`, brief: '目录不存在' }
  }

  const stat = fs.statSync(root)
  if (!stat.isDirectory()) {
    // 单文件时直接读取
    const content = fs.readFileSync(root, 'utf-8')
    return { content, brief: path.relative(PROJECT_ROOT, root) }
  }

  const patStr   = (pattern as string | undefined) ?? ''
  const maxD     = Math.min((maxDepth as number) || 4, 8)
  const lines: string[] = []

  function walk(dir: string, depth: number, prefix: string) {
    if (depth > maxD) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch { return }

    // 过滤隐藏目录和常见大型目录
    entries = entries.filter(e => {
      const n = e.name
      if (n.startsWith('.') && n !== '.env.local') return false
      if (e.isDirectory() && ['node_modules', '.next', 'dist', '.git', '__pycache__'].includes(n)) return false
      return true
    })

    entries.sort((a, b) => {
      // 目录排在前面
      if (a.isDirectory() && !b.isDirectory()) return -1
      if (!a.isDirectory() && b.isDirectory()) return 1
      return a.name.localeCompare(b.name)
    })

    for (const entry of entries) {
      const matchPat = patStr
        ? new RegExp('^' + patStr.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$').test(entry.name)
        : true

      if (entry.isDirectory()) {
        lines.push(`${prefix}${entry.name}/`)
        if (recursive as boolean) walk(path.join(dir, entry.name), depth + 1, prefix + '  ')
      } else if (matchPat) {
        lines.push(`${prefix}${entry.name}`)
      }
    }
  }

  const relRoot = path.relative(PROJECT_ROOT, root) || '.'
  lines.push(`${relRoot}/`)
  walk(root, 1, '  ')

  if (lines.length === 1) return { content: '目录为空', brief: '空目录' }

  return {
    content: `BRIEF::${relRoot} 共 ${lines.length - 1} 项\n${lines.join('\n')}`,
    brief:   `${relRoot} 共 ${lines.length - 1} 项`,
  }
}, { displayName: '列出文件' })

// ── read_file ─────────────────────────────────────────────────

registerTool({
  name: 'read_file',
  description: `读取文件内容，支持指定行范围。

使用时机：
- 读取源代码文件
- 查看配置文件内容
- 检查特定文件的实现细节

路径相对于项目根目录。行号从 1 开始，不指定则读取全文。`,
  parameters: {
    type: 'object',
    properties: {
      path:      { type: 'string', description: '文件路径（相对于项目根）' },
      startLine: { type: 'number', description: '起始行（默认 1）' },
      endLine:   { type: 'number', description: '结束行（默认读到文件末尾）' },
    },
    required: ['path'],
  },
}, async ({ path: filePath, startLine, endLine }) => {
  let fullPath: string
  try {
    fullPath = safePath(filePath as string)
  } catch (e) {
    return { content: String(e), brief: '路径错误' }
  }

  if (!fs.existsSync(fullPath)) {
    return { content: `文件不存在：${filePath}`, brief: '文件不存在' }
  }

  const stat = fs.statSync(fullPath)
  if (stat.isDirectory()) {
    return { content: `${filePath} 是目录，请用 list_files 浏览`, brief: '是目录' }
  }

  let content: string
  try {
    content = fs.readFileSync(fullPath, 'utf-8')
  } catch (e) {
    return { content: `读取失败：${e}`, brief: '读取失败' }
  }

  const lines  = content.split('\n')
  const total  = lines.length
  const start  = Math.max(1, (startLine as number) || 1)
  const end    = Math.min(total, (endLine as number) || total)

  const selected = lines.slice(start - 1, end)
  const rel      = path.relative(PROJECT_ROOT, fullPath)

  // 加行号（方便 AI 引用）
  const numbered = selected.map((l, i) => `${String(start + i).padStart(4)} │ ${l}`).join('\n')

  const brief = startLine || endLine
    ? `${rel} L${start}-${end}/${total}`
    : `${rel} (${total} 行)`

  return {
    content: `BRIEF::${brief}\n${numbered}`,
    brief,
  }
}, { displayName: '读取文件' })
