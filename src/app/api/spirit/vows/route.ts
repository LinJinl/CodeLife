import { NextRequest, NextResponse } from 'next/server'
import { getVows, upsertVow } from '@/lib/spirit/memory'
import type { Vow } from '@/lib/spirit/memory'

export const dynamic = 'force-dynamic'

export function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get('status') ?? 'active'
  const vows   = getVows()
  const result = status === 'all' ? vows : vows.filter(v => v.status === status)
  return NextResponse.json(result)
}

export async function PATCH(req: NextRequest) {
  const body = await req.json() as {
    id:           string
    status?:      Vow['status']
    subGoalIdx?:  number
    done?:        boolean
  }
  const vows = getVows()
  const vow  = vows.find(v => v.id === body.id)
  if (!vow) return NextResponse.json({ error: 'not found' }, { status: 404 })

  if (body.status !== undefined) {
    vow.status = body.status
  }
  if (body.subGoalIdx !== undefined && body.done !== undefined) {
    const goal = vow.subGoals[body.subGoalIdx]
    if (goal) goal.done = body.done
  }

  upsertVow(vow)
  return NextResponse.json({ ok: true })
}
