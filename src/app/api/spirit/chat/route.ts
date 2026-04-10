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
import config                  from '../../../../../codelife.config'
import { encodeEvent }         from '@/lib/spirit/protocol'
import { getCompiledGraph, getRecursionLimit } from '@/lib/spirit/langgraph/graph'
import { getDailyLog }         from '@/lib/spirit/memory'
import { syncToday }           from '@/lib/spirit/sync'
// recursionLimit 在 planner 解析出并行任务数后才能精确计算，
// 这里保守地用最大值（5 个并行任务）
const DEFAULT_PARALLEL = 5
import { translateToSpiritEvents }             from '@/lib/spirit/langgraph/stream'

export const runtime = 'nodejs'

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
  if (!getDailyLog(today)) {
    try { await syncToday() } catch { /* 数据源未配置时跳过 */ }
  }

  // 把前端消息历史转换为 LangChain BaseMessage
  const langchainMessages = messages.map(m => {
    if (m.role === 'system')    return new SystemMessage(m.content)
    if (m.role === 'assistant') return new AIMessage(m.content)
    return new HumanMessage(m.content)
  })

  const graph          = getCompiledGraph(agentId)
  const recursionLimit = getRecursionLimit(DEFAULT_PARALLEL)
  const encoder        = new TextEncoder()

  const readable = new ReadableStream({
    async start(ctrl) {
      const push = (data: string) => ctrl.enqueue(encoder.encode(data))

      try {
        const eventStream = graph.streamEvents(
          { messages: langchainMessages },
          { version: 'v2', recursionLimit },
        )

        for await (const spiritEvent of translateToSpiritEvents(eventStream)) {
          push(encodeEvent(spiritEvent))
          if (spiritEvent.type === 'done') break
        }
      } catch (err) {
        push(encodeEvent({ type: 'error', message: err instanceof Error ? err.message : String(err) }))
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
