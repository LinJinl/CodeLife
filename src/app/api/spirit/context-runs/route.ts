import { NextRequest, NextResponse } from 'next/server'
import { deleteContextRun, getContextRun, listContextRuns } from '@/lib/spirit/context-audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id')
  if (id) {
    const run = getContextRun(id)
    if (!run) return NextResponse.json({ error: 'not found' }, { status: 404 })
    return NextResponse.json({ run })
  }
  const limit = Number(req.nextUrl.searchParams.get('limit') ?? 50)
  return NextResponse.json({ runs: listContextRuns(Math.max(1, Math.min(limit, 200))) })
}

export function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const ok = deleteContextRun(id)
  if (!ok) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
