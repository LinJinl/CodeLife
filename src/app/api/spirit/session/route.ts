/**
 * GET  /api/spirit/session?date=2026-04-07  加载指定日期会话（默认今日）
 * POST /api/spirit/session                  保存完整消息列表，异步生成当日摘要
 */

import { NextRequest }                                      from 'next/server'
import { getConversation, saveConversation, saveSessionSummary, getAllConversationDates } from '@/lib/spirit/memory'
import { summarizeSession }                                 from '@/lib/spirit/summarize'
import config                                               from '../../../../../codelife.config'

export const runtime = 'nodejs'

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

export async function GET(req: NextRequest) {
  // ?list=true → 返回所有有对话记录的日期（倒序，扫目录全量，无时间窗口限制）
  if (req.nextUrl.searchParams.get('list') === 'true') {
    return Response.json(getAllConversationDates())
  }

  const date = req.nextUrl.searchParams.get('date') ?? todayStr()
  const conv = getConversation(date)
  return Response.json(conv)
}

export async function POST(req: NextRequest) {
  const body = await req.json() as { messages: { role: string; content: string; timestamp: string }[] }
  const date = todayStr()
  const conv = { date, messages: body.messages as never }
  saveConversation(conv)

  // 异步生成当日摘要（不阻塞响应）
  if (config.spirit?.enabled && config.spirit.apiKey) {
    const { buildChatModel } = await import('@/lib/spirit/langgraph/agents')
    const reflectModel = config.spirit.reflectModel ?? config.spirit.model
    summarizeSession(date, body.messages as never, buildChatModel(reflectModel))
      .then(s => saveSessionSummary(s))
      .catch(e => console.warn('[session] 摘要生成失败:', e))
  }

  return Response.json({ ok: true })
}
