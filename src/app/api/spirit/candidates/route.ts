import { NextRequest, NextResponse } from 'next/server'
import {
  getCandidates,
  promoteCandidate,
  updateCandidateStatus,
  type MemoryCandidateStatus,
} from '@/lib/spirit/candidate-memory'
import { dateInTZ } from '@/lib/spirit/time'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const date = searchParams.get('date') ?? dateInTZ()
  const status = searchParams.get('status') as MemoryCandidateStatus | null
  let candidates = getCandidates(date)
  if (status) candidates = candidates.filter(candidate => candidate.status === status)
  return NextResponse.json({ date, candidates, total: candidates.length })
}

export async function POST(req: NextRequest) {
  let body: { id?: string; action?: 'promote' | 'ignore' | 'merge' }
  try {
    body = await req.json() as { id?: string; action?: 'promote' | 'ignore' | 'merge' }
  } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 })
  }
  if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  try {
    if (body.action === 'promote') {
      const candidate = promoteCandidate(body.id)
      return NextResponse.json({ ok: true, candidate })
    }
    if (body.action === 'ignore' || body.action === 'merge') {
      const candidate = updateCandidateStatus(body.id, body.action === 'ignore' ? 'ignored' : 'merged')
      return NextResponse.json({ ok: true, candidate })
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const status = message.includes('not found') ? 404 : 400
    return NextResponse.json({ error: message }, { status })
  }

  return NextResponse.json({ error: 'unsupported action' }, { status: 400 })
}
