/**
 * GET  /api/spirit/session?date=2026-04-07  加载指定日期会话（默认今日）
 * POST /api/spirit/session                  保存完整消息列表
 */

import { NextRequest }                        from 'next/server'
import { getConversation, saveConversation }  from '@/lib/spirit/memory'

export const runtime = 'nodejs'

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get('date') ?? todayStr()
  const conv = getConversation(date)
  return Response.json(conv)
}

export async function POST(req: NextRequest) {
  const body = await req.json() as { messages: { role: string; content: string; timestamp: string }[] }
  const date = todayStr()
  saveConversation({ date, messages: body.messages as never })
  return Response.json({ ok: true })
}
