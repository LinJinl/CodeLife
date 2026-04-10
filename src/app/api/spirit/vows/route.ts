import { NextResponse }  from 'next/server'
import { getActiveVows } from '@/lib/spirit/memory'

export const dynamic = 'force-dynamic'

export function GET() {
  const vows = getActiveVows()
  return NextResponse.json(vows)
}
