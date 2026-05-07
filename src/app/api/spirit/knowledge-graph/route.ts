import { NextRequest, NextResponse } from 'next/server'
import { buildKnowledgeGraph, filterKnowledgeGraph, type KnowledgeNodeType } from '@/lib/spirit/knowledge-graph'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const graph = filterKnowledgeGraph(buildKnowledgeGraph(), {
    type: (searchParams.get('type') || undefined) as KnowledgeNodeType | undefined,
    q: searchParams.get('q') || undefined,
    limit: Number(searchParams.get('limit') || 120),
  })
  return NextResponse.json(graph)
}

export async function POST() {
  return NextResponse.json(buildKnowledgeGraph())
}
