/**
 * GET    /api/spirit/skills   返回全部技能卡（倒序）+ 提炼状态
 * POST   /api/spirit/skills   立即触发技能提炼
 * PATCH  /api/spirit/skills   编辑一张技能卡（title / insight / tags / userNotes）
 * DELETE /api/spirit/skills   删除一张技能卡
 */

import { NextRequest, NextResponse }    from 'next/server'
import { getSkills, replaceSkills } from '@/lib/spirit/memory'
import { shouldExtractSkills }           from '@/lib/spirit/skill-extractor'
import config                            from '../../../../../codelife.config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function GET() {
  const cards  = getSkills()
  const sorted = [...cards].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  // 最近一次提炼日期
  const lastExtracted = sorted.length > 0 ? sorted[0].sourceDate : null
  return NextResponse.json({
    cards,               // 保持原顺序（前端自行排序）
    total:     sorted.length,
    needsSync: shouldExtractSkills(),
    lastExtracted,
  })
}

export async function POST() {
  if (!config.spirit?.enabled || !config.spirit.apiKey) {
    return NextResponse.json({ error: '器灵未开启' }, { status: 403 })
  }

  const { extractSkills }        = await import('@/lib/spirit/skill-extractor')
  const { buildChatModel,
          invalidateAgentCache } = await import('@/lib/spirit/langgraph/agents')

  const model  = buildChatModel(config.spirit.reflectModel ?? config.spirit.model)
  const result = await extractSkills(14, model)
  invalidateAgentCache()

  return NextResponse.json({ ok: true, total: result.cards.length, newCount: result.newCount })
}

export async function PATCH(req: NextRequest) {
  const body = await req.json() as {
    id:          string
    title?:      string
    insight?:    string
    body?:       string
    tags?:       string[]
    userNotes?:  string
  }

  const cards = getSkills()
  const idx   = cards.findIndex(c => c.id === body.id)
  if (idx < 0) return NextResponse.json({ error: 'not found' }, { status: 404 })

  cards[idx] = {
    ...cards[idx],
    ...(body.title     !== undefined && { title:     body.title }),
    ...(body.insight   !== undefined && { insight:   body.insight }),
    ...(body.body      !== undefined && { body:      body.body }),
    ...(body.tags      !== undefined && { tags:      body.tags }),
    ...(body.userNotes !== undefined && { userNotes: body.userNotes }),
    editedAt: new Date().toISOString(),
  }
  replaceSkills(cards)
  return NextResponse.json({ ok: true, card: cards[idx] })
}

export async function DELETE(req: NextRequest) {
  const body = await req.json() as { id: string }
  const cards = getSkills()
  const idx   = cards.findIndex(c => c.id === body.id)
  if (idx < 0) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const [removed] = cards.splice(idx, 1)
  replaceSkills(cards)
  return NextResponse.json({ ok: true, title: removed.title })
}
