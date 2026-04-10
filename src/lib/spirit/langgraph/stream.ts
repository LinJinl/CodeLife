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

// ── <think> 流式过滤器（与原 route.ts 的 ThinkFilter 相同） ──

class ThinkFilter {
  private buf     = ''
  private inThink = false

  feed(chunk: string): string {
    let out = ''
    this.buf += chunk
    while (this.buf.length > 0) {
      if (this.inThink) {
        const end = this.buf.indexOf('</think>')
        if (end === -1) break
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
          out     += this.buf.slice(0, this.buf.length - keep)
          this.buf = keep > 0 ? this.buf.slice(-keep) : ''
          break
        }
        out         += this.buf.slice(0, start)
        this.buf     = this.buf.slice(start + 7)
        this.inThink = true
      }
    }
    return out
  }

  flush(): string {
    if (this.inThink) return ''
    const r = this.buf; this.buf = ''; return r
  }
}

// ── brief 提取（与 tools.ts 中的 BRIEF:: 约定对应） ──────────

function extractBrief(output: unknown): string | undefined {
  if (typeof output !== 'string') return undefined
  if (output.startsWith('BRIEF::')) {
    return output.split('\n')[0].slice(7)
  }
  return undefined
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
      yield {
        type:    'tool_start',
        name:    event.name,
        display: getToolDisplayName(event.name),
      }
    }

    // ── 工具结束 ──────────────────────────────────────────────
    if (event.event === 'on_tool_end') {
      const output = event.data?.output
      yield {
        type:  'tool_done',
        name:  event.name,
        brief: extractBrief(output),
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
        const visible = thinkFilter.feed(text)
        if (visible) yield { type: 'text', chunk: visible }
      }
    }
  }

  // flush 残留 think 缓冲
  const trailing = thinkFilter.flush()
  if (trailing) yield { type: 'text', chunk: trailing }

  yield { type: 'done' }
}
