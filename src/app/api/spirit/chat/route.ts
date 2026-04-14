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
import { getDailyLog, getConversation }        from '@/lib/spirit/memory'
import { syncToday }           from '@/lib/spirit/sync'
import { quickClassify }       from '@/lib/spirit/langgraph/classify'
import { getQingxiaoDomains, inferDomainsWithAI, type ToolDomain } from '@/lib/spirit/langgraph/tools'
import { buildChatModel }      from '@/lib/spirit/langgraph/agents'
// recursionLimit 在 planner 解析出并行任务数后才能精确计算，
// 这里保守地用最大值（5 个并行任务）
const DEFAULT_PARALLEL = 5
import { translateToSpiritEvents }             from '@/lib/spirit/langgraph/stream'

export const runtime = 'nodejs'

/**
 * 把今日已保存对话的最后 N 条作为真实 BaseMessage prepend 到消息前
 * 仅在前端消息尚未包含今日历史时注入（避免单次长会话重复）
 */
function loadTodayHistory(
  currentMessages: { role: string; content: string }[],
): BaseMessage[] {
  const today = new Date().toISOString().slice(0, 10)
  const conv  = getConversation(today)
  if (conv.messages.length === 0) return []

  const saved = conv.messages.slice(-6)   // 最多取 6 条

  // 去重：若前端消息已包含今日历史末尾内容（同一会话），不再 prepend
  const lastSavedSnippet = saved.at(-1)?.content.slice(0, 50) ?? ''
  if (lastSavedSnippet && currentMessages.some(m => m.content.includes(lastSavedSnippet))) {
    return []
  }

  return saved.map(m =>
    m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content)
  )
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
  const today = new Date().toISOString().slice(0, 10)

  // 把前端消息历史转换为 LangChain BaseMessage
  const currentMsgs = messages.map(m => {
    if (m.role === 'system')    return new SystemMessage(m.content)
    if (m.role === 'assistant') return new AIMessage(m.content)
    return new HumanMessage(m.content)
  })

  // 今日已保存的历史作为真实消息 prepend（Issue 3）
  const todayHistory      = loadTodayHistory(messages)
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

  const readable = new ReadableStream({
    async start(ctrl) {
      const push = (data: string) => ctrl.enqueue(encoder.encode(data))

      try {
        // 发初始化事件，让前端立即显示"准备中"状态
        push(encodeEvent({ type: 'tool_start', name: '__init__', display: '准备中', desc: undefined }))

        const [, extraDomains] = await Promise.all([
          needSync ? syncToday().catch(() => {}) : Promise.resolve(),
          useAIDomains ? inferDomainsWithAI(inferText, model) : Promise.resolve([]),
        ])

        push(encodeEvent({ type: 'tool_done', name: '__init__' }))

        // quickClassify：规则判断是否需要 Planner（Issue 4）
        const usePlanner = useAIDomains
          ? quickClassify(langchainMessages) === 'plan'
          : false

        const domains = useAIDomains ? getQingxiaoDomains(extraDomains as ToolDomain[]) : undefined
        console.log(`[spirit] chat request: usePlanner=${usePlanner} msgs=${langchainMessages.length} domains=${domains?.join(',') ?? 'debug'} "${msgPreview}"`)

        const graph          = getCompiledGraph(agentId, domains)
        const recursionLimit = getRecursionLimit(DEFAULT_PARALLEL)

        const eventStream = graph.streamEvents(
          { messages: langchainMessages, usePlanner },
          { version: 'v2', recursionLimit },
        )

        for await (const spiritEvent of translateToSpiritEvents(eventStream)) {
          push(encodeEvent(spiritEvent))
          if (spiritEvent.type === 'done') break
        }
        console.log('[spirit] chat done')
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        console.error('[spirit] chat error:', errMsg)
        push(encodeEvent({ type: 'error', message: errMsg }))
      } finally {
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
