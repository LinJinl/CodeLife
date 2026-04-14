'use client'

import { useState, useRef, useEffect, useCallback, memo } from 'react'
import { useRouter } from 'next/navigation'
import ReactMarkdown from 'react-markdown'
import { MessageItem } from './spirit/MessageItem'
import { useSpiritChat } from './spirit/useSpiritChat'
import type { Message } from './spirit/types'
import type { SkillCardData } from '@/lib/spirit/protocol'

// ── 偏好类型（与 memory.ts 保持一致，不引入服务端模块）────────────────
interface PrefItem {
  id:               string
  category:         string
  key:              string
  description:      string
  confidence:       number
  evidence:         string[]
  counterEvidence?: string
  lastSeen:         string
  updatedAt:        string
}

const PREF_CATEGORY_LABEL: Record<string, string> = {
  learning:      '学习',
  technical:     '技术',
  communication: '沟通',
  work:          '节律',
}

function todayStr() { return new Date().toISOString().slice(0, 10) }

/** 日期标签显示：今日 / 昨日 / M/D */
function dateLabel(date: string): string {
  const today = todayStr()
  if (date === today) return '今日'
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1)
  if (date === yesterday.toISOString().slice(0, 10)) return '昨日'
  const [, m, d] = date.split('-')
  return `${parseInt(m)}/${parseInt(d)}`
}

// ── 消息列表（memo 隔离，避免 SSE 每个片段都触发整个 SpiritWidget 重渲染）──
const ChatMessageList = memo(function ChatMessageList({
  messages, isToday, loading, phase, pastLoading, bottomRef, onPermission,
}: {
  messages:    import('./spirit/types').Message[]
  isToday:     boolean
  loading:     boolean
  phase:       'idle' | 'thinking' | 'tooling' | 'replying'
  pastLoading: boolean
  bottomRef:   React.RefObject<HTMLDivElement | null>
  onPermission: (msgIdx: number, decision: 'once' | 'session' | 'deny', token: string) => void
}) {
  return (
    <>
      {pastLoading && (
        <div style={{
          textAlign: 'center', paddingTop: 48,
          fontFamily: 'var(--font-serif)', fontSize: 12,
          color: 'var(--ink-trace)', letterSpacing: 2,
        }}>
          读取中…
        </div>
      )}
      {!pastLoading && messages.length === 0 && (
        <div style={{
          fontFamily: 'var(--font-serif)', fontSize: 13, color: 'var(--ink-dim)',
          letterSpacing: 2, textAlign: 'center', marginTop: 72, lineHeight: 3,
        }}>
          {isToday ? (
            <>器灵在此<br/>
              <span style={{ fontSize: 10, color: 'var(--ink-trace)', letterSpacing: 1 }}>输入 / 查看快捷命令</span>
            </>
          ) : (
            <span style={{ fontSize: 11, color: 'var(--ink-trace)' }}>当日无记录</span>
          )}
        </div>
      )}
      {!pastLoading && messages.map((msg, i) => (
        <div key={msg.timestamp + i} style={{ marginBottom: 18 }}>
          <MessageItem
            msg={msg}
            isLast={isToday && i === messages.length - 1}
            loading={isToday && loading}
            phase={isToday ? phase : 'idle'}
            onPermission={isToday && msg.role === 'assistant' && msg.permissionRequest && !msg.permissionRequest.resolved
              ? (d) => onPermission(i, d, msg.permissionRequest!.token)
              : undefined}
          />
        </div>
      ))}
      <div ref={bottomRef} />
    </>
  )
})

const MIN_W       = 300
const MAX_W_RATIO = 0.65
function defaultWidth() {
  if (typeof window === 'undefined') return 460
  return Math.round(Math.min(Math.max(window.innerWidth * 0.36, 400), 560))
}

export default function SpiritWidget({ name = '青霄' }: { name?: string }) {
  // SSR 始终 false，hydration 完成后从 localStorage 恢复
  const [open,   setOpen]   = useState(false)
  const router = useRouter()
  const [panelW, setPanelW] = useState(defaultWidth)
  useEffect(() => { setOpen(localStorage.getItem('spirit-open') === '1') }, [])

  const dragging   = useRef(false)
  const dragStartX = useRef(0)
  const dragStartW = useRef(0)

  // 同步 CSS variable + 持久化开关状态
  useEffect(() => {
    localStorage.setItem('spirit-open', open ? '1' : '0')
    document.documentElement.style.setProperty('--spirit-panel-w', open ? `${panelW}px` : '0px')
  }, [open, panelW])

  // 拖拽：直接操作 CSS variable，绕开 React 渲染延迟
  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragging.current) return
      const delta = dragStartX.current - e.clientX
      const maxW  = Math.floor(window.innerWidth * MAX_W_RATIO)
      const w     = Math.max(MIN_W, Math.min(dragStartW.current + delta, maxW))
      document.documentElement.style.setProperty('--spirit-panel-w', `${w}px`)
      setPanelW(w)
    }
    function onUp() {
      if (!dragging.current) return
      dragging.current = false
      document.body.style.userSelect  = ''
      document.body.style.cursor      = ''
      document.body.style.transition  = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup',   onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [])

  function startDrag(e: React.MouseEvent) {
    e.preventDefault()
    dragging.current   = true
    dragStartX.current = e.clientX
    dragStartW.current = panelW
    document.body.style.userSelect  = 'none'
    document.body.style.cursor      = 'ew-resize'
    document.body.style.transition  = 'none'
  }

  const chat = useSpiritChat(open)
  const {
    messages, loading, phase,
    input,
    cmdMenu, cmdIdx, setCmdIdx, filteredCmds,
    contexts, setContexts, ctxLoading,
    activeTab, setActiveTab,
    mcpData, installPkg, setInstallPkg, installing,
    send, handlePermission, handleInput, handleKeyDown, selectCmd,
    doInstall, loadTools,
    bottomRef, inputRef,
  } = chat

  // ── 技能卡 ───────────────────────────────────────────────────
  const [skillCards,    setSkillCards]    = useState<SkillCardData[]>([])
  const [skillsLoading, setSkillsLoading] = useState(false)
  const [skillsTotal,   setSkillsTotal]   = useState(0)
  const [skillNeedsSync,setSkillNeedsSync]= useState(false)
  const [extracting,    setExtracting]    = useState(false)
  const [extractResult, setExtractResult] = useState<string | null>(null)
  const [skillTagFilter,setSkillTagFilter]= useState<string | null>(null)
  const [lastExtracted,  setLastExtracted]  = useState<string | null>(null)
  const [editingId,      setEditingId]      = useState<string | null>(null)
  const [editDraft,      setEditDraft]      = useState({ title: '', insight: '', body: '', tags: '', userNotes: '' })
  const [deletingId,     setDeletingId]     = useState<string | null>(null)
  const [savingEdit,     setSavingEdit]     = useState(false)
  const [expandedSkillId, setExpandedSkillId] = useState<string | null>(null)

  // ── 偏好画像 ─────────────────────────────────────────────────
  const [prefs,          setPrefs]          = useState<PrefItem[]>([])
  const [prefsLoading,   setPrefsLoading]   = useState(false)
  const [prefsTotal,     setPrefsTotal]     = useState(0)
  const [prefExtracting, setPrefExtracting] = useState(false)
  const [prefResult,     setPrefResult]     = useState<string | null>(null)
  const [prefCatFilter,  setPrefCatFilter]  = useState<string | null>(null)
  const [editingPrefId,  setEditingPrefId]  = useState<string | null>(null)
  const [prefDraft,      setPrefDraft]      = useState({ description: '', confidence: 0 })
  const [deletingPrefId, setDeletingPrefId] = useState<string | null>(null)

  const loadPrefs = useCallback(async () => {
    setPrefsLoading(true)
    try {
      const res  = await fetch('/api/spirit/preferences')
      const data = await res.json() as { prefs: PrefItem[]; total: number }
      const sorted = [...data.prefs].sort((a, b) => b.confidence - a.confidence)
      setPrefs(sorted)
      setPrefsTotal(data.total)
    } catch { /* ignore */ }
    finally { setPrefsLoading(false) }
  }, [])

  const savePrefEdit = useCallback(async (id: string) => {
    try {
      await fetch('/api/spirit/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, description: prefDraft.description, confidence: prefDraft.confidence }),
      })
      setEditingPrefId(null)
      await loadPrefs()
    } catch { /* ignore */ }
  }, [prefDraft, loadPrefs])

  const deletePref = useCallback(async (id: string) => {
    try {
      await fetch('/api/spirit/preferences', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      setDeletingPrefId(null)
      await loadPrefs()
    } catch { /* ignore */ }
  }, [loadPrefs])

  const extractPrefsNow = useCallback(async () => {
    setPrefExtracting(true)
    setPrefResult(null)
    try {
      const res  = await fetch('/api/spirit/preferences', { method: 'POST' })
      const data = await res.json() as { ok?: boolean; changedCount?: number; total?: number }
      if (data.ok) {
        setPrefResult(
          (data.changedCount ?? 0) > 0
            ? `提炼完成，更新 ${data.changedCount} 条（共 ${data.total} 条）`
            : '本轮对话暂无新观测'
        )
      }
      await loadPrefs()
    } catch { setPrefResult('提炼失败，请稍后再试') }
    finally { setPrefExtracting(false) }
  }, [loadPrefs])

  const loadSkills = useCallback(async () => {
    setSkillsLoading(true)
    try {
      const res  = await fetch('/api/spirit/skills')
      const data = await res.json() as { cards: SkillCardData[]; total: number; needsSync: boolean; lastExtracted: string | null }
      setSkillCards(data.cards)
      setSkillsTotal(data.total)
      setSkillNeedsSync(data.needsSync)
      setLastExtracted(data.lastExtracted ?? null)
    } catch { /* ignore */ }
    finally { setSkillsLoading(false) }
  }, [])

  const saveEdit = useCallback(async (id: string) => {
    setSavingEdit(true)
    try {
      const tagsArr = editDraft.tags.split(',').map(t => t.trim()).filter(Boolean)
      await fetch('/api/spirit/skills', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, title: editDraft.title, insight: editDraft.insight, body: editDraft.body || undefined, tags: tagsArr, userNotes: editDraft.userNotes }),
      })
      setEditingId(null)
      await loadSkills()
    } catch { /* ignore */ }
    finally { setSavingEdit(false) }
  }, [editDraft, loadSkills])

  const deleteCard = useCallback(async (id: string) => {
    try {
      await fetch('/api/spirit/skills', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      setDeletingId(null)
      await loadSkills()
    } catch { /* ignore */ }
  }, [loadSkills])

  const extractNow = useCallback(async () => {
    setExtracting(true)
    setExtractResult(null)
    try {
      const res  = await fetch('/api/spirit/skills', { method: 'POST' })
      const data = await res.json() as { ok?: boolean; newCount?: number; total?: number }
      if (data.ok) {
        setExtractResult(
          (data.newCount ?? 0) > 0
            ? `提炼完成，新增 ${data.newCount} 张（共 ${data.total} 张）`
            : '本轮对话暂无新洞察'
        )
      }
      await loadSkills()
    } catch { setExtractResult('提炼失败，请稍后再试') }
    finally { setExtracting(false) }
  }, [loadSkills])

  // ── 历史日期浏览 ─────────────────────────────────────────────
  const [historyDates,  setHistoryDates]  = useState<string[]>([])
  const [viewDate,      setViewDate]      = useState<string | null>(null)  // null = 今日
  const [pastMessages,  setPastMessages]  = useState<Message[]>([])
  const [pastLoading,   setPastLoading]   = useState(false)

  // 打开时拉有记录的日期列表
  useEffect(() => {
    if (!open) return
    fetch('/api/spirit/session?list=true')
      .then(r => r.json())
      .then((dates: string[]) => setHistoryDates(dates))
      .catch(() => {})
  }, [open])

  // 切换历史日期时拉取消息
  const loadPastDate = useCallback(async (date: string) => {
    setPastLoading(true)
    try {
      const res  = await fetch(`/api/spirit/session?date=${date}`)
      const conv = await res.json() as { messages: Message[] }
      setPastMessages(conv.messages)
    } catch { /* ignore */ }
    finally { setPastLoading(false) }
  }, [])

  useEffect(() => {
    if (!viewDate) { setPastMessages([]); return }
    loadPastDate(viewDate)
  }, [viewDate, loadPastDate])

  const isToday        = !viewDate || viewDate === todayStr()
  const displayMessages = isToday ? messages : pastMessages

  return (
    <>
      {/* ── 浮层按钮 ── */}
      {!open && (
        <button onClick={() => setOpen(true)} title={`呼唤${name}`} style={{
          position: 'fixed', bottom: 28, right: 28,
          width: 48, height: 48, borderRadius: '50%',
          background: 'radial-gradient(circle at 35% 35%, var(--deep), var(--void))',
          border: '1px solid rgba(212,168,67,0.35)', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 9999, animation: 'spirit-breathe 3s ease-in-out infinite',
        }}>
          <div style={{ position: 'absolute', inset: -6, borderRadius: '50%', pointerEvents: 'none',
            border: '1px solid rgba(212,168,67,0.12)', animation: 'spirit-ring 3s ease-in-out infinite',
          }} />
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--gold)',
            boxShadow: '0 0 10px var(--gold), 0 0 20px rgba(212,168,67,0.4)',
          }} />
        </button>
      )}

      {/* ── 侧边栏 ── */}
      {open && (
        <div style={{
          position: 'fixed', top: 0, right: 0, bottom: 0, width: panelW,
          background: 'var(--cave)', borderLeft: '1px solid var(--ink-trace)',
          display: 'flex', flexDirection: 'column',
          zIndex: 9998, boxShadow: '-4px 0 24px rgba(0,0,0,0.4)',
        }}>
          {/* 拖拽边 */}
          <div onMouseDown={startDrag} style={{
            position: 'absolute', top: 0, left: -3, bottom: 0, width: 6,
            cursor: 'ew-resize', zIndex: 10,
          }}>
            <div style={{
              position: 'absolute', top: '50%', left: 1,
              width: 2, height: 24, marginTop: -12,
              background: 'var(--ink-trace)', borderRadius: 1,
            }} />
          </div>

          {/* 头部 */}
          <div style={{
            padding: '14px 16px 12px',
            borderBottom: '1px solid var(--ink-trace)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            flexShrink: 0,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{
                width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                background: 'radial-gradient(circle at 35% 35%, var(--deep), var(--void))',
                border: '1px solid rgba(212,168,67,0.4)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <div style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--gold)',
                  boxShadow: '0 0 5px var(--gold)',
                }} />
              </div>
              <div>
                <span style={{ fontFamily: 'var(--font-xiaowei), serif', fontSize: 14, color: 'var(--gold)', letterSpacing: 4 }}>
                  {name}
                </span>
                {loading && (
                  <span style={{ fontFamily: 'var(--font-serif)', fontSize: 10, color: 'var(--gold-dim)',
                    letterSpacing: 1, marginLeft: 10, opacity: 0.8,
                  }}>
                    {phase === 'replying' ? '回应中' : phase === 'tooling' ? '执行中' : '推演中'}
                  </span>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 2, marginLeft: 'auto' }}>
              <button
                onClick={() => router.push('/spirit')}
                title="专注模式"
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--ink-dim)', fontSize: 13, padding: '2px 6px', lineHeight: 1,
                  opacity: 0.6, transition: 'opacity 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                onMouseLeave={e => (e.currentTarget.style.opacity = '0.6')}
              >⛶</button>
              <button onClick={() => setOpen(false)} style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--ink-dim)', fontSize: 16, padding: '2px 6px', lineHeight: 1,
              }}>×</button>
            </div>
          </div>

          {/* ── Tab 栏 ── */}
          <div style={{
            display: 'flex', borderBottom: '1px solid var(--ink-trace)',
            flexShrink: 0, background: 'var(--cave)',
          }}>
            {(['chat', 'tools', 'skills', 'prefs'] as const).map(tab => (
              <button key={tab} onClick={() => {
                setActiveTab(tab)
                if (tab === 'tools')  loadTools()
                if (tab === 'skills') loadSkills()
                if (tab === 'prefs')  loadPrefs()
              }}
                style={{
                  padding: '9px 18px', border: 'none', background: 'none', cursor: 'pointer',
                  fontFamily: 'var(--font-serif)', fontSize: 12, letterSpacing: 4, textIndent: 4,
                  color: activeTab === tab ? 'var(--gold)' : 'var(--ink-dim)',
                  borderBottom: activeTab === tab ? '1px solid var(--gold)' : '1px solid transparent',
                  marginBottom: -1, transition: 'color 0.2s',
                  position: 'relative',
                }}>
                {tab === 'chat' ? '问道' : tab === 'tools' ? '法器' : tab === 'skills' ? '技能' : '偏好'}
                {tab === 'skills' && skillNeedsSync && (
                  <span style={{
                    position: 'absolute', top: 7, right: 6,
                    width: 5, height: 5, borderRadius: '50%',
                    background: 'var(--gold-dim)',
                  }} />
                )}
              </button>
            ))}
          </div>

          {/* ── 法器 Tab ── */}
          {activeTab === 'tools' && (
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
              {!mcpData ? (
                <div style={{ padding: 32, textAlign: 'center', fontFamily: 'var(--font-serif)',
                  fontSize: 12, color: 'var(--ink-dim)', letterSpacing: 2,
                }}>加载中…</div>
              ) : (
                <>
                  <div style={{ padding: '14px 16px 6px', fontFamily: 'var(--font-serif)',
                    fontSize: 10, color: 'var(--ink-dim)', letterSpacing: 3, flexShrink: 0,
                  }}>
                    内置法术 · {mcpData.tools.filter(t => t.category !== 'mcp').length} 个
                  </div>
                  {mcpData.tools.filter(t => t.category !== 'mcp').map(t => (
                    <div key={t.name} style={{
                      padding: '9px 16px', borderTop: '1px solid var(--ink-trace)',
                      display: 'grid', gridTemplateColumns: '110px 1fr', gap: '0 10px',
                    }}>
                      <span style={{
                        fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--gold-dim)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingTop: 1,
                      }}>{t.displayName}</span>
                      <span style={{ fontFamily: 'var(--font-serif)', fontSize: 11,
                        color: 'var(--ink-dim)', lineHeight: 1.65, letterSpacing: 0.3,
                      }}>{t.description}</span>
                    </div>
                  ))}

                  {mcpData.adapters.length > 0 && (
                    <>
                      <div style={{ padding: '16px 16px 6px', fontFamily: 'var(--font-serif)',
                        fontSize: 10, color: 'var(--ink-dim)', letterSpacing: 3,
                        borderTop: '1px solid var(--ink-trace)', flexShrink: 0,
                      }}>
                        MCP 法器 · {mcpData.adapters.length} 个服务
                      </div>
                      {mcpData.adapters.map(adapter => {
                        const adapterTools = mcpData.tools.filter(t => t.name.startsWith(adapter.namespace + '__'))
                        return (
                          <div key={adapter.namespace}>
                            <div style={{
                              padding: '7px 16px 5px',
                              borderTop: '1px solid var(--ink-trace)',
                              background: 'rgba(212,168,67,0.04)',
                              display: 'flex', alignItems: 'center', gap: 8,
                            }}>
                              <span style={{ fontSize: 8, color: 'var(--gold-dim)' }}>◈</span>
                              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--gold-dim)', letterSpacing: 1 }}>
                                {adapter.namespace}
                              </span>
                              <span style={{ fontFamily: 'var(--font-serif)', fontSize: 10, color: 'var(--ink-dim)', letterSpacing: 1 }}>
                                {adapter.name}
                              </span>
                              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--ink-trace)', marginLeft: 'auto' }}>
                                {adapterTools.length} 个工具
                              </span>
                            </div>
                            {adapterTools.map(t => (
                              <div key={t.name} style={{
                                padding: '7px 16px 7px 32px', borderTop: '1px solid var(--ink-trace)',
                                display: 'grid', gridTemplateColumns: '110px 1fr', gap: '0 10px',
                              }}>
                                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--jade)',
                                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingTop: 1,
                                }}>{t.displayName || t.name.split('__')[1]}</span>
                                <span style={{ fontFamily: 'var(--font-serif)', fontSize: 11,
                                  color: 'var(--ink-dim)', lineHeight: 1.65, letterSpacing: 0.3,
                                }}>{t.description}</span>
                              </div>
                            ))}
                          </div>
                        )
                      })}
                    </>
                  )}

                  {mcpData.adapters.length === 0 && (
                    <div style={{ padding: '16px 16px 8px', borderTop: '1px solid var(--ink-trace)',
                      fontFamily: 'var(--font-serif)', fontSize: 11, color: 'var(--ink-trace)',
                      letterSpacing: 2, lineHeight: 2,
                    }}>
                      暂无 MCP 法器<br/>
                      <span style={{ fontSize: 10 }}>在 codelife.config.ts → mcpServers 配置，或用 /引法器 装载</span>
                    </div>
                  )}
                </>
              )}

              {mcpData?.allowDynamicInstall && (
                <div style={{
                  marginTop: 'auto', borderTop: '1px solid var(--ink-trace)',
                  padding: '12px 16px', background: 'var(--deep)', flexShrink: 0,
                }}>
                  <div style={{ fontFamily: 'var(--font-serif)', fontSize: 10,
                    color: 'var(--ink-dim)', letterSpacing: 2, marginBottom: 8,
                  }}>装载 MCP 法器包</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      value={installPkg}
                      onChange={e => setInstallPkg(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && !installing) doInstall() }}
                      placeholder="@modelcontextprotocol/server-..."
                      style={{
                        flex: 1, background: 'var(--surface)', border: '1px solid var(--ink-trace)',
                        outline: 'none', padding: '5px 9px', fontFamily: 'var(--font-mono)',
                        fontSize: 11, color: 'var(--ink)', borderRadius: 2,
                      }}
                    />
                    <button onClick={doInstall} disabled={!installPkg.trim() || installing}
                      style={{
                        background: 'none', border: '1px solid var(--gold-line)',
                        cursor: !installPkg.trim() || installing ? 'default' : 'pointer',
                        color: !installPkg.trim() || installing ? 'var(--ink-trace)' : 'var(--gold-dim)',
                        fontFamily: 'var(--font-serif)', fontSize: 11, letterSpacing: 2,
                        padding: '5px 12px', borderRadius: 2, transition: 'color 0.2s',
                      }}>
                      {installing ? '装载中…' : '装载'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── 技能 Tab ── */}
          {activeTab === 'skills' && (() => {
            const allTags = Array.from(new Set(skillCards.flatMap(c => c.tags))).sort()
            const filtered = skillTagFilter
              ? skillCards.filter(c => c.tags.includes(skillTagFilter))
              : skillCards

            return (
              <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
                {/* 顶部操作栏 */}
                <div style={{
                  padding: '10px 16px 8px',
                  borderBottom: '1px solid var(--ink-trace)',
                  flexShrink: 0,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span style={{
                        fontFamily: 'var(--font-serif)', fontSize: 10,
                        color: extractResult
                          ? (extractResult.includes('新增') ? 'var(--jade)' : 'var(--ink-dim)')
                          : 'var(--ink-dim)',
                        letterSpacing: 2,
                        transition: 'color 0.3s',
                      }}>
                        {extractResult ?? `共 ${skillsTotal} 张技能卡`}
                      </span>
                      {lastExtracted && (
                        <span style={{
                          fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--ink-trace)',
                        }}>
                          上次提炼 {lastExtracted}
                        </span>
                      )}
                    </div>
                    <button
                      onClick={extractNow}
                      disabled={extracting}
                      style={{
                        background: 'none',
                        border: `1px solid ${extracting ? 'var(--ink-trace)' : 'var(--gold-dim)'}`,
                        borderRadius: 2, padding: '3px 10px',
                        cursor: extracting ? 'default' : 'pointer',
                        fontFamily: 'var(--font-serif)', fontSize: 10,
                        color: extracting ? 'var(--ink-trace)' : 'var(--gold-dim)',
                        letterSpacing: 2, transition: 'color 0.2s',
                        display: 'flex', alignItems: 'center', gap: 5,
                      }}
                    >
                      {extracting && (
                        <span style={{
                          width: 6, height: 6, borderRadius: '50%',
                          border: '1px solid var(--ink-trace)',
                          borderTopColor: 'var(--gold-dim)',
                          display: 'inline-block',
                          animation: 'spin 0.8s linear infinite',
                        }} />
                      )}
                      {extracting ? '提炼中' : '立即提炼'}
                    </button>
                    <button onClick={loadSkills} style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      fontSize: 12, color: 'var(--ink-trace)', padding: '2px 4px',
                    }}>↺</button>
                  </div>

                  {/* Tag 筛选 */}
                  {allTags.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      <button
                        onClick={() => setSkillTagFilter(null)}
                        style={{
                          background: skillTagFilter === null ? 'rgba(212,168,67,0.12)' : 'none',
                          border: '1px solid var(--ink-trace)', borderRadius: 2,
                          padding: '1px 7px', cursor: 'pointer',
                          fontFamily: 'var(--font-serif)', fontSize: 9,
                          color: skillTagFilter === null ? 'var(--gold-dim)' : 'var(--ink-trace)',
                          letterSpacing: 1,
                        }}
                      >
                        全部
                      </button>
                      {allTags.map(tag => (
                        <button
                          key={tag}
                          onClick={() => setSkillTagFilter(skillTagFilter === tag ? null : tag)}
                          style={{
                            background: skillTagFilter === tag ? 'rgba(212,168,67,0.12)' : 'none',
                            border: '1px solid var(--ink-trace)', borderRadius: 2,
                            padding: '1px 7px', cursor: 'pointer',
                            fontFamily: 'var(--font-serif)', fontSize: 9,
                            color: skillTagFilter === tag ? 'var(--gold-dim)' : 'var(--ink-trace)',
                            letterSpacing: 1,
                          }}
                        >
                          {tag}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* 卡片列表 */}
                {skillsLoading && (
                  <div style={{
                    padding: '32px 16px', textAlign: 'center',
                    fontFamily: 'var(--font-serif)', fontSize: 11,
                    color: 'var(--ink-trace)', letterSpacing: 2,
                  }}>
                    读取中…
                  </div>
                )}

                {!skillsLoading && filtered.length === 0 && (
                  <div style={{
                    padding: '40px 20px', textAlign: 'center',
                    fontFamily: 'var(--font-serif)', fontSize: 11,
                    color: 'var(--ink-trace)', letterSpacing: 2, lineHeight: 2.5,
                  }}>
                    {skillsTotal === 0 ? (
                      <>尚无技能卡<br/>
                        <span style={{ fontSize: 10 }}>
                          {skillNeedsSync ? '点击「立即提炼」生成' : '本周已提炼，对话积累后自动更新'}
                        </span>
                      </>
                    ) : '该标签下暂无卡片'}
                  </div>
                )}

                <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {filtered.map(card => {
                    const isEditing  = editingId  === card.id
                    const isDeleting = deletingId === card.id
                    return (
                      <div key={card.id} style={{
                        background: 'linear-gradient(135deg, rgba(212,168,67,0.05) 0%, transparent 100%)',
                        border: `1px solid ${isEditing ? 'rgba(212,168,67,0.45)' : 'rgba(212,168,67,0.2)'}`,
                        borderLeft: '2px solid var(--gold-dim)',
                        borderRadius: 2, padding: '10px 12px',
                        transition: 'border-color 0.2s',
                      }}>
                        {/* ── 标题行 ── */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: isEditing ? 8 : 5 }}>
                          {isEditing ? (
                            <input
                              value={editDraft.title}
                              onChange={e => setEditDraft(d => ({ ...d, title: e.target.value }))}
                              placeholder="标题（≤20字）"
                              style={{
                                flex: 1, background: 'var(--deep)',
                                border: '1px solid var(--ink-trace)', borderRadius: 2,
                                padding: '3px 7px', fontFamily: 'var(--font-xiaowei), serif',
                                fontSize: 13, color: 'var(--gold)', letterSpacing: 2, outline: 'none',
                              }}
                            />
                          ) : (
                            <span style={{
                              fontFamily: 'var(--font-xiaowei), serif',
                              fontSize: 13, color: 'var(--gold)',
                              letterSpacing: 2, flex: 1,
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            }}>
                              {card.title}
                            </span>
                          )}
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--ink-trace)', flexShrink: 0 }}>
                            {card.sourceDate}
                          </span>
                          {isEditing ? (
                            <>
                              <button
                                onClick={() => saveEdit(card.id)}
                                disabled={savingEdit || !editDraft.title.trim()}
                                style={{
                                  background: 'none', border: '1px solid var(--jade)',
                                  borderRadius: 2, padding: '1px 7px', cursor: 'pointer',
                                  fontFamily: 'var(--font-serif)', fontSize: 9,
                                  color: 'var(--jade)', letterSpacing: 1, flexShrink: 0,
                                  opacity: savingEdit || !editDraft.title.trim() ? 0.4 : 1,
                                }}
                              >{savingEdit ? '保存中' : '保存'}</button>
                              <button
                                onClick={() => setEditingId(null)}
                                style={{
                                  background: 'none', border: 'none', cursor: 'pointer',
                                  fontFamily: 'var(--font-serif)', fontSize: 9,
                                  color: 'var(--ink-trace)', padding: '1px 4px',
                                }}
                              >取消</button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={() => {
                                  setEditingId(card.id)
                                  setDeletingId(null)
                                  setEditDraft({
                                    title:     card.title,
                                    insight:   card.insight,
                                    body:      card.body ?? '',
                                    tags:      card.tags.join(', '),
                                    userNotes: card.userNotes ?? '',
                                  })
                                }}
                                title="编辑"
                                style={{
                                  background: 'none', border: 'none', cursor: 'pointer',
                                  fontSize: 11, color: 'var(--ink-trace)', padding: '1px 3px',
                                  flexShrink: 0, lineHeight: 1,
                                }}
                              >✎</button>
                              <button
                                onClick={() => setDeletingId(isDeleting ? null : card.id)}
                                title="删除"
                                style={{
                                  background: 'none', border: 'none', cursor: 'pointer',
                                  fontSize: 13, color: isDeleting ? 'var(--vermilion, #c0392b)' : 'var(--ink-trace)',
                                  padding: '1px 3px', flexShrink: 0, lineHeight: 1,
                                }}
                              >×</button>
                            </>
                          )}
                        </div>

                        {/* ── 摘要（编辑/只读）── */}
                        {isEditing ? (
                          <textarea
                            value={editDraft.insight}
                            onChange={e => setEditDraft(d => ({ ...d, insight: e.target.value }))}
                            placeholder="一句话摘要（≤50字，用于列表预览）"
                            rows={2}
                            style={{
                              width: '100%', boxSizing: 'border-box',
                              background: 'var(--deep)', border: '1px solid var(--ink-trace)',
                              borderRadius: 2, padding: '5px 7px',
                              fontFamily: 'var(--font-serif)', fontSize: 11,
                              color: 'var(--ink-dim)', lineHeight: 1.75, letterSpacing: 0.3,
                              resize: 'vertical', outline: 'none', marginBottom: 7,
                            }}
                          />
                        ) : (
                          <div style={{
                            fontFamily: 'var(--font-serif)', fontSize: 11,
                            color: 'var(--ink-dim)', lineHeight: 1.75, letterSpacing: 0.3,
                            marginBottom: card.body ? 4 : 7,
                          }}>
                            {card.insight}
                          </div>
                        )}

                        {/* ── Body 展开/折叠（只读）── */}
                        {!isEditing && card.body && (
                          <>
                            <button
                              onClick={() => setExpandedSkillId(expandedSkillId === card.id ? null : card.id)}
                              style={{
                                background: 'none', border: 'none', cursor: 'pointer',
                                display: 'flex', alignItems: 'center', gap: 4,
                                fontFamily: 'var(--font-serif)', fontSize: 9,
                                color: 'var(--gold-dim)', letterSpacing: 1,
                                padding: '2px 0', marginBottom: 5,
                              }}
                            >
                              <span style={{
                                display: 'inline-block',
                                transform: expandedSkillId === card.id ? 'rotate(90deg)' : 'rotate(0deg)',
                                transition: 'transform 0.15s',
                                fontSize: 8,
                              }}>▶</span>
                              {expandedSkillId === card.id ? '收起全文' : '展开全文'}
                            </button>
                            {expandedSkillId === card.id && (
                              <div style={{
                                borderTop: '1px solid var(--ink-trace)',
                                paddingTop: 12, marginBottom: 8,
                                fontFamily: 'var(--font-serif)',
                              }}>
                                <ReactMarkdown
                                  components={{
                                    h2: ({ children }) => (
                                      <h2 style={{
                                        fontFamily: 'var(--font-xiaowei), serif',
                                        fontSize: 12, color: 'var(--gold)',
                                        letterSpacing: 2, margin: '14px 0 6px',
                                        borderBottom: '1px solid rgba(212,168,67,0.2)',
                                        paddingBottom: 3,
                                      }}>{children}</h2>
                                    ),
                                    h3: ({ children }) => (
                                      <h3 style={{
                                        fontFamily: 'var(--font-xiaowei), serif',
                                        fontSize: 11, color: 'var(--gold-dim)',
                                        letterSpacing: 1.5, margin: '10px 0 4px',
                                      }}>{children}</h3>
                                    ),
                                    p: ({ children }) => (
                                      <p style={{
                                        fontSize: 11, color: 'var(--ink-mid)',
                                        lineHeight: 1.8, letterSpacing: 0.3,
                                        margin: '4px 0 8px',
                                      }}>{children}</p>
                                    ),
                                    li: ({ children }) => (
                                      <li style={{
                                        fontSize: 11, color: 'var(--ink-mid)',
                                        lineHeight: 1.75, letterSpacing: 0.3,
                                        margin: '2px 0',
                                      }}>{children}</li>
                                    ),
                                    ul: ({ children }) => (
                                      <ul style={{ paddingLeft: 16, margin: '4px 0 8px' }}>{children}</ul>
                                    ),
                                    ol: ({ children }) => (
                                      <ol style={{ paddingLeft: 16, margin: '4px 0 8px' }}>{children}</ol>
                                    ),
                                    code: ({ children, className }) => {
                                      const isBlock = className?.includes('language-')
                                      return isBlock ? (
                                        <pre style={{
                                          background: 'var(--void)',
                                          border: '1px solid var(--ink-trace)',
                                          borderRadius: 2, padding: '8px 10px',
                                          overflowX: 'auto', margin: '6px 0',
                                        }}>
                                          <code style={{
                                            fontFamily: 'var(--font-mono)',
                                            fontSize: 10, color: 'var(--ink-mid)',
                                            letterSpacing: 0.3,
                                          }}>{children}</code>
                                        </pre>
                                      ) : (
                                        <code style={{
                                          fontFamily: 'var(--font-mono)',
                                          fontSize: 10, color: 'var(--gold-dim)',
                                          background: 'rgba(212,168,67,0.08)',
                                          padding: '1px 4px', borderRadius: 2,
                                        }}>{children}</code>
                                      )
                                    },
                                    blockquote: ({ children }) => (
                                      <blockquote style={{
                                        borderLeft: '2px solid var(--gold-dim)',
                                        paddingLeft: 10, margin: '6px 0',
                                        color: 'var(--ink-trace)',
                                        fontStyle: 'italic',
                                      }}>{children}</blockquote>
                                    ),
                                  }}
                                >
                                  {card.body!}
                                </ReactMarkdown>
                              </div>
                            )}
                          </>
                        )}

                        {/* ── Body 编辑框（仅编辑模式）── */}
                        {isEditing && (
                          <div style={{ marginBottom: 7 }}>
                            <div style={{ fontFamily: 'var(--font-serif)', fontSize: 9, color: 'var(--ink-trace)', letterSpacing: 1, marginBottom: 4 }}>
                              完整内容（Markdown，可留空）
                            </div>
                            <textarea
                              value={editDraft.body}
                              onChange={e => setEditDraft(d => ({ ...d, body: e.target.value }))}
                              placeholder="## 背景&#10;&#10;## 核心概念&#10;&#10;## 方案&#10;&#10;## 注意事项"
                              rows={8}
                              style={{
                                width: '100%', boxSizing: 'border-box',
                                background: 'var(--deep)', border: '1px solid var(--ink-trace)',
                                borderRadius: 2, padding: '5px 7px',
                                fontFamily: 'var(--font-mono)', fontSize: 10,
                                color: 'var(--ink-mid)', lineHeight: 1.7, letterSpacing: 0.2,
                                resize: 'vertical', outline: 'none',
                              }}
                            />
                          </div>
                        )}

                        {/* ── Tags（编辑/只读）── */}
                        {isEditing ? (
                          <input
                            value={editDraft.tags}
                            onChange={e => setEditDraft(d => ({ ...d, tags: e.target.value }))}
                            placeholder="标签（逗号分隔）"
                            style={{
                              width: '100%', boxSizing: 'border-box',
                              background: 'var(--deep)', border: '1px solid var(--ink-trace)',
                              borderRadius: 2, padding: '3px 7px',
                              fontFamily: 'var(--font-mono)', fontSize: 10,
                              color: 'var(--gold-dim)', outline: 'none', marginBottom: 7,
                            }}
                          />
                        ) : (
                          card.tags.length > 0 && (
                            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center', marginBottom: 0 }}>
                              {card.tags.map(tag => (
                                <button
                                  key={tag}
                                  onClick={() => setSkillTagFilter(tag)}
                                  style={{
                                    background: 'none',
                                    border: '1px solid rgba(212,168,67,0.18)',
                                    borderRadius: 2, padding: '1px 6px',
                                    cursor: 'pointer',
                                    fontFamily: 'var(--font-serif)', fontSize: 9,
                                    color: 'var(--gold-dim)', letterSpacing: 1,
                                  }}
                                >
                                  {tag}
                                </button>
                              ))}
                              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--ink-trace)', marginLeft: 'auto' }}>
                                #{card.useCount}
                              </span>
                            </div>
                          )
                        )}

                        {/* ── 我的想法（编辑时 / 只读时展示已有内容）── */}
                        {isEditing ? (
                          <div style={{ marginTop: 7 }}>
                            <div style={{ fontFamily: 'var(--font-serif)', fontSize: 9, color: 'var(--ink-trace)', letterSpacing: 1, marginBottom: 4 }}>
                              我的想法（将纳入下次提炼参考）
                            </div>
                            <textarea
                              value={editDraft.userNotes}
                              onChange={e => setEditDraft(d => ({ ...d, userNotes: e.target.value }))}
                              placeholder="对这条洞察的补充、修正或想法…"
                              rows={2}
                              style={{
                                width: '100%', boxSizing: 'border-box',
                                background: 'var(--deep)', border: '1px solid var(--ink-trace)',
                                borderRadius: 2, padding: '5px 7px',
                                fontFamily: 'var(--font-serif)', fontSize: 10,
                                color: 'var(--ink-dim)', lineHeight: 1.65, letterSpacing: 0.3,
                                resize: 'vertical', outline: 'none',
                              }}
                            />
                          </div>
                        ) : (
                          card.userNotes?.trim() && (
                            <div style={{
                              marginTop: 7, paddingTop: 7,
                              borderTop: '1px dashed rgba(212,168,67,0.15)',
                              fontFamily: 'var(--font-serif)', fontSize: 10,
                              color: 'var(--ink-trace)', lineHeight: 1.6, letterSpacing: 0.3,
                              fontStyle: 'italic',
                            }}>
                              <span style={{ color: 'var(--gold-dim)', fontStyle: 'normal', marginRight: 4 }}>〝</span>
                              {card.userNotes}
                              <span style={{ color: 'var(--gold-dim)', fontStyle: 'normal', marginLeft: 4 }}>〞</span>
                            </div>
                          )
                        )}

                        {/* ── 删除确认 ── */}
                        {isDeleting && (
                          <div style={{
                            marginTop: 10, paddingTop: 8,
                            borderTop: '1px solid rgba(192,57,43,0.25)',
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          }}>
                            <span style={{ fontFamily: 'var(--font-serif)', fontSize: 10, color: 'var(--ink-dim)', letterSpacing: 1 }}>
                              确认删除此技能卡？
                            </span>
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button
                                onClick={() => deleteCard(card.id)}
                                style={{
                                  background: 'rgba(192,57,43,0.12)', border: '1px solid rgba(192,57,43,0.4)',
                                  borderRadius: 2, padding: '2px 9px', cursor: 'pointer',
                                  fontFamily: 'var(--font-serif)', fontSize: 9,
                                  color: '#c0392b', letterSpacing: 1,
                                }}
                              >删除</button>
                              <button
                                onClick={() => setDeletingId(null)}
                                style={{
                                  background: 'none', border: '1px solid var(--ink-trace)',
                                  borderRadius: 2, padding: '2px 9px', cursor: 'pointer',
                                  fontFamily: 'var(--font-serif)', fontSize: 9,
                                  color: 'var(--ink-dim)', letterSpacing: 1,
                                }}
                              >取消</button>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>

                {skillNeedsSync && !extracting && filtered.length > 0 && (
                  <div style={{
                    marginTop: 'auto', flexShrink: 0,
                    borderTop: '1px solid var(--ink-trace)',
                    padding: '8px 16px',
                    fontFamily: 'var(--font-serif)', fontSize: 9,
                    color: 'var(--gold-dim)', letterSpacing: 1,
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  }}>
                    <span>本周尚未提炼</span>
                    <button onClick={extractNow} style={{
                      background: 'none', border: '1px solid var(--gold-dim)',
                      borderRadius: 2, padding: '2px 8px', cursor: 'pointer',
                      fontFamily: 'var(--font-serif)', fontSize: 9,
                      color: 'var(--gold-dim)', letterSpacing: 1,
                    }}>
                      立即提炼
                    </button>
                  </div>
                )}
              </div>
            )
          })()}

          {/* ── 偏好 Tab ── */}
          {activeTab === 'prefs' && (() => {
            const cats = Array.from(new Set(prefs.map(p => p.category))).sort()
            const filtered = prefCatFilter
              ? prefs.filter(p => p.category === prefCatFilter)
              : prefs

            return (
              <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
                {/* 顶部操作栏 */}
                <div style={{
                  padding: '10px 16px 8px',
                  borderBottom: '1px solid var(--ink-trace)',
                  flexShrink: 0,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <span style={{
                      flex: 1,
                      fontFamily: 'var(--font-serif)', fontSize: 10,
                      color: prefResult
                        ? (prefResult.includes('更新') ? 'var(--jade)' : 'var(--ink-dim)')
                        : 'var(--ink-dim)',
                      letterSpacing: 2,
                      transition: 'color 0.3s',
                    }}>
                      {prefResult ?? `共 ${prefsTotal} 条偏好`}
                    </span>
                    <button
                      onClick={extractPrefsNow}
                      disabled={prefExtracting}
                      style={{
                        background: 'none',
                        border: `1px solid ${prefExtracting ? 'var(--ink-trace)' : 'var(--gold-dim)'}`,
                        borderRadius: 2, padding: '3px 10px',
                        cursor: prefExtracting ? 'default' : 'pointer',
                        fontFamily: 'var(--font-serif)', fontSize: 10,
                        color: prefExtracting ? 'var(--ink-trace)' : 'var(--gold-dim)',
                        letterSpacing: 2, transition: 'color 0.2s',
                        display: 'flex', alignItems: 'center', gap: 5,
                      }}
                    >
                      {prefExtracting && (
                        <span style={{
                          width: 6, height: 6, borderRadius: '50%',
                          border: '1px solid var(--ink-trace)',
                          borderTopColor: 'var(--gold-dim)',
                          display: 'inline-block',
                          animation: 'spin 0.8s linear infinite',
                        }} />
                      )}
                      {prefExtracting ? '提炼中' : '立即提炼'}
                    </button>
                    <button onClick={loadPrefs} style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      fontSize: 12, color: 'var(--ink-trace)', padding: '2px 4px',
                    }}>↺</button>
                  </div>

                  {/* 分类筛选 */}
                  {cats.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      <button
                        onClick={() => setPrefCatFilter(null)}
                        style={{
                          background: prefCatFilter === null ? 'rgba(212,168,67,0.12)' : 'none',
                          border: '1px solid var(--ink-trace)', borderRadius: 2,
                          padding: '1px 7px', cursor: 'pointer',
                          fontFamily: 'var(--font-serif)', fontSize: 9,
                          color: prefCatFilter === null ? 'var(--gold-dim)' : 'var(--ink-trace)',
                          letterSpacing: 1,
                        }}
                      >全部</button>
                      {cats.map(cat => (
                        <button
                          key={cat}
                          onClick={() => setPrefCatFilter(prefCatFilter === cat ? null : cat)}
                          style={{
                            background: prefCatFilter === cat ? 'rgba(212,168,67,0.12)' : 'none',
                            border: '1px solid var(--ink-trace)', borderRadius: 2,
                            padding: '1px 7px', cursor: 'pointer',
                            fontFamily: 'var(--font-serif)', fontSize: 9,
                            color: prefCatFilter === cat ? 'var(--gold-dim)' : 'var(--ink-trace)',
                            letterSpacing: 1,
                          }}
                        >{PREF_CATEGORY_LABEL[cat] ?? cat}</button>
                      ))}
                    </div>
                  )}
                </div>

                {/* 加载中 */}
                {prefsLoading && (
                  <div style={{
                    padding: '32px 16px', textAlign: 'center',
                    fontFamily: 'var(--font-serif)', fontSize: 11,
                    color: 'var(--ink-trace)', letterSpacing: 2,
                  }}>读取中…</div>
                )}

                {/* 空状态 */}
                {!prefsLoading && filtered.length === 0 && (
                  <div style={{
                    padding: '40px 20px', textAlign: 'center',
                    fontFamily: 'var(--font-serif)', fontSize: 11,
                    color: 'var(--ink-trace)', letterSpacing: 2, lineHeight: 2.5,
                  }}>
                    {prefsTotal === 0 ? (
                      <>尚无偏好记录<br/>
                        <span style={{ fontSize: 10 }}>对话积累后点击「立即提炼」生成</span>
                      </>
                    ) : '该分类下暂无记录'}
                  </div>
                )}

                {/* 偏好列表 */}
                <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {filtered.map(pref => {
                    const isEditing  = editingPrefId  === pref.id
                    const isDeleting = deletingPrefId === pref.id
                    // 置信度颜色：高 = jade，中 = gold-dim，低 = ink-dim
                    const confColor = pref.confidence >= 0.7 ? 'var(--jade)'
                      : pref.confidence >= 0.4 ? 'var(--gold-dim)' : 'var(--ink-dim)'
                    const confBars  = Math.round(pref.confidence * 5)

                    return (
                      <div key={pref.id} style={{
                        background: 'rgba(212,168,67,0.03)',
                        border: `1px solid ${isEditing ? 'rgba(212,168,67,0.4)' : 'var(--ink-trace)'}`,
                        borderLeft: `2px solid ${confColor}`,
                        borderRadius: 2, padding: '9px 12px',
                        transition: 'border-color 0.2s',
                      }}>
                        {/* 标题行：分类 + 置信度 + 操作 */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                          <span style={{
                            fontFamily: 'var(--font-serif)', fontSize: 9,
                            color: 'var(--ink-trace)', letterSpacing: 1,
                            background: 'rgba(255,255,255,0.04)',
                            border: '1px solid var(--ink-trace)',
                            borderRadius: 2, padding: '1px 5px',
                            flexShrink: 0,
                          }}>
                            {PREF_CATEGORY_LABEL[pref.category] ?? pref.category}
                          </span>
                          {/* 置信度圆点 */}
                          <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                            {Array.from({ length: 5 }).map((_, i) => (
                              <span key={i} style={{
                                width: 5, height: 5, borderRadius: '50%',
                                background: i < confBars ? confColor : 'var(--ink-trace)',
                                display: 'inline-block',
                              }} />
                            ))}
                          </div>
                          <span style={{
                            fontFamily: 'var(--font-mono)', fontSize: 8,
                            color: 'var(--ink-trace)', marginLeft: 2,
                          }}>
                            {Math.round(pref.confidence * 100)}%
                          </span>
                          <span style={{ flex: 1 }} />
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--ink-trace)', flexShrink: 0 }}>
                            {pref.lastSeen}
                          </span>
                          {isEditing ? (
                            <>
                              <button
                                onClick={() => savePrefEdit(pref.id)}
                                disabled={!prefDraft.description.trim()}
                                style={{
                                  background: 'none', border: '1px solid var(--jade)',
                                  borderRadius: 2, padding: '1px 7px', cursor: 'pointer',
                                  fontFamily: 'var(--font-serif)', fontSize: 9,
                                  color: 'var(--jade)', letterSpacing: 1, flexShrink: 0,
                                  opacity: prefDraft.description.trim() ? 1 : 0.4,
                                }}
                              >保存</button>
                              <button
                                onClick={() => setEditingPrefId(null)}
                                style={{
                                  background: 'none', border: 'none', cursor: 'pointer',
                                  fontFamily: 'var(--font-serif)', fontSize: 9,
                                  color: 'var(--ink-trace)', padding: '1px 4px',
                                }}
                              >取消</button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={() => {
                                  setEditingPrefId(pref.id)
                                  setDeletingPrefId(null)
                                  setPrefDraft({ description: pref.description, confidence: pref.confidence })
                                }}
                                title="编辑"
                                style={{
                                  background: 'none', border: 'none', cursor: 'pointer',
                                  fontSize: 11, color: 'var(--ink-trace)', padding: '1px 3px', flexShrink: 0,
                                }}
                              >✎</button>
                              <button
                                onClick={() => setDeletingPrefId(isDeleting ? null : pref.id)}
                                title="删除"
                                style={{
                                  background: 'none', border: 'none', cursor: 'pointer',
                                  fontSize: 13,
                                  color: isDeleting ? 'var(--vermilion, #c0392b)' : 'var(--ink-trace)',
                                  padding: '1px 3px', flexShrink: 0,
                                }}
                              >×</button>
                            </>
                          )}
                        </div>

                        {/* 描述 */}
                        {isEditing ? (
                          <textarea
                            value={prefDraft.description}
                            onChange={e => setPrefDraft(d => ({ ...d, description: e.target.value }))}
                            rows={2}
                            style={{
                              width: '100%', boxSizing: 'border-box',
                              background: 'var(--deep)', border: '1px solid var(--ink-trace)',
                              borderRadius: 2, padding: '5px 7px',
                              fontFamily: 'var(--font-serif)', fontSize: 11,
                              color: 'var(--ink-dim)', lineHeight: 1.75, letterSpacing: 0.3,
                              resize: 'vertical', outline: 'none', marginBottom: 7,
                            }}
                          />
                        ) : (
                          <div style={{
                            fontFamily: 'var(--font-serif)', fontSize: 11,
                            color: 'var(--ink-dim)', lineHeight: 1.75, letterSpacing: 0.3,
                            marginBottom: pref.counterEvidence ? 6 : 0,
                          }}>
                            {pref.description}
                          </div>
                        )}

                        {/* 置信度调节（编辑时） */}
                        {isEditing && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                            <span style={{ fontFamily: 'var(--font-serif)', fontSize: 9, color: 'var(--ink-trace)', letterSpacing: 1 }}>
                              置信度
                            </span>
                            <input
                              type="range" min={0} max={1} step={0.05}
                              value={prefDraft.confidence}
                              onChange={e => setPrefDraft(d => ({ ...d, confidence: parseFloat(e.target.value) }))}
                              style={{ flex: 1, accentColor: 'var(--gold-dim)' }}
                            />
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--gold-dim)', width: 28, textAlign: 'right' }}>
                              {Math.round(prefDraft.confidence * 100)}%
                            </span>
                          </div>
                        )}

                        {/* 反例（如有） */}
                        {!isEditing && pref.counterEvidence && (
                          <div style={{
                            fontFamily: 'var(--font-serif)', fontSize: 9,
                            color: 'var(--ink-trace)', lineHeight: 1.6,
                            fontStyle: 'italic',
                          }}>
                            反例：{pref.counterEvidence}
                          </div>
                        )}

                        {/* 删除确认 */}
                        {isDeleting && (
                          <div style={{
                            marginTop: 10, paddingTop: 8,
                            borderTop: '1px solid rgba(192,57,43,0.25)',
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          }}>
                            <span style={{ fontFamily: 'var(--font-serif)', fontSize: 10, color: 'var(--ink-dim)', letterSpacing: 1 }}>
                              确认删除此偏好记录？
                            </span>
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button
                                onClick={() => deletePref(pref.id)}
                                style={{
                                  background: 'rgba(192,57,43,0.12)', border: '1px solid rgba(192,57,43,0.4)',
                                  borderRadius: 2, padding: '2px 9px', cursor: 'pointer',
                                  fontFamily: 'var(--font-serif)', fontSize: 9,
                                  color: '#c0392b', letterSpacing: 1,
                                }}
                              >删除</button>
                              <button
                                onClick={() => setDeletingPrefId(null)}
                                style={{
                                  background: 'none', border: '1px solid var(--ink-trace)',
                                  borderRadius: 2, padding: '2px 9px', cursor: 'pointer',
                                  fontFamily: 'var(--font-serif)', fontSize: 9,
                                  color: 'var(--ink-dim)', letterSpacing: 1,
                                }}
                              >取消</button>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })()}

          {/* ── 日期 Tab 条（问道 tab，有历史记录时显示）── */}
          {activeTab === 'chat' && historyDates.length > 1 && (
            <div style={{
              display: 'flex',
              overflowX: 'auto',
              borderBottom: '1px solid var(--ink-trace)',
              flexShrink: 0,
              scrollbarWidth: 'none',
            }}>
              {historyDates.map(date => {
                const active = isToday ? date === todayStr() : date === viewDate
                return (
                  <button
                    key={date}
                    onClick={() => setViewDate(date === todayStr() ? null : date)}
                    style={{
                      flexShrink: 0,
                      padding: '6px 12px',
                      border: 'none',
                      background: 'none',
                      cursor: 'pointer',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 10,
                      color: active ? 'var(--gold)' : 'var(--ink-trace)',
                      borderBottom: active ? '1px solid var(--gold)' : '1px solid transparent',
                      marginBottom: -1,
                      transition: 'color 0.15s',
                      letterSpacing: 0.5,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {dateLabel(date)}
                  </button>
                )
              })}
            </div>
          )}

          {/* ── 消息区（仅问道 tab）── */}
          {activeTab === 'chat' && (
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 8px' }}>
              <ChatMessageList
                messages={displayMessages}
                isToday={isToday}
                loading={loading}
                phase={phase}
                pastLoading={pastLoading}
                bottomRef={bottomRef}
                onPermission={handlePermission}
              />
            </div>
          )}

          {/* ── 历史模式提示条 ── */}
          {activeTab === 'chat' && !isToday && (
            <div style={{
              borderTop: '1px solid var(--ink-trace)',
              padding: '8px 16px',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              background: 'var(--deep)', flexShrink: 0,
            }}>
              <span style={{ fontFamily: 'var(--font-serif)', fontSize: 10, color: 'var(--ink-trace)', letterSpacing: 1 }}>
                历史记录 · {viewDate}
              </span>
              <button
                onClick={() => setViewDate(null)}
                style={{
                  background: 'none', border: '1px solid var(--ink-trace)', borderRadius: 2,
                  padding: '2px 8px', cursor: 'pointer',
                  fontFamily: 'var(--font-serif)', fontSize: 10,
                  color: 'var(--gold-dim)', letterSpacing: 1,
                }}
              >
                返回今日
              </button>
            </div>
          )}

          {/* ── 上下文徽章列（仅问道 tab）── */}
          {activeTab === 'chat' && isToday && (contexts.length > 0 || ctxLoading) && (
            <div style={{
              display: 'flex', flexWrap: 'wrap', gap: 4,
              padding: '6px 12px', borderTop: '1px solid var(--ink-trace)',
              background: 'var(--deep)',
            }}>
              {ctxLoading && (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  fontFamily: 'var(--font-serif)', fontSize: 10,
                  color: 'var(--gold-dim)', letterSpacing: 1,
                  padding: '1px 7px', border: '1px solid var(--ink-trace)',
                }}>
                  <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--gold-dim)',
                    animation: 'spirit-dot 1.2s ease-in-out infinite', display: 'inline-block',
                  }} />
                  读取中…
                </span>
              )}
              {contexts.map(c => (
                <span key={c.path} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  fontFamily: 'var(--font-serif)', fontSize: 10,
                  color: 'var(--jade)', letterSpacing: 1,
                  padding: '1px 7px', border: '1px solid rgba(74,125,94,0.35)',
                }}>
                  <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--jade)', flexShrink: 0 }} />
                  {c.label}
                  <button onClick={() => setContexts(prev => prev.filter(x => x.path !== c.path))} style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--ink-dim)', fontSize: 11, padding: 0, lineHeight: 1, marginLeft: 2,
                  }}>×</button>
                </span>
              ))}
            </div>
          )}

          {/* ── 输入区（仅问道 tab + 今日）── */}
          {activeTab === 'chat' && isToday && (
            <div style={{ borderTop: '1px solid var(--ink-trace)', position: 'relative', flexShrink: 0 }}>
              {cmdMenu && filteredCmds.length > 0 && (
                <div style={{
                  position: 'absolute', bottom: '100%', left: 0, right: 0,
                  background: 'var(--deep)', border: '1px solid var(--ink-trace)', borderBottom: 'none',
                  maxHeight: 260, overflowY: 'auto',
                }}>
                  {filteredCmds.map((c, idx) => (
                    <button
                      key={c.cmd}
                      onMouseDown={e => { e.preventDefault(); selectCmd(c) }}
                      onMouseEnter={() => setCmdIdx(idx)}
                      style={{
                        display: 'flex', alignItems: 'baseline', gap: 12,
                        width: '100%', textAlign: 'left', padding: '9px 14px',
                        background: idx === cmdIdx ? 'rgba(212,168,67,0.08)' : 'none',
                        border: 'none', borderBottom: '1px solid var(--ink-trace)', cursor: 'pointer',
                        borderLeft: idx === cmdIdx ? '2px solid var(--gold-dim)' : '2px solid transparent',
                      }}
                    >
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--gold-dim)', flexShrink: 0, width: 52 }}>
                        {c.cmd}
                      </span>
                      <span style={{ fontFamily: 'var(--font-serif)', fontSize: 11, color: 'var(--ink-dim)', letterSpacing: 1 }}>
                        {c.desc}
                      </span>
                    </button>
                  ))}
                  <div style={{ padding: '4px 14px', fontFamily: 'var(--font-serif)', fontSize: 9,
                    color: 'var(--ink-trace)', letterSpacing: 1,
                  }}>↑↓ 导航　Enter 选中　Esc 关闭</div>
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', padding: '10px 14px' }}>
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={handleInput}
                  onKeyDown={handleKeyDown}
                  placeholder={ctxLoading ? '页面读取中，请稍候…' : '问一问器灵，或输入 / 查看命令...'}
                  rows={1}
                  disabled={loading || ctxLoading}
                  style={{
                    flex: 1, background: 'none', border: 'none', outline: 'none',
                    resize: 'none', fontFamily: 'var(--font-serif)', fontSize: 13,
                    color: 'var(--ink)', lineHeight: 1.7, overflow: 'hidden',
                    opacity: loading || ctxLoading ? 0.5 : 1,
                  }}
                />
                <button onClick={() => send()} disabled={loading || ctxLoading || !input.trim()} style={{
                  background: 'none', border: 'none', cursor: loading || ctxLoading || !input.trim() ? 'default' : 'pointer',
                  color: loading || ctxLoading || !input.trim() ? 'var(--ink-trace)' : 'var(--gold)',
                  fontSize: 16, paddingBottom: 2, flexShrink: 0, transition: 'color 0.2s',
                }}>→</button>
              </div>
            </div>
          )}
        </div>
      )}

      <style>{`
        @keyframes spirit-breathe {
          0%,100% { box-shadow:0 0 10px rgba(212,168,67,0.12); }
          50%      { box-shadow:0 0 22px rgba(212,168,67,0.35),0 0 40px rgba(212,168,67,0.08); }
        }
        @keyframes spirit-ring {
          0%,100% { opacity:0.25; transform:scale(1); }
          50%      { opacity:0.6; transform:scale(1.06); }
        }
        @keyframes spirit-blink { 0%,100%{opacity:0.4;} 50%{opacity:0;} }
        @keyframes spirit-dot {
          0%,80%,100%{transform:scale(0.6);opacity:0.3;}
          40%{transform:scale(1.2);opacity:1;}
        }
        @keyframes spin { to{transform:rotate(360deg);} }

      `}</style>
    </>
  )
}
