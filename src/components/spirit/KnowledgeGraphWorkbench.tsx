'use client'

import dynamic from 'next/dynamic'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { KnowledgeEdge, KnowledgeGraph, KnowledgeNode, KnowledgeNodeType } from '@/lib/spirit/knowledge-graph'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), { ssr: false }) as any

type FGNode = KnowledgeNode & { x?: number; y?: number; vx?: number; vy?: number }
type FGLink = { source: string | FGNode; target: string | FGNode; label: string; confidence: number; type: KnowledgeEdge['type'] }

const TYPE_LABEL: Record<KnowledgeNodeType, string> = {
  capability_domain: '能力方向',
  capability: '能力点',
  blog: '博客',
}

const TYPE_COLOR: Record<KnowledgeNodeType, string> = {
  capability_domain: '#d4a843',
  capability: '#4a9b72',
  blog: '#6f92b8',
}

const TYPES = Object.keys(TYPE_LABEL) as KnowledgeNodeType[]

export function KnowledgeGraphWorkbench({ graph }: { graph: KnowledgeGraph }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const fgRef = useRef<any>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [query, setQuery] = useState('')
  const [enabledTypes, setEnabledTypes] = useState<Set<KnowledgeNodeType>>(() => new Set(TYPES))
  const [selectedId, setSelectedId] = useState(graph.nodes[0]?.id ?? '')
  const [hovered, setHovered] = useState<KnowledgeNode | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const update = () => setSize({ w: el.offsetWidth, h: el.offsetHeight })
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase()
    const nodes = graph.nodes.filter(node =>
      enabledTypes.has(node.type) &&
      (!text || `${node.title} ${node.summary} ${node.tags.join(' ')}`.toLowerCase().includes(text))
    )
    const ids = new Set(nodes.map(node => node.id))
    const edges = graph.edges.filter(edge => ids.has(edge.from) && ids.has(edge.to))
    return { nodes, edges }
  }, [graph, enabledTypes, query])

  const selected = filtered.nodes.find(node => node.id === selectedId) ?? filtered.nodes[0] ?? null
  const typeCounts = useMemo(() => {
    const counts = new Map<KnowledgeNodeType, number>()
    for (const type of TYPES) counts.set(type, 0)
    for (const node of filtered.nodes) counts.set(node.type, (counts.get(node.type) ?? 0) + 1)
    return counts
  }, [filtered.nodes])
  const related = selected
    ? filtered.edges
        .filter(edge => edge.from === selected.id || edge.to === selected.id)
        .slice(0, 14)
        .map(edge => {
          const otherId = edge.from === selected.id ? edge.to : edge.from
          const other = filtered.nodes.find(node => node.id === otherId)
          return other ? { edge, node: other } : null
        })
        .filter((item): item is { edge: KnowledgeEdge; node: KnowledgeNode } => Boolean(item))
    : []

  const graphData = useMemo(() => ({
    nodes: filtered.nodes.map(node => ({ ...node })) as FGNode[],
    links: filtered.edges.map(edge => ({
      source: edge.from,
      target: edge.to,
      label: edge.label,
      confidence: edge.confidence,
      type: edge.type,
    })) as FGLink[],
  }), [filtered])

  useEffect(() => {
    fgRef.current?.d3ReheatSimulation?.()
  }, [graphData])

  useEffect(() => {
    return () => {
      fgRef.current?.pauseAnimation?.()
    }
  }, [])

  function toggleType(type: KnowledgeNodeType) {
    setEnabledTypes(prev => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }

  function nodeColor(node: KnowledgeNode) {
    return TYPE_COLOR[node.type] ?? '#d4a843'
  }

  function paintNode(node: FGNode, ctx: CanvasRenderingContext2D) {
    const isSelected = node.id === selected?.id
    const isHovered = node.id === hovered?.id
    const r = Math.max(3, Math.min(10, 3 + Math.sqrt(node.weight || 1)))
    const x = node.x ?? 0
    const y = node.y ?? 0

    ctx.beginPath()
    ctx.arc(x, y, isSelected ? r + 3 : isHovered ? r + 2 : r, 0, Math.PI * 2)
    ctx.fillStyle = nodeColor(node)
    ctx.globalAlpha = isSelected ? 1 : isHovered ? 0.95 : 0.78
    ctx.fill()
    ctx.globalAlpha = 1

    if (isSelected) {
      ctx.beginPath()
      ctx.arc(x, y, r + 6, 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(212, 168, 67, 0.68)'
      ctx.lineWidth = 1.3
      ctx.stroke()
    }

    if (isSelected || isHovered || node.weight >= 7) {
      ctx.font = "10px 'Noto Serif SC', serif"
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillStyle = '#d7cbb4'
      ctx.globalAlpha = isSelected ? 0.95 : 0.7
      ctx.fillText(node.title.slice(0, 18), x, y + r + 5)
      ctx.globalAlpha = 1
    }
  }

  function paintPointer(node: FGNode, color: string, ctx: CanvasRenderingContext2D) {
    ctx.beginPath()
    ctx.arc(node.x ?? 0, node.y ?? 0, 14, 0, Math.PI * 2)
    ctx.fillStyle = color
    ctx.fill()
  }

  return (
    <div style={SHELL}>
      <aside style={FILTERS}>
        <div style={PANEL_TITLE}>筛选</div>
        <input
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="搜索节点"
          style={SEARCH}
        />
        <div style={{ display: 'grid', gap: 8 }}>
          {TYPES.map(type => (
            <label key={type} style={CHECK_ROW}>
              <input
                type="checkbox"
                checked={enabledTypes.has(type)}
                onChange={() => toggleType(type)}
              />
              <span style={{ ...LEGEND_DOT, background: TYPE_COLOR[type] }} />
              <span style={{ flex: 1 }}>{TYPE_LABEL[type]}</span>
              <span style={COUNT}>{typeCounts.get(type) ?? 0}</span>
            </label>
          ))}
        </div>
        <div style={META}>
          当前 {filtered.nodes.length} 个节点，{filtered.edges.length} 条关系
        </div>
      </aside>

      <main ref={containerRef} style={CANVAS}>
        <div style={CANVAS_HINT}>
          {hovered ? (
            <>
              <span style={{ ...HINT_DOT, background: TYPE_COLOR[hovered.type] }} />
              <span style={HINT_TITLE}>{TYPE_LABEL[hovered.type]} · {hovered.title}</span>
              {hovered.date && <span style={HINT_META}>{hovered.date}</span>}
            </>
          ) : (
            <span>悬浮查看类型和标题，点击能力点查看关联博文</span>
          )}
        </div>
        {size.w > 0 && filtered.nodes.length > 0 ? (
          <ForceGraph2D
            ref={fgRef}
            graphData={graphData}
            width={size.w}
            height={size.h}
            backgroundColor="transparent"
            nodeCanvasObject={paintNode}
            nodeCanvasObjectMode={() => 'replace'}
            nodePointerAreaPaint={paintPointer}
            linkColor={(link: FGLink) => link.type === 'contains' ? 'rgba(212,168,67,0.25)' : 'rgba(74,155,114,0.25)'}
            linkWidth={(link: FGLink) => Math.max(0.4, Math.min(2, link.confidence * 1.7))}
            linkDirectionalParticles={0}
            nodeLabel={(node: FGNode) => `${TYPE_LABEL[node.type]}｜${node.title}${node.date ? `｜${node.date}` : ''}`}
            autoPauseRedraw
            onNodeClick={(node: FGNode) => setSelectedId(node.id)}
            onNodeHover={(node: FGNode | null) => setHovered(node)}
            enableZoomInteraction
            enablePanInteraction
            cooldownTicks={90}
            d3AlphaDecay={0.025}
            d3VelocityDecay={0.34}
          />
        ) : (
          <div style={EMPTY}>没有匹配节点</div>
        )}
      </main>

      <aside style={DETAIL}>
        {selected ? (
          <NodeDetail node={selected} related={related} onSelect={setSelectedId} />
        ) : (
          <div style={EMPTY}>选择一个节点查看详情</div>
        )}
      </aside>
    </div>
  )
}

function NodeDetail({
  node,
  related,
  onSelect,
}: {
  node: KnowledgeNode
  related: { edge: KnowledgeEdge; node: KnowledgeNode }[]
  onSelect: (id: string) => void
}) {
  const sourceHref = node.source.startsWith('/') ? node.source : ''

  return (
    <div>
      <div style={NODE_TYPE}>{TYPE_LABEL[node.type]} {node.date ? `· ${node.date}` : ''}</div>
      <h3 style={NODE_TITLE}>{node.title}</h3>
      <p style={P}>{node.summary}</p>

      {node.tags.length > 0 && (
        <div style={TAGS}>
          {node.tags.slice(0, 8).map(tag => <span key={tag} style={TAG}>{tag}</span>)}
        </div>
      )}

      <div style={SOURCE}>
        来源：{sourceHref ? <a href={sourceHref} style={LINK}>{node.source}</a> : node.source}
      </div>

      <div style={{ marginTop: 22 }}>
        <div style={PANEL_TITLE}>{node.type === 'capability' ? '关联博文' : node.type === 'capability_domain' ? '能力点' : '关联能力'}</div>
        {related.length === 0 ? (
          <p style={P}>暂无关联。</p>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {related.map(({ edge, node: other }) => (
              <button key={`${edge.id}:${other.id}`} onClick={() => onSelect(other.id)} style={RELATED}>
                <span style={RELATED_TITLE}>{other.title}</span>
                <span style={RELATED_META}>{edge.label} · {TYPE_LABEL[other.type]}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

const SHELL: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(190px, 220px) minmax(360px, 1fr) minmax(260px, 300px)',
  minHeight: 620,
  border: '1px solid var(--ink-trace)',
  background: 'var(--deep)',
  overflowX: 'auto',
}

const FILTERS: React.CSSProperties = {
  borderRight: '1px solid var(--ink-trace)',
  padding: 16,
  overflow: 'auto',
}

const CANVAS: React.CSSProperties = {
  position: 'relative',
  minHeight: 620,
  background: 'radial-gradient(circle at center, rgba(212,168,67,0.045), transparent 58%)',
}

const CANVAS_HINT: React.CSSProperties = {
  position: 'absolute',
  zIndex: 2,
  top: 14,
  left: 14,
  right: 14,
  minHeight: 34,
  border: '1px solid rgba(212, 168, 67, 0.36)',
  background: 'rgba(8, 8, 7, 0.92)',
  backdropFilter: 'blur(8px)',
  color: '#e4dcc8',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '7px 10px',
  fontFamily: 'var(--font-serif)',
  fontSize: 12,
  lineHeight: 1.5,
  pointerEvents: 'none',
  boxSizing: 'border-box',
}

const HINT_DOT: React.CSSProperties = {
  width: 10,
  height: 10,
  borderRadius: '50%',
  flexShrink: 0,
  display: 'inline-block',
}

const HINT_TITLE: React.CSSProperties = {
  color: '#f0e6cf',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}

const HINT_META: React.CSSProperties = {
  marginLeft: 'auto',
  color: '#b8aa8c',
  fontFamily: 'var(--font-mono)',
  fontSize: 9,
  flexShrink: 0,
}

const DETAIL: React.CSSProperties = {
  borderLeft: '1px solid var(--ink-trace)',
  padding: 18,
  overflow: 'auto',
  position: 'relative',
}

const PANEL_TITLE: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  letterSpacing: 2,
  color: 'var(--gold-dim)',
  marginBottom: 12,
}

const SEARCH: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  marginBottom: 14,
  border: '1px solid var(--ink-trace)',
  background: 'var(--void)',
  color: 'var(--ink)',
  padding: '7px 9px',
  fontFamily: 'var(--font-serif)',
  fontSize: 12,
  outline: 'none',
}

const CHECK_ROW: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontFamily: 'var(--font-serif)',
  fontSize: 12,
  color: 'var(--ink-dim)',
  cursor: 'pointer',
}

const LEGEND_DOT: React.CSSProperties = {
  width: 10,
  height: 10,
  borderRadius: '50%',
  flexShrink: 0,
  display: 'inline-block',
}

const COUNT: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 9,
  color: 'var(--ink-trace)',
  minWidth: 18,
  textAlign: 'right',
}

const META: React.CSSProperties = {
  marginTop: 18,
  fontFamily: 'var(--font-mono)',
  fontSize: 9,
  color: 'var(--ink-trace)',
  lineHeight: 1.7,
}

const EMPTY: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontFamily: 'var(--font-serif)',
  color: 'var(--ink-trace)',
  fontSize: 13,
}

const NODE_TYPE: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  color: 'var(--jade)',
  marginBottom: 10,
}

const NODE_TITLE: React.CSSProperties = {
  fontFamily: 'var(--font-serif)',
  fontSize: 18,
  color: 'var(--ink)',
  lineHeight: 1.45,
  margin: '0 0 12px',
}

const P: React.CSSProperties = {
  fontFamily: 'var(--font-serif)',
  fontSize: 13,
  color: 'var(--ink-dim)',
  lineHeight: 1.85,
  margin: 0,
}

const TAGS: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
  marginTop: 12,
}

const TAG: React.CSSProperties = {
  border: '1px solid var(--ink-trace)',
  color: 'var(--ink-dim)',
  fontFamily: 'var(--font-mono)',
  fontSize: 9,
  padding: '2px 6px',
}

const SOURCE: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 9,
  color: 'var(--ink-trace)',
  marginTop: 12,
  lineHeight: 1.7,
  wordBreak: 'break-word',
}

const LINK: React.CSSProperties = {
  color: 'var(--gold-dim)',
  textDecoration: 'none',
  borderBottom: '1px solid var(--gold-line)',
}

const RELATED: React.CSSProperties = {
  border: '1px solid var(--ink-trace)',
  background: 'var(--void)',
  padding: '8px 10px',
  textAlign: 'left',
  cursor: 'pointer',
  display: 'grid',
  gap: 4,
}

const RELATED_TITLE: React.CSSProperties = {
  fontFamily: 'var(--font-serif)',
  fontSize: 12,
  color: 'var(--ink)',
  lineHeight: 1.45,
}

const RELATED_META: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 9,
  color: 'var(--ink-trace)',
}
