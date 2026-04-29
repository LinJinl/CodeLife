'use client'

import { useEffect, useMemo, useState } from 'react'
import type { ContextRun, ContextRunSummary } from '@/lib/spirit/context-audit'

type LoadState = 'idle' | 'loading' | 'error'

interface ContextAuditDrawerProps {
  open: boolean
  onClose: () => void
  refreshKey?: string | number
}

export function ContextAuditDrawer({ open, onClose, refreshKey }: ContextAuditDrawerProps) {
  const [runs, setRuns] = useState<ContextRunSummary[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selected, setSelected] = useState<ContextRun | null>(null)
  const [state, setState] = useState<LoadState>('idle')

  useEffect(() => {
    if (!open) return
    void loadRuns()
  }, [open, refreshKey])

  useEffect(() => {
    if (!open || !selectedId) return
    void loadRun(selectedId)
  }, [open, selectedId])

  async function loadRuns() {
    setState('loading')
    try {
      const res = await fetch('/api/spirit/context-runs?limit=12', { cache: 'no-store' })
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json() as { runs?: ContextRunSummary[] }
      const nextRuns = data.runs ?? []
      setRuns(nextRuns)
      setSelectedId(current => current && nextRuns.some(run => run.id === current)
        ? current
        : nextRuns[0]?.id ?? null)
      if (nextRuns.length === 0) setSelected(null)
      setState('idle')
    } catch {
      setState('error')
    }
  }

  async function loadRun(id: string) {
    try {
      const res = await fetch(`/api/spirit/context-runs?id=${encodeURIComponent(id)}`, { cache: 'no-store' })
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json() as { run?: ContextRun }
      setSelected(data.run ?? null)
    } catch {
      setSelected(null)
      setState('error')
    }
  }

  const summary = useMemo(() => selected ? buildPlainSummary(selected) : null, [selected])

  if (!open) return null

  return (
    <div style={OVERLAY} role="dialog" aria-modal="true" aria-label="上下文审计">
      <button onClick={onClose} style={BACKDROP} aria-label="关闭上下文审计" />
      <aside style={DRAWER}>
        <div style={HEADER}>
          <div>
            <div style={EYEBROW}>CONTEXT AUDIT</div>
            <div style={TITLE}>本轮青霄看见了什么</div>
          </div>
          <button onClick={onClose} style={CLOSE}>收起</button>
        </div>

        <div style={INTRO}>
          这里不是调试日志，而是每次回答前实际进入上下文的内容清单：页面、今日对话、长期记忆和工具结果。
        </div>

        <div style={BODY}>
          <div style={LIST}>
            <div style={LIST_HEAD}>
              <span>最近回答</span>
              <button onClick={() => loadRuns()} style={TEXT_BUTTON}>
                {state === 'loading' ? '刷新中' : '刷新'}
              </button>
            </div>
            {state === 'error' && <div style={EMPTY}>读取审计失败</div>}
            {runs.length === 0 && state !== 'loading' ? (
              <div style={EMPTY}>还没有审计记录。完成一次对话后会出现在这里。</div>
            ) : (
              runs.map(run => (
                <button
                  key={run.id}
                  onClick={() => setSelectedId(run.id)}
                  style={{
                    ...RUN_BUTTON,
                    borderColor: run.id === selectedId ? 'var(--gold-line)' : 'var(--ink-trace)',
                    background: run.id === selectedId ? 'var(--surface)' : 'transparent',
                  }}
                >
                  <span style={RUN_TIME}>{formatTime(run.createdAt)}</span>
                  <span style={RUN_TEXT}>{clip(run.userMessage, 72)}</span>
                  <span style={RUN_META}>记忆 {run.prefetchedCount} · 工具 {run.toolCount}</span>
                </button>
              ))
            )}
          </div>

          <main style={DETAIL}>
            {!selected || !summary ? (
              <div style={EMPTY}>选择一条回答查看上下文。</div>
            ) : (
              <>
                <AuditSection title="这次回答的依据">
                  <div style={STACK}>
                    {summary.stack.map(item => (
                      <div key={item.label} style={STACK_ROW}>
                        <div style={STACK_LABEL}>{item.label}</div>
                        <div style={STACK_TEXT}>{item.value}</div>
                      </div>
                    ))}
                  </div>
                </AuditSection>

                <AuditSection title="长期记忆">
                  {selected.memoryGate.items.length === 0 ? (
                    <p style={P}>没有额外带入长期记忆。</p>
                  ) : (
                    <div style={ITEMS}>
                      {selected.memoryGate.items.map(item => (
                        <div key={`${item.type}:${item.id}`} style={ITEM}>
                          <div style={ITEM_HEAD}>
                            {memoryTypeLabel(item.type)}
                            {item.title ? ` · ${item.title}` : ''}
                            {item.date ? ` · ${item.date}` : ''}
                          </div>
                          <div style={P}>{item.summaryPreview}</div>
                          {item.source && <div style={SOURCE}>{item.source}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                </AuditSection>

                <AuditSection title="工具与结果">
                  {selected.tools.length === 0 ? (
                    <p style={P}>没有调用工具，主要依赖对话和记忆直接回答。</p>
                  ) : (
                    <div style={ITEMS}>
                      {selected.tools.map((tool, index) => (
                        <div key={`${tool.name}:${index}`} style={ITEM}>
                          <div style={ITEM_HEAD}>{tool.display ?? tool.name}</div>
                          {tool.desc && <div style={P}>输入：{tool.desc}</div>}
                          {tool.brief && <div style={P}>结果：{tool.brief}</div>}
                          {tool.links?.length ? <div style={SOURCE}>返回链接 {tool.links.length} 个</div> : null}
                        </div>
                      ))}
                    </div>
                  )}
                </AuditSection>

                <AuditSection title="回答预览">
                  <p style={P}>{selected.finalAnswerPreview || '本轮没有文本回答。'}</p>
                </AuditSection>
              </>
            )}
          </main>
        </div>
      </aside>
    </div>
  )
}

function AuditSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={SECTION}>
      <div style={SECTION_TITLE}>{title}</div>
      {children}
    </section>
  )
}

function buildPlainSummary(run: ContextRun) {
  const history = run.todayHistory.selected > 0
    ? `带入今日已保存对话 ${run.todayHistory.selected}/${run.todayHistory.totalSaved} 条${run.todayHistory.summarized ? `，其中 ${run.todayHistory.summarized} 条使用摘要` : ''}${run.todayHistory.truncated ? '，内容被截断' : ''}`
    : '没有带入今日已保存对话'

  return {
    stack: [
      { label: '当前问题', value: run.userMessage || '未知' },
      { label: '页面上下文', value: run.route ? `来自 ${run.route}` : '没有页面上下文' },
      { label: '今日历史', value: history },
      { label: '长期记忆', value: run.memoryGate.items.length > 0 ? `带入 ${run.memoryGate.items.length} 条，类型：${unique(run.memoryGate.items.map(item => memoryTypeLabel(item.type))).join('、')}` : '没有额外带入' },
      { label: '工具范围', value: run.domains.length ? run.domains.map(domainLabel).join('、') : '默认范围' },
      { label: '执行方式', value: run.planner.strategy === 'parallel' ? '拆分为并行任务' : run.planner.strategy === 'sequential' ? '拆分为顺序任务' : '直接回答' },
    ],
  }
}

function unique(items: string[]) {
  return Array.from(new Set(items))
}

function memoryTypeLabel(type: string) {
  const map: Record<string, string> = {
    preference: '偏好',
    skill: '技能卡',
    note: '笔记',
    daily_log: '日志',
    session_summary: '对话摘要',
    weekly_pattern: '周规律',
    vow: '誓愿',
    conversation: '历史对话',
  }
  return map[type] ?? type
}

function domainLabel(domain: string) {
  const map: Record<string, string> = {
    system: '系统',
    knowledge: '知识记忆',
    memory: '记忆读取',
    cultivation: '修炼数据',
    vow: '誓愿',
    meta: '元信息',
    search: '搜索',
    code: '代码',
    debug: '调试',
  }
  return map[domain] ?? domain
}

function clip(text: string, max: number) {
  const normalized = text.replace(/\s+/g, ' ').trim()
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1)}...`
}

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

const OVERLAY: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 10020,
  display: 'flex',
  justifyContent: 'flex-end',
}

const BACKDROP: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  border: 'none',
  background: 'rgba(0, 0, 0, 0.38)',
  cursor: 'pointer',
}

const DRAWER: React.CSSProperties = {
  position: 'relative',
  zIndex: 1,
  width: 'min(920px, calc(100vw - 24px))',
  height: '100%',
  background: 'var(--void)',
  borderLeft: '1px solid var(--gold-line)',
  boxShadow: '-24px 0 70px rgba(0,0,0,0.35)',
  display: 'flex',
  flexDirection: 'column',
}

const HEADER: React.CSSProperties = {
  padding: '22px 24px 16px',
  borderBottom: '1px solid var(--ink-trace)',
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 18,
}

const EYEBROW: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 9,
  color: 'var(--gold-dim)',
  letterSpacing: 2,
  marginBottom: 8,
}

const TITLE: React.CSSProperties = {
  fontFamily: 'var(--font-xiaowei), serif',
  fontSize: 20,
  color: 'var(--gold)',
  letterSpacing: 4,
}

const CLOSE: React.CSSProperties = {
  border: '1px solid var(--ink-trace)',
  background: 'transparent',
  color: 'var(--ink-dim)',
  cursor: 'pointer',
  fontFamily: 'var(--font-serif)',
  fontSize: 12,
  padding: '5px 12px',
  flexShrink: 0,
}

const INTRO: React.CSSProperties = {
  padding: '12px 24px',
  borderBottom: '1px solid var(--ink-trace)',
  color: 'var(--ink-dim)',
  fontFamily: 'var(--font-serif)',
  fontSize: 13,
  lineHeight: 1.7,
}

const BODY: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'grid',
  gridTemplateColumns: '260px minmax(0, 1fr)',
}

const LIST: React.CSSProperties = {
  borderRight: '1px solid var(--ink-trace)',
  overflowY: 'auto',
  padding: 14,
}

const LIST_HEAD: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  color: 'var(--ink-trace)',
  marginBottom: 10,
}

const TEXT_BUTTON: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: 'var(--gold-dim)',
  cursor: 'pointer',
  fontFamily: 'var(--font-serif)',
  fontSize: 12,
}

const RUN_BUTTON: React.CSSProperties = {
  width: '100%',
  display: 'grid',
  gap: 6,
  textAlign: 'left',
  border: '1px solid var(--ink-trace)',
  padding: '10px 11px',
  marginBottom: 9,
  cursor: 'pointer',
}

const RUN_TIME: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 9,
  color: 'var(--ink-trace)',
}

const RUN_TEXT: React.CSSProperties = {
  fontFamily: 'var(--font-serif)',
  fontSize: 12,
  color: 'var(--ink)',
  lineHeight: 1.55,
}

const RUN_META: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 9,
  color: 'var(--jade)',
}

const DETAIL: React.CSSProperties = {
  overflowY: 'auto',
  padding: '22px 26px 42px',
}

const SECTION: React.CSSProperties = {
  marginBottom: 28,
}

const SECTION_TITLE: React.CSSProperties = {
  fontFamily: 'var(--font-xiaowei), serif',
  color: 'var(--ink)',
  fontSize: 15,
  letterSpacing: 3,
  marginBottom: 12,
}

const STACK: React.CSSProperties = {
  display: 'grid',
  borderTop: '1px solid var(--ink-trace)',
}

const STACK_ROW: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '92px 1fr',
  gap: 14,
  padding: '10px 0',
  borderBottom: '1px solid var(--ink-trace)',
}

const STACK_LABEL: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  color: 'var(--ink-trace)',
}

const STACK_TEXT: React.CSSProperties = {
  fontFamily: 'var(--font-serif)',
  fontSize: 13,
  color: 'var(--ink-dim)',
  lineHeight: 1.7,
}

const ITEMS: React.CSSProperties = {
  display: 'grid',
  gap: 10,
}

const ITEM: React.CSSProperties = {
  border: '1px solid var(--ink-trace)',
  background: 'var(--deep)',
  padding: '10px 12px',
}

const ITEM_HEAD: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  color: 'var(--jade)',
  marginBottom: 7,
}

const P: React.CSSProperties = {
  margin: 0,
  fontFamily: 'var(--font-serif)',
  fontSize: 13,
  color: 'var(--ink-dim)',
  lineHeight: 1.8,
}

const SOURCE: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 9,
  color: 'var(--ink-trace)',
  marginTop: 7,
}

const EMPTY: React.CSSProperties = {
  fontFamily: 'var(--font-serif)',
  fontSize: 13,
  color: 'var(--ink-trace)',
  lineHeight: 1.8,
}
