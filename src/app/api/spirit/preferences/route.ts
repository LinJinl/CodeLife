/**
 * GET    /api/spirit/preferences   返回全部偏好（按置信度倒序）
 * POST   /api/spirit/preferences   立即触发偏好提炼
 * PATCH  /api/spirit/preferences   编辑一条偏好（description / confidence / counterEvidence）
 * DELETE /api/spirit/preferences   删除一条偏好
 */

import { NextRequest, NextResponse }  from 'next/server'
import { getPreferences, savePreferences } from '@/lib/spirit/memory'
import config                              from '../../../../../codelife.config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function GET() {
  const prefs  = getPreferences()
  const sorted = [...prefs].sort((a, b) => b.confidence - a.confidence)
  return NextResponse.json({ prefs: sorted, total: sorted.length })
}

export async function POST() {
  if (!config.spirit?.enabled || !config.spirit.apiKey) {
    return NextResponse.json({ error: '器灵未开启' }, { status: 403 })
  }

  const { extractPreferences }        = await import('@/lib/spirit/preference-extractor')
  const { buildChatModel,
          invalidateAgentCache }       = await import('@/lib/spirit/langgraph/agents')

  const model  = buildChatModel(config.spirit.reflectModel ?? config.spirit.model)
  const result = await extractPreferences(14, model)
  invalidateAgentCache()

  return NextResponse.json({ ok: true, total: result.totalCount, changedCount: result.changedCount })
}

export async function PATCH(req: NextRequest) {
  const body = await req.json() as {
    id:               string
    description?:     string
    confidence?:      number
    counterEvidence?: string
  }

  const prefs = getPreferences()
  const idx   = prefs.findIndex(p => p.id === body.id)
  if (idx < 0) return NextResponse.json({ error: 'not found' }, { status: 404 })

  prefs[idx] = {
    ...prefs[idx],
    ...(body.description     !== undefined && { description:     body.description }),
    ...(body.confidence      !== undefined && { confidence:      Math.min(1, Math.max(0, body.confidence)) }),
    ...(body.counterEvidence !== undefined && { counterEvidence: body.counterEvidence }),
    updatedAt: new Date().toISOString(),
  }
  savePreferences(prefs)
  return NextResponse.json({ ok: true, pref: prefs[idx] })
}

export async function DELETE(req: NextRequest) {
  const body = await req.json() as { id: string }
  const prefs = getPreferences()
  const idx   = prefs.findIndex(p => p.id === body.id)
  if (idx < 0) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const [removed] = prefs.splice(idx, 1)
  savePreferences(prefs)
  return NextResponse.json({ ok: true, key: removed.key })
}
