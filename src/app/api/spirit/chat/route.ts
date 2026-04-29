/**
 * POST /api/spirit/chat  —  LangGraph Multi-Agent Loop
 *
 * Body:
 *   messages: { role: 'user'|'assistant'; content: string }[]
 *   agentId?:  "auto" | "qingxiao" | "search_agent" | "code_agent" | "planner_agent"
 *              不传 / "auto" → Planner 自动决策策略（推荐）
 *              具体 agentId  → 跳过 Planner，直通该 Agent（调试用）
 *
 * Response: text/event-stream（SpiritEvent 序列）
 */

import { NextRequest }         from 'next/server'
import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages'
import type { BaseMessage }    from '@langchain/core/messages'
import config                  from '../../../../../codelife.config'
import { encodeEvent }         from '@/lib/spirit/protocol'
import { getCompiledGraph, getRecursionLimit } from '@/lib/spirit/langgraph/graph'
import { getDailyLog }                         from '@/lib/spirit/memory'
import { dateInTZ }                            from '@/lib/spirit/time'
import { packTodayHistory }                    from '@/lib/spirit/context'
import { prefetchMemoryPackWithAI, type PrefetchedMemoryPack } from '@/lib/spirit/memory-gate'
import { ensureConfiguredMCPServersLoaded }    from '@/lib/spirit/mcp-runtime'
import { syncToday }           from '@/lib/spirit/sync'
import { quickClassify }       from '@/lib/spirit/langgraph/classify'
import { getQingxiaoDomains, inferDomainsWithAI, type ToolDomain } from '@/lib/spirit/langgraph/tools'
import { buildChatModel }      from '@/lib/spirit/langgraph/agents'
// recursionLimit 在 planner 解析出并行任务数后才能精确计算，
// 这里保守地用最大值（5 个并行任务）
const DEFAULT_PARALLEL = 5
import { translateToSpiritEvents }             from '@/lib/spirit/langgraph/stream'
import {
  attachMemoryGate,
  consumeAuditEvent,
  createContextRun,
  saveContextRun,
} from '@/lib/spirit/context-audit'

export const runtime = 'nodejs'

function memoryGateHint(prefetch: PrefetchedMemoryPack): SystemMessage | null {
  if (prefetch.intent.strength === 'none') return null
  const tools = prefetch.intent.requiredTools.length
    ? `候选补充工具：${prefetch.intent.requiredTools.join(' / ')}`
    : '无候选补充工具'
  const result = prefetch.items.length
    ? `服务端已预取 ${prefetch.items.length} 条相关记忆。优先基于这些记忆回答；如证据不足或用户追问细节，再调用候选工具补充。`
    : '服务端判断此问题需要记忆，但本地预取未找到足够结果；必须调用候选工具补充，不能凭印象回答。'
  return new SystemMessage(`[记忆检索门控]\n意图：${prefetch.intent.intents.join(', ')}\n${result}\n${tools}`)
}

function loadTodayHistory(
  currentMessages: { role: string; content: string }[],
): { messages: BaseMessage[]; diagnostics: ReturnType<typeof packTodayHistory>['diagnostics'] } {
  const packed = packTodayHistory(currentMessages)
  const d = packed.diagnostics
  if (d.totalSaved > 0) {
    console.log(
      `[spirit] today history pack: date=${d.date} selected=${d.selected}/${d.totalSaved} summarized=${d.summarized} chars=${d.chars} skipped=${d.skipped} truncated=${d.truncated} deduped=${d.deduped}`,
    )
  }

  const history = packed.messages.map(m =>
    m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content)
  )
  return {
    messages: packed.summary ? [new SystemMessage(packed.summary), ...history] : history,
    diagnostics: packed.diagnostics,
  }
}

export async function POST(req: NextRequest) {
  const spirit = config.spirit
  if (!spirit?.enabled) return new Response('器灵未开启', { status: 403 })
  if (!spirit.apiKey)   return new Response('SPIRIT_API_KEY 未配置', { status: 500 })

  const { messages, agentId } = await req.json() as {
    messages: { role: 'user' | 'assistant' | 'system'; content: string }[]
    agentId?: string
  }

  // 今日 DailyLog 不存在则先同步（保证记忆有数据）
  const today = dateInTZ()

  // 把前端消息历史转换为 LangChain BaseMessage
  const currentMsgs = messages.map(m => {
    if (m.role === 'system')    return new SystemMessage(m.content)
    if (m.role === 'assistant') return new AIMessage(m.content)
    return new HumanMessage(m.content)
  })

  // 今日已保存的历史作为真实消息 prepend（Issue 3）
  const todayHistoryPack  = loadTodayHistory(messages)
  const todayHistory      = todayHistoryPack.messages
  const langchainMessages = [...todayHistory, ...currentMsgs]

  const lastUserMsg  = langchainMessages.findLast(m => m._getType() === 'human')
  const lastUserText = (typeof lastUserMsg?.content === 'string' ? lastUserMsg.content : '')
  const msgPreview   = lastUserText.slice(0, 80)

  // 短续接消息（如"已确认，请继续执行"）域推断时补充近期用户消息上下文，
  // 避免权限确认后域丢失导致工具不可用
  const inferText = lastUserText.length < 25
    ? langchainMessages
        .filter(m => m._getType() === 'human')
        .slice(-4)
        .map(m => (typeof m.content === 'string' ? m.content : ''))
        .join(' ')
    : lastUserText

  // 同步今日日志 + AI 域分类 并行跑，不互相阻塞
  const needSync  = !getDailyLog(today)
  const model     = buildChatModel(spirit.model)
  const useAIDomains = !agentId || agentId === 'auto'

  const encoder = new TextEncoder()
  const routeHint = messages.find(m => m.role === 'system' && m.content.startsWith('[当前页面：'))?.content
    ?.replace('[当前页面：', '')
    .replace(/\]$/, '')
  const auditRun = createContextRun({
    userMessage: lastUserText,
    route: routeHint,
    model: spirit.model,
    todayHistory: {
      totalSaved: todayHistoryPack.diagnostics.totalSaved,
      selected: todayHistoryPack.diagnostics.selected,
      summarized: todayHistoryPack.diagnostics.summarized,
      skipped: todayHistoryPack.diagnostics.skipped,
      truncated: todayHistoryPack.diagnostics.truncated,
      deduped: todayHistoryPack.diagnostics.deduped,
    },
  })
  const auditFinalText = { value: '' }

  const readable = new ReadableStream({
    async start(ctrl) {
      const push = (data: string) => ctrl.enqueue(encoder.encode(data))

      try {
        // 发初始化事件，让前端立即显示"准备中"状态
        push(encodeEvent({ type: 'tool_start', name: '__init__', display: '准备中', desc: undefined }))

        const [, extraDomains] = await Promise.all([
          needSync ? syncToday().catch(() => {}) : Promise.resolve(),
          useAIDomains ? inferDomainsWithAI(inferText, model) : Promise.resolve([]),
          ensureConfiguredMCPServersLoaded().catch(err =>
            console.warn('[MCP] configured preload failed:', err instanceof Error ? err.message : err)
          ),
        ])

        push(encodeEvent({ type: 'tool_done', name: '__init__' }))

        const prefetchedMemory = await prefetchMemoryPackWithAI(inferText, model)
        attachMemoryGate(auditRun, prefetchedMemory)
        const gateHint = memoryGateHint(prefetchedMemory)
        const prefetchedMemoryMessage = prefetchedMemory.content
          ? new SystemMessage(prefetchedMemory.content)
          : null
        const graphMessages = [
          ...(gateHint ? [gateHint] : []),
          ...(prefetchedMemoryMessage ? [prefetchedMemoryMessage] : []),
          ...langchainMessages,
        ]
        if (prefetchedMemory.intent.strength !== 'none') {
          console.log(
            `[spirit] memory gate: intents=${prefetchedMemory.intent.intents.join(',')} items=${prefetchedMemory.items.length} tools=${prefetchedMemory.intent.requiredTools.join(',') || 'none'}`,
          )
        }

        // quickClassify：规则判断是否需要 Planner（Issue 4）
        const usePlanner = useAIDomains
          ? quickClassify(langchainMessages) === 'plan'
          : false

        const domains = useAIDomains ? getQingxiaoDomains(extraDomains as ToolDomain[]) : undefined
        auditRun.domains = domains ?? ['debug']
        console.log(`[spirit] chat request: usePlanner=${usePlanner} msgs=${langchainMessages.length} domains=${domains?.join(',') ?? 'debug'} "${msgPreview}"`)
        auditRun.planner.usePlanner = usePlanner

        const graph          = getCompiledGraph(agentId, domains)
        const recursionLimit = getRecursionLimit(DEFAULT_PARALLEL)

        const eventStream = graph.streamEvents(
          { messages: graphMessages, usePlanner },
          { version: 'v2', recursionLimit },
        )

        for await (const spiritEvent of translateToSpiritEvents(eventStream)) {
          consumeAuditEvent(auditRun, spiritEvent, auditFinalText)
          push(encodeEvent(spiritEvent))
          if (spiritEvent.type === 'done') break
        }
        auditRun.finalAnswerPreview = auditFinalText.value
        console.log('[spirit] chat done')
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        console.error('[spirit] chat error:', errMsg)
        auditRun.errors.push(errMsg)
        push(encodeEvent({ type: 'error', message: errMsg }))
      } finally {
        auditRun.finalAnswerPreview = auditFinalText.value || auditRun.finalAnswerPreview
        saveContextRun(auditRun)
        ctrl.close()
      }
    },
  })

  return new Response(readable, {
    headers: {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
    },
  })
}
