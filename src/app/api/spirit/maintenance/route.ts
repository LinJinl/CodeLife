import { NextRequest, NextResponse } from 'next/server'
import { buildChatModel } from '@/lib/spirit/langgraph/agents'
import { clearExtractorCursor, type ExtractorName } from '@/lib/spirit/memory'
import { extractPreferences } from '@/lib/spirit/preference-extractor'
import { extractSkills } from '@/lib/spirit/skill-extractor'
import { refreshBlogPostsCache } from '@/lib/spirit/blog-cache'
import config from '../../../../../codelife.config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type MaintenanceAction =
  | 'extract_skills'
  | 'extract_preferences'
  | 'reset_cursor'
  | 'refresh_blog_cache'

function parseTarget(value: unknown): ExtractorName | undefined {
  return value === 'skills' || value === 'preferences' ? value : undefined
}

export async function POST(req: NextRequest) {
  let body: { action?: MaintenanceAction; target?: string; force?: boolean; days?: number }
  try {
    body = await req.json() as typeof body
  } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 })
  }

  try {
    if (body.action === 'reset_cursor') {
      const target = parseTarget(body.target)
      clearExtractorCursor(target)
      return NextResponse.json({ ok: true, action: body.action, target: target ?? 'all' })
    }

    if (body.action === 'refresh_blog_cache') {
      const result = await refreshBlogPostsCache({ includeContent: true, forceContent: body.force, concurrency: 3 })
      return NextResponse.json({ ok: true, action: body.action, result })
    }

    if (!config.spirit?.enabled || !config.spirit.apiKey) {
      return NextResponse.json({ error: '器灵未开启' }, { status: 403 })
    }

    const model = buildChatModel(config.spirit.reflectModel ?? config.spirit.model)
    const days = Math.max(1, Math.min(body.days ?? 14, 60))

    if (body.action === 'extract_skills') {
      if (body.force) clearExtractorCursor('skills')
      const result = await extractSkills(days, model)
      return NextResponse.json({ ok: true, action: body.action, result })
    }

    if (body.action === 'extract_preferences') {
      if (body.force) clearExtractorCursor('preferences')
      const result = await extractPreferences(days, model)
      return NextResponse.json({ ok: true, action: body.action, result })
    }

    return NextResponse.json({ error: 'unsupported action' }, { status: 400 })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
