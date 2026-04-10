'use client'

import { useRef, useCallback, useState, useEffect } from 'react'
import dynamic                                       from 'next/dynamic'
import { useRouter }                                 from 'next/navigation'
import type { SkillGraph, SkillNode, SkillGroup }    from '@/lib/gongfa/types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), { ssr: false }) as any

// ─── 配色：明度高、在深色背景上清晰可辨 ────────────────────────
const DARK: Record<SkillGroup, string> = {
  category: '#F2B83C',   // 琥珀金
  tag:      '#30CCA2',   // 青碧
  algo:     '#F07060',   // 珊瑚红
  language: '#AC80FA',   // 星紫
}
const LIGHT: Record<SkillGroup, string> = {
  category: '#9A6C08',
  tag:      '#0A7A50',
  algo:     '#A82018',
  language: '#5820C0',
}

const GROUP_NAME: Record<SkillGroup, string> = {
  category: '技术分类',
  tag:      '知识标签',
  algo:     '算法专项',
  language: '编程语言',
}

// 四象限聚类目标位置（相对于画布，0~1）
const QUADRANT: Record<SkillGroup, [number, number]> = {
  category: [0.27, 0.30],
  tag:      [0.73, 0.30],
  algo:     [0.27, 0.70],
  language: [0.73, 0.70],
}

// ─── Tooltip ──────────────────────────────────────────────────────
function Tooltip({ node, mx, my }: { node: SkillNode; mx: number; my: number }) {
  const right = mx > window.innerWidth * 0.55
  return (
    <div style={{
      position: 'fixed',
      left:  right ? undefined : mx + 14,
      right: right ? window.innerWidth - mx + 14 : undefined,
      top:   Math.max(8, my - 10),
      maxWidth: 250, zIndex: 9999,
      background: 'var(--deep)',
      border: '1px solid var(--ink-trace)',
      padding: '8px 12px',
      pointerEvents: 'none',
      boxShadow: '0 2px 18px rgba(0,0,0,0.55)',
    }}>
      <div style={{ display:'flex', alignItems:'baseline', gap:7, marginBottom:5 }}>
        <span style={{ fontFamily:'var(--font-xiaowei),serif', fontSize:13, color:'var(--gold)', letterSpacing:2 }}>
          {node.name}
        </span>
        <span style={{ fontFamily:'var(--font-mono)', fontSize:8, color:'var(--ink-trace)' }}>
          {GROUP_NAME[node.group]}
        </span>
        {node.url && <span style={{ fontFamily:'var(--font-mono)', fontSize:8, color:'var(--jade)', marginLeft:'auto' }}>阅览 →</span>}
      </div>
      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
        <div style={{ flex:1, height:1, background:'var(--ink-trace)' }}>
          <div style={{ height:'100%', width:`${node.weight}%`, background:'var(--gold-dim)' }}/>
        </div>
        <span style={{ fontFamily:'var(--font-mono)', fontSize:8, color:'var(--ink-dim)' }}>{node.rawCount} 条</span>
      </div>
      {node.sources.slice(0,5).map((s,i) => (
        <div key={i} style={{ display:'flex', gap:5, alignItems:'baseline', marginBottom:2 }}>
          <span style={{ fontFamily:'var(--font-mono)', fontSize:8, flexShrink:0, color: s.type==='blog' ? 'var(--jade)' : 'var(--seal)' }}>
            {s.type==='blog' ? '著' : '铸'}
          </span>
          <span style={{ fontFamily:'var(--font-serif)', fontSize:10, color:'var(--ink-mid)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flex:1 }}>
            {s.title}
          </span>
          <span style={{ fontFamily:'var(--font-mono)', fontSize:8, color:'var(--ink-trace)', flexShrink:0 }}>{s.date}</span>
        </div>
      ))}
      {node.sources.length > 5 && (
        <div style={{ fontFamily:'var(--font-serif)', fontSize:8, color:'var(--ink-trace)', marginTop:2 }}>…另 {node.sources.length-5} 条</div>
      )}
    </div>
  )
}

// ─── Legend ───────────────────────────────────────────────────────
function Legend({ isLight }: { isLight: boolean }) {
  const pal = isLight ? LIGHT : DARK
  return (
    <div style={{ position:'absolute', bottom:18, left:18, display:'flex', flexDirection:'column', gap:6 }}>
      {(Object.keys(GROUP_NAME) as SkillGroup[]).map(g => (
        <div key={g} style={{ display:'flex', alignItems:'center', gap:8 }}>
          <div style={{ width:5, height:5, borderRadius:'50%', background:pal[g], flexShrink:0 }}/>
          <span style={{ fontFamily:'var(--font-serif)', fontSize:9, color:'var(--ink-dim)', letterSpacing:1 }}>
            {GROUP_NAME[g]}
          </span>
        </div>
      ))}
      <div style={{ fontFamily:'var(--font-serif)', fontSize:8, color:'var(--ink-trace)', letterSpacing:1, marginTop:1 }}>
        滚轮缩放　·　拖动平移
      </div>
    </div>
  )
}

// ─── 主组件 ───────────────────────────────────────────────────────
type FGNode = SkillNode & { x?: number; y?: number; vx?: number; vy?: number }
type FGLink = { source: string; target: string; weight: number }

export default function SkillGraph({ graph }: { graph: SkillGraph }) {
  const router       = useRouter()
  const containerRef = useRef<HTMLDivElement>(null)
  const fgRef        = useRef<any>(null)
  const [size,    setSize]    = useState({ w: 0, h: 0 })
  const [hovered, setHovered] = useState<SkillNode | null>(null)
  const [mouse,   setMouse]   = useState({ x: 0, y: 0 })
  const [isLight, setIsLight] = useState(false)

  useEffect(() => {
    const el = containerRef.current; if (!el) return
    const update = () => setSize({ w: el.offsetWidth, h: el.offsetHeight })
    update()
    const ro = new ResizeObserver(update); ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const sync = () => setIsLight(document.documentElement.dataset.theme === 'light')
    sync()
    const ob = new MutationObserver(sync)
    ob.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => ob.disconnect()
  }, [])

  // 稳定引用，物理引擎不会因重渲染而重置
  const gData = useRef({
    nodes: graph.nodes.map(n => ({ ...n })) as FGNode[],
    links: graph.edges.map(e => ({ source: e.source, target: e.target, weight: e.weight })) as FGLink[],
  }).current

  // ─── 四象限聚类力 ────────────────────────────────────────────────
  useEffect(() => {
    if (!fgRef.current || !size.w || !size.h) return
    const { w, h } = size

    // 添加自定义聚类力：同组节点向对应象限聚拢
    fgRef.current.d3Force('cluster', (alpha: number) => {
      for (const node of gData.nodes) {
        const [fx, fy] = QUADRANT[node.group as SkillGroup] ?? [0.5, 0.5]
        node.vx! += (fx * w - (node.x ?? w / 2)) * 0.04 * alpha
        node.vy! += (fy * h - (node.y ?? h / 2)) * 0.04 * alpha
      }
    })

    // 取消默认中心力，让四象限力接管整体分布
    fgRef.current.d3Force('center', null)
    fgRef.current.d3ReheatSimulation()
  }, [size.w, size.h, gData])

  // ─── 极小星点绘制 ─────────────────────────────────────────────────
  const paintNode = useCallback((node: FGNode, ctx: CanvasRenderingContext2D) => {
    const pal = isLight ? LIGHT : DARK
    const col = pal[node.group] ?? pal.tag
    const hi  = hovered?.id === node.id
    const x   = node.x ?? 0
    const y   = node.y ?? 0

    // 点半径：极小，权重轻微影响大小
    const r = 1.8 + Math.sqrt(node.weight) * 0.14  // 约 1.8 ~ 3.2px

    // 星点本体
    ctx.beginPath()
    ctx.arc(x, y, hi ? r + 1 : r, 0, Math.PI * 2)
    ctx.fillStyle = hi ? (isLight ? '#000000' : '#FFFFFF') : col
    ctx.globalAlpha = hi ? 1 : 0.85
    ctx.fill()
    ctx.globalAlpha = 1

    // 标签：平时极淡，hover 时亮起
    ctx.font         = `9px 'Noto Serif SC', serif`
    ctx.textAlign    = 'center'
    ctx.textBaseline = 'top'
    ctx.fillStyle    = isLight ? '#1A1208' : '#C8B880'
    ctx.globalAlpha  = hi ? 0.90 : 0.28
    ctx.fillText(node.name, x, y + (hi ? r + 1 : r) + 3)
    ctx.globalAlpha  = 1
  }, [hovered, isLight])

  // 鼠标命中区：比视觉元素大，便于点击/悬停
  const paintPointer = useCallback((node: FGNode, color: string, ctx: CanvasRenderingContext2D) => {
    ctx.beginPath()
    ctx.arc(node.x ?? 0, node.y ?? 0, 12, 0, Math.PI * 2)
    ctx.fillStyle = color; ctx.fill()
  }, [])

  return (
    <div
      ref={containerRef}
      style={{ position:'relative', width:'100%', height:'100%' }}
      onMouseMove={e => setMouse({ x: e.clientX, y: e.clientY })}
    >
      {size.w > 0 && (
        <ForceGraph2D
          ref={fgRef}
          graphData={gData}
          width={size.w}
          height={size.h}
          backgroundColor="transparent"

          // 节点
          nodeCanvasObject={paintNode}
          nodeCanvasObjectMode={() => 'replace'}
          nodePointerAreaPaint={paintPointer}
          nodeLabel=""

          // 经络线：可见但克制
          linkColor={() => isLight ? 'rgba(60,45,15,0.25)' : 'rgba(210,188,110,0.20)'}
          linkWidth={(l: FGLink) => 0.5 + Math.min((l.weight || 1) * 0.15, 1.2)}
          linkCurvature={0}
          linkDirectionalParticles={0}

          // 交互
          onNodeClick={(n: FGNode) => { if (n.url) router.push(n.url) }}
          onNodeHover={(n: FGNode | null) => {
            setHovered(n ?? null)
            if (containerRef.current)
              containerRef.current.style.cursor = n?.url ? 'pointer' : 'default'
          }}
          enableZoomInteraction
          enablePanInteraction

          // 物理
          warmupTicks={100}
          cooldownTicks={200}
          d3AlphaDecay={0.018}
          d3VelocityDecay={0.35}
          d3AlphaMin={0.002}
        />
      )}

      <Legend isLight={isLight} />
      {hovered && <Tooltip node={hovered} mx={mouse.x} my={mouse.y} />}
    </div>
  )
}
