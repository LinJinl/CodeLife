/**
 * LangGraph streamEvents → SpiritEvent SSE 翻译器
 *
 * 处理的 LangGraph 事件：
 *   on_chat_model_stream  → text（过滤 <think> 块 + 空 chunk）
 *   on_tool_start         → tool_start
 *   on_tool_end           → tool_done；cards（藏经阁工具）
 *   on_chain_start/end    → agent_start / agent_end（专项 Agent 节点）
 */

import type { StreamEvent }  from '@langchain/core/tracers/log_stream'
import type { SpiritEvent }  from '../protocol'
import { getToolDisplayName } from '../registry'
import { AGENT_DISPLAY }     from './tools'
import type { SubTask }      from './state'

// ── <think> 流式过滤器：分离 visible text 和 thinking content ──

class ThinkFilter {
  private buf     = ''
  private inThink = false

  feed(chunk: string): { text: string; thinking: string } {
    let outText    = ''
    let outThinking = ''
    this.buf += chunk
    while (this.buf.length > 0) {
      if (this.inThink) {
        const end = this.buf.indexOf('</think>')
        if (end === -1) {
          // 结尾可能是 </think> 的前缀，保留以等待下一 chunk
          const tag = '</think>'
          let keep = 0
          for (let i = 1; i < tag.length; i++) {
            if (this.buf.endsWith(tag.slice(0, i))) { keep = i; break }
          }
          outThinking += this.buf.slice(0, this.buf.length - keep)
          this.buf     = keep > 0 ? this.buf.slice(-keep) : ''
          break
        }
        outThinking += this.buf.slice(0, end)
        this.buf     = this.buf.slice(end + 8).trimStart()
        this.inThink = false
      } else {
        const start = this.buf.indexOf('<think>')
        if (start === -1) {
          const tag = '<think>'
          let keep = 0
          for (let i = 1; i < tag.length; i++) {
            if (this.buf.endsWith(tag.slice(0, i))) { keep = i; break }
          }
          outText  += this.buf.slice(0, this.buf.length - keep)
          this.buf  = keep > 0 ? this.buf.slice(-keep) : ''
          break
        }
        outText      += this.buf.slice(0, start)
        this.buf      = this.buf.slice(start + 7)
        this.inThink  = true
      }
    }
    return { text: outText, thinking: outThinking }
  }

  flush(): { text: string; thinking: string } {
    const r = this.buf
    this.buf = ''
    if (this.inThink) return { text: '', thinking: r }
    return { text: r, thinking: '' }
  }
}

// ── brief 提取（与 tools.ts 中的 BRIEF:: 约定对应） ──────────
// @langchain/core 1.x 把工具返回值包装成 ToolMessage 对象再发出；
// 需要先从 ToolMessage.content 取出字符串，再解析 BRIEF:: 前缀。

function extractRawStr(output: unknown): string {
  if (typeof output === 'string') return output
  if (output && typeof output === 'object') {
    const o = output as Record<string, unknown>
    if (typeof o.content === 'string') return o.content
    if (Array.isArray(o.content)) {
      return (o.content as unknown[]).map(c =>
        typeof c === 'string' ? c :
        (c && typeof c === 'object' && typeof (c as Record<string, unknown>).text === 'string')
          ? (c as Record<string, unknown>).text as string : ''
      ).join('')
    }
  }
  return ''
}

function extractBrief(output: unknown): string | undefined {
  const raw = extractRawStr(output)
  if (raw.startsWith('BRIEF::')) {
    return raw.split('\n')[0].slice(7)
  }
  return undefined
}

// ── 工具输入描述（tool_start 时给用户看的参数摘要） ────────────

function describeToolInput(name: string, input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined
  const a = input as Record<string, unknown>

  // 通用规则：按工具名提取最重要的一个参数
  switch (name) {
    case 'run_shell':         return typeof a.command === 'string' ? a.command : undefined
    case 'web_search':        return typeof a.query   === 'string' ? `"${a.query}"` : undefined
    case 'fetch_url':         return typeof a.url     === 'string' ? a.url : undefined
    case 'search_library':
    case 'search_blog_posts':
    case 'search_conversations': return typeof a.query === 'string' ? `"${a.query}"` : undefined
    case 'get_daily_logs':       return typeof a.days  === 'number' ? `近 ${a.days} 天` : '近 7 天'
    case 'get_weekly_patterns':  return typeof a.weeks === 'number' ? `近 ${a.weeks} 周` : '近 4 周'
    case 'read_user_blogs':      return typeof a.limit === 'number' ? `最近 ${a.limit} 篇` : '最近 20 篇'
    case 'read_leetcode_records':return typeof a.limit === 'number' ? `最近 ${a.limit} 题` : '最近 30 题'
    case 'list_library':         return typeof a.limit === 'number' ? `最新 ${a.limit} 篇` : '最新 10 篇'
    case 'list_files':           return typeof a.dir   === 'string' ? a.dir : '.'
    case 'read_file':            return typeof a.path  === 'string' ? a.path : undefined
    case 'write_note':           return typeof a.content === 'string' ? a.content.slice(0, 40) : undefined
    case 'save_skill_card':      return typeof a.title   === 'string' ? a.title : undefined
    default: {
      // MCP 工具或其他：取第一个字符串参数
      const first = Object.values(a).find(v => typeof v === 'string')
      return typeof first === 'string' ? first.slice(0, 60) : undefined
    }
  }
}

// ── 专项 Agent 节点名集合（用于 agent_start / agent_end） ─────

const AGENT_NODE_NAMES = new Set(Object.keys(AGENT_DISPLAY))

// ── Executor 子任务跟踪 ───────────────────────────────────────
// Send 触发的 executor 节点，通过 run_id 追踪对应的 SubTask

// ── 主翻译器 ──────────────────────────────────────────────────

export async function* translateToSpiritEvents(
  eventStream: AsyncIterable<StreamEvent>,
): AsyncGenerator<SpiritEvent> {
  const thinkFilter    = new ThinkFilter()
  const activeAgents   = new Set<string>()
  // executor run_id → SubTask（从 on_chain_start 的 input 中读取）
  const executorTasks  = new Map<string, SubTask>()
  let   strategyEmitted = false
  // 当前执行策略：parallel 模式下只有 synthesizer 的文本对用户可见
  let   currentMode: 'direct' | 'sequential' | 'parallel' | null = null

  for await (const event of eventStream) {
    const nodeName = event.metadata?.langgraph_node as string | undefined

    // ── Planner 完成 → emit strategy 事件 ───────────────────
    if (
      event.event === 'on_chain_end' &&
      nodeName === 'planner' &&
      !strategyEmitted
    ) {
      const output = event.data?.output as Record<string, unknown> | undefined
      const mode   = output?.strategy as 'direct' | 'sequential' | 'parallel' | undefined
      if (mode) {
        currentMode = mode
        const subtasks = (output?.subtasks as unknown[]) ?? []
        strategyEmitted = true
        console.log(`[spirit] strategy=${mode} tasks=${subtasks.length}`)
        yield { type: 'strategy', mode, taskCount: subtasks.length || undefined }
      }
    }

    // ── Executor 开始（并行子任务） ───────────────────────────
    if (event.event === 'on_chain_start' && nodeName === 'executor') {
      const input   = event.data?.input as { subtask?: SubTask } | undefined
      const subtask = input?.subtask
      if (subtask) {
        executorTasks.set(event.run_id, subtask)
        yield {
          type:    'task_start',
          taskId:  subtask.id,
          agent:   subtask.agentId,
          display: AGENT_DISPLAY[subtask.agentId] ?? subtask.agentId,
          desc:    subtask.description,
        }
      }
    }

    // ── Executor 结束 ──────────────────────────────────────────
    if (event.event === 'on_chain_end' && nodeName === 'executor') {
      const task = executorTasks.get(event.run_id)
      if (task) {
        executorTasks.delete(event.run_id)
        yield { type: 'task_done', taskId: task.id, agent: task.agentId }
      }
    }

    // ── Agent 进入（on_chain_start，仅专项 Agent 节点） ──────
    if (
      event.event === 'on_chain_start' &&
      nodeName && AGENT_NODE_NAMES.has(nodeName) &&
      !activeAgents.has(nodeName)
    ) {
      activeAgents.add(nodeName)
      yield { type: 'agent_start', agent: nodeName, display: AGENT_DISPLAY[nodeName] }
    }

    // ── Agent 退出 ────────────────────────────────────────────
    if (
      event.event === 'on_chain_end' &&
      nodeName && activeAgents.has(nodeName)
    ) {
      activeAgents.delete(nodeName)
      yield { type: 'agent_end', agent: nodeName }
    }

    // ── 工具开始 ──────────────────────────────────────────────
    if (event.event === 'on_tool_start') {
      const desc = describeToolInput(event.name, event.data?.input)
      console.log(`[spirit] tool_start: ${event.name}${desc ? ` (${desc})` : ''}`)
      yield {
        type:    'tool_start',
        name:    event.name,
        display: getToolDisplayName(event.name),
        desc,
      }
    }

    // ── 工具结束 ──────────────────────────────────────────────
    if (event.event === 'on_tool_end') {
      const output  = event.data?.output
      const brief   = extractBrief(output)
      const rawStr  = extractRawStr(output)
      const baseStr = rawStr.startsWith('BRIEF::')
        ? rawStr.slice(rawStr.indexOf('\n') + 1)
        : rawStr

      // 提取可点击链接（web_search / fetch_url）
      let links: { title: string; url: string }[] | undefined
      if (event.name === 'web_search') {
        try {
          const srcSection = baseStr.includes('\n来源：\n')
            ? baseStr.split('\n来源：\n')[1]
            : baseStr
          const extracted: { title: string; url: string }[] = []
          for (const block of srcSection.split('\n\n')) {
            const lines = block.split('\n')
            if (lines[0]?.match(/^\[\d+\] /)) {
              const title = lines[0].replace(/^\[\d+\] /, '')
              const url   = lines[1]
              if (url?.startsWith('http')) extracted.push({ title, url })
            }
          }
          if (extracted.length > 0) links = extracted
        } catch { /* ignore */ }
      }
      if (event.name === 'fetch_url') {
        try {
          const parsed = JSON.parse(baseStr) as { title?: string; url?: string }
          if (parsed.url) links = [{ title: parsed.title || parsed.url, url: parsed.url }]
        } catch { /* ignore */ }
      }

      console.log(`[spirit] tool_done: ${event.name}${brief ? ` → ${brief}` : ''}${links ? ` [${links.length} links]` : ''}`)
      yield { type: 'tool_done', name: event.name, brief, links }
      if (baseStr.startsWith('PERMISSION_REQUIRED::')) {
        // 格式：PERMISSION_REQUIRED::token::level::cmd::workdir
        const parts = baseStr.split('::')
        yield {
          type:    'permission_request',
          token:   parts[1] ?? '',
          level:   (parts[2] ?? 'moderate') as 'moderate' | 'destructive',
          command: parts[3] ?? '',
          workdir: parts[4] ?? '',
        }
      }

      // 藏经阁工具 → 推送结构化卡片
      if (event.name === 'search_library' || event.name === 'list_library') {
        try {
          // output 格式：可能是 "BRIEF::...\n[JSON]" 或直接 "[JSON]"
          const raw     = typeof output === 'string' ? output : ''
          const jsonStr = raw.startsWith('BRIEF::')
            ? raw.slice(raw.indexOf('\n') + 1)
            : raw
          const entries = JSON.parse(jsonStr)
          if (Array.isArray(entries) && entries.length > 0) {
            yield { type: 'cards', entries }
          }
        } catch { /* ignore */ }
      }
    }

    // ── 文本 token ────────────────────────────────────────────
    // 过滤规则（按策略）：
    //   parallel   → 只有 synthesizer 节点的文本推送给前端；
    //                executor 内部 Agent 的中间结果不可见
    //   sequential → 各专项 Agent 的回答可见，排除 planner/supervisor
    //   direct     → 同 sequential
    const textAllowed = currentMode === 'parallel'
      ? nodeName === 'synthesizer'
      : nodeName !== 'supervisor' && nodeName !== 'planner'

    if (event.event === 'on_chat_model_stream' && textAllowed) {
      const content = event.data?.chunk?.content
      const text    = typeof content === 'string' ? content : ''
      if (text) {
        const { text: visible, thinking } = thinkFilter.feed(text)
        if (visible)  yield { type: 'text',    chunk: visible }
        if (thinking) yield { type: 'thinking', chunk: thinking }
      }
    }
  }

  // flush 残留 think 缓冲
  const { text: trailing, thinking: trailingThink } = thinkFilter.flush()
  if (trailing)      yield { type: 'text',    chunk: trailing }
  if (trailingThink) yield { type: 'thinking', chunk: trailingThink }

  yield { type: 'done' }
}
