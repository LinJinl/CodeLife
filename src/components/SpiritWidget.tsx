'use client'

import { useState, useRef, useEffect, useCallback, memo } from 'react'
import { usePathname } from 'next/navigation'
import ReactMarkdown from 'react-markdown'
import type { SpiritEvent, LibraryCard } from '@/lib/spirit/protocol'

/** 单条执行步骤，归属于消息，随消息持久化 */
interface ExecutionStep {
  id:       string
  type:     'task' | 'tool'
  display:  string   // agent 展示名 / 工具展示名
  desc?:    string   // task: 子任务描述 / tool: 输入参数摘要
  brief?:   string   // tool: 结果摘要
  links?:   { title: string; url: string }[]   // web_search / fetch_url 的可点击结果
  done:     boolean
}

interface PermissionRequest {
  token:    string
  command:  string
  workdir:  string
  level:    'moderate' | 'destructive' | 'write'
  resolved: boolean
}

interface Message {
  role:               'user' | 'assistant'
  content:            string
  timestamp:          string
  cards?:             LibraryCard[]
  steps?:             ExecutionStep[]
  strategy?:          'direct' | 'sequential' | 'parallel'
  ctxLabels?:         string[]   // 发送时附带的页面上下文标签（用于历史记录展示）
  permissionRequest?: PermissionRequest
  thinking?:          string     // <think> 内容，可折叠显示
}

const SLASH_COMMANDS = [
  { cmd: '/观心', desc: '分析近期修炼状态',     fill: '近况如何' },
  { cmd: '/指路', desc: '推荐今日该做什么',     fill: '今天该做什么' },
  { cmd: '/问道', desc: '提问技术或概念问题',   fill: '我想问：' },
  { cmd: '/立誓', desc: '设定一个可验证的目标', fill: '我想定一个目标：' },
  { cmd: '/藏经', desc: '收藏文章到藏经阁',     fill: '帮我收藏这篇文章：' },
  { cmd: '/寻典', desc: '检索藏经阁中的文章',   fill: '帮我检索藏经阁中关于' },
  { cmd: '/此页', desc: '将当前页面内容注入上下文', fill: '' },
  { cmd: '/install', desc: '装载 MCP 法器包',   fill: '/install ' },
]

const MIN_W       = 300
const MAX_W_RATIO = 0.65
function defaultWidth() {
  if (typeof window === 'undefined') return 460
  return Math.round(Math.min(Math.max(window.innerWidth * 0.36, 400), 560))
}

function todayStr() { return new Date().toISOString().slice(0, 10) }

// ── 藏经阁结果卡片 ─────────────────────────────────────────────

function LibraryCards({ entries }: { entries: LibraryCard[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
      {entries.map(e => (
        <div key={e.id} style={{
          background: 'var(--deep)',
          border: '1px solid var(--ink-trace)',
          padding: '10px 14px',
          borderRadius: 2,
        }}>
          {e.url ? (
            <a href={e.url} target="_blank" rel="noopener noreferrer" style={{
              fontFamily: 'var(--font-serif)', fontSize: 13,
              color: 'var(--ink)', letterSpacing: 1, lineHeight: 1.5,
              textDecoration: 'none', borderBottom: '1px solid var(--ink-trace)',
              display: 'inline',
            }}>
              {e.title}
            </a>
          ) : (
            <span style={{ fontFamily: 'var(--font-serif)', fontSize: 13, color: 'var(--ink)', letterSpacing: 1 }}>
              {e.title}
            </span>
          )}
          {e.summary && (
            <div style={{
              fontFamily: 'var(--font-serif)', fontSize: 11,
              color: 'var(--ink-dim)', lineHeight: 1.7, margin: '6px 0 8px',
              letterSpacing: 0.3,
            }}>
              {e.summary}
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <a href="/resources" style={{
              fontFamily: 'var(--font-serif)', fontSize: 9, letterSpacing: 1,
              padding: '1px 6px', border: '1px solid',
              borderColor: categoryColor(e.category),
              color: categoryColor(e.category),
              textDecoration: 'none', flexShrink: 0,
            }}>
              {e.category}
            </a>
            {e.tags.map(tag => (
              <a key={tag} href={`/resources?tag=${encodeURIComponent(tag)}`} style={{
                fontFamily: 'var(--font-serif)', fontSize: 9, letterSpacing: 1,
                padding: '1px 6px', border: '1px solid var(--ink-trace)',
                color: 'var(--ink-dim)', textDecoration: 'none',
              }}>
                {tag}
              </a>
            ))}
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--ink-trace)', marginLeft: 'auto' }}>
              {new Date(e.savedAt).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }).replace('/', '-')}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}

const CATEGORY_COLORS: Record<string, string> = {
  '算法': 'var(--jade)', '系统设计': 'var(--gold-dim)', '工程实践': 'var(--gold-dim)',
  '前端': 'var(--seal)', '后端': 'var(--seal)', '数学': 'var(--ink-mid)', '其他': 'var(--ink-dim)',
}
function categoryColor(cat: string) { return CATEGORY_COLORS[cat] ?? 'var(--ink-dim)' }

// ── 思考过程折叠块 ─────────────────────────────────────────────

function ThinkingBlock({ content, streaming }: { content: string; streaming: boolean }) {
  const [expanded, setExpanded] = useState(false)
  if (!content && !streaming) return null
  return (
    <div style={{ marginBottom: 8 }}>
      <button
        onClick={() => setExpanded(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          background: 'none', border: 'none', cursor: 'pointer',
          padding: '2px 0', color: 'var(--ink-dim)',
        }}
      >
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: 1,
          color: streaming ? 'var(--gold-dim)' : 'var(--ink-dim)',
        }}>
          {streaming ? '推演中' : '推演'}
        </span>
        <span style={{
          fontSize: 8, color: 'var(--ink-trace)',
          transform: expanded ? 'rotate(90deg)' : 'none',
          display: 'inline-block', transition: 'transform 0.15s',
        }}>▶</span>
      </button>
      {expanded && content && (
        <div style={{
          marginTop: 4, padding: '6px 10px',
          borderLeft: '2px solid var(--ink-trace)',
          fontFamily: 'var(--font-serif)', fontSize: 11,
          color: 'var(--ink-dim)', lineHeight: 1.7,
          letterSpacing: 0.3, whiteSpace: 'pre-wrap',
          maxHeight: 240, overflowY: 'auto',
        }}>
          {content}
          {streaming && <span style={{ opacity: 0.4, animation: 'spirit-blink 1s infinite' }}>▌</span>}
        </div>
      )}
    </div>
  )
}

// ── 消息条目（memo 避免输入时重渲染） ────────────────────────

const MessageItem = memo(function MessageItem({
  msg, isLast, loading, phase, onPermission,
}: {
  msg:           Message
  isLast:        boolean
  loading:       boolean
  phase:         'idle' | 'thinking' | 'tooling' | 'replying'
  onPermission?: (decision: 'once' | 'session' | 'deny') => void
}) {
  const streamingThinking = loading && isLast && phase === 'thinking' && !!msg.thinking
  if (msg.role === 'user') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
        <div style={{
          fontFamily: 'var(--font-serif)', fontSize: 13,
          color: 'var(--ink-mid)', lineHeight: 1.7,
          maxWidth: '80%', padding: '7px 12px',
          background: 'var(--surface)', border: '1px solid var(--ink-trace)',
          whiteSpace: 'pre-wrap', letterSpacing: 0.3,
        }}>
          {msg.content}
        </div>
        {msg.ctxLabels && msg.ctxLabels.length > 0 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {msg.ctxLabels.map(label => (
              <span key={label} style={{
                fontFamily: 'var(--font-serif)', fontSize: 9, letterSpacing: 1,
                color: 'var(--jade)', padding: '1px 6px',
                border: '1px solid rgba(74,125,94,0.3)',
              }}>
                ¶ {label}
              </span>
            ))}
          </div>
        )}
      </div>
    )
  }

  const streaming  = loading && isLast
  const steps      = msg.steps ?? []
  const hasSteps   = steps.length > 0
  const hasCards   = (msg.cards?.length ?? 0) > 0
  const hideText   = hasCards && !streaming
  // 并行模式：所有子任务完成，synthesizer 正在整合（"整合中"专用）
  const isSynthesizing = streaming && hasSteps && steps.every(s => s.done) && !msg.content
    && msg.strategy === 'parallel'
  // 非并行模式：步骤全完成但文字未到（qingxiao 正在生成回复）
  const isWaitingReply = streaming && hasSteps && steps.every(s => s.done) && !msg.content
    && msg.strategy !== 'parallel'
  // 步骤完成后，内容已有时淡化步骤（作为背景记录）
  const stepsDim = hasSteps && !streaming && !!msg.content

  return (
    <div style={{ borderLeft: '1px solid var(--ink-trace)', paddingLeft: 12, marginLeft: 2 }}>

      {/* ── 思考过程折叠块 ── */}
      {(msg.thinking || streamingThinking) && (
        <ThinkingBlock content={msg.thinking ?? ''} streaming={streamingThinking} />
      )}

      {/* ── 执行步骤区（持久化，随消息保留） ── */}
      {hasSteps && (
        <div style={{
          marginBottom: msg.content ? 10 : 4,
          opacity: stepsDim ? 0.65 : 1,
          transition: 'opacity 0.4s',
        }}>
          {steps.map(step => (
            <div key={step.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 7, padding: '3px 0' }}>
              {step.done
                ? <span style={{ fontSize: 9, color: 'var(--jade)', flexShrink: 0, lineHeight: '18px' }}>✓</span>
                : <div style={{
                    width: 4, height: 4, borderRadius: '50%', flexShrink: 0, marginTop: 7,
                    border: '1px solid var(--gold-dim)', borderTopColor: 'transparent',
                    animation: 'spin 0.8s linear infinite',
                  }} />
              }
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: 1,
                  color: step.done ? 'var(--jade)' : 'var(--gold-dim)',
                }}>
                  {step.display}
                  {/* 完成后显示结果摘要 */}
                  {step.done && step.brief && (
                    <span style={{ color: 'var(--ink-dim)', marginLeft: 6, fontFamily: 'var(--font-serif)', letterSpacing: 0.3 }}>
                      {step.brief}
                    </span>
                  )}
                </span>
                {/* 参数摘要（执行中显示，完成后保留作为上下文） */}
                {step.desc && (
                  <span style={{
                    fontFamily: 'var(--font-mono)', fontSize: 9,
                    color: 'var(--ink-dim)',
                    letterSpacing: 0.3, lineHeight: 1.5,
                  }}>
                    {step.desc}
                  </span>
                )}
                {/* 可点击链接（web_search / fetch_url 的结果） */}
                {step.links && step.links.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 2 }}>
                    {step.links.map((link, i) => (
                      <a key={i} href={link.url} target="_blank" rel="noopener noreferrer"
                        style={{
                          fontFamily: 'var(--font-serif)', fontSize: 10,
                          color: 'var(--jade)', letterSpacing: 0.3, lineHeight: 1.5,
                          textDecoration: 'none',
                          borderBottom: '1px solid rgba(74,125,94,0.25)',
                          display: 'block',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          maxWidth: '100%',
                        }}
                        title={link.url}
                      >
                        ↗ {link.title}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
          {/* 并行模式：等待 synthesizer 整合 */}
          {isSynthesizing && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 5,
              paddingTop: 6, paddingLeft: 11,
            }}>
              {[0, 1, 2].map(i => (
                <div key={i} style={{
                  width: 3, height: 3, borderRadius: '50%', background: 'var(--gold-dim)',
                  animation: `spirit-dot 1.2s ease-in-out ${i * 0.2}s infinite`,
                }} />
              ))}
              <span style={{
                fontFamily: 'var(--font-serif)', fontSize: 10,
                color: 'var(--gold-dim)', letterSpacing: 1, opacity: 0.7,
              }}>整合中</span>
            </div>
          )}
          {/* 直接/顺序模式：工具跑完，等待 AI 开始回复 */}
          {isWaitingReply && (
            <div style={{ display: 'flex', gap: 5, alignItems: 'center', paddingTop: 6, paddingLeft: 11 }}>
              {[0, 1, 2].map(i => (
                <div key={i} style={{
                  width: 3, height: 3, borderRadius: '50%', background: 'var(--gold-dim)',
                  animation: `spirit-dot 1.2s ease-in-out ${i * 0.2}s infinite`,
                }} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── 初始推演 dots（还没有任何步骤和内容）── */}
      {streaming && !hasSteps && !msg.content && (
        <div style={{ display: 'flex', gap: 5, alignItems: 'center', paddingBottom: 4 }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{
              width: 3, height: 3, borderRadius: '50%', background: 'var(--gold-dim)',
              animation: `spirit-dot 1.2s ease-in-out ${i * 0.2}s infinite`,
            }} />
          ))}
        </div>
      )}

      {/* ── 权限确认区 ── */}
      {msg.permissionRequest && !msg.permissionRequest.resolved && onPermission && (() => {
        const pr      = msg.permissionRequest!
        const isWrite = pr.level === 'write'
        const isDest  = pr.level === 'destructive'
        const accentColor = isDest ? 'var(--seal)' : isWrite ? 'var(--jade)' : 'var(--gold-dim)'
        // write 操作每次都需要单独确认，不提供"本次会话允许"
        const decisions = isWrite
          ? (['once', 'deny'] as const)
          : (['once', 'session', 'deny'] as const)
        const labelMap: Record<string, string> = {
          once:    isWrite ? '确认' : '执行一次',
          session: '本次会话允许',
          deny:    '拒绝',
        }
        const headerText = isDest ? '⚠ 高危操作' : isWrite ? '写操作确认' : '需要确认'

        return (
          <div style={{
            margin: '8px 0', padding: '10px 14px',
            border: `1px solid ${accentColor}`,
            borderRadius: 2, background: 'var(--deep)',
          }}>
            <div style={{
              fontFamily: 'var(--font-mono)', fontSize: 10,
              color: accentColor, letterSpacing: 1, marginBottom: 6,
            }}>
              {headerText}
            </div>
            <div style={{
              fontFamily: 'var(--font-serif)', fontSize: 12,
              color: 'var(--ink)', lineHeight: 1.6,
              marginBottom: 10,
            }}>
              {pr.command}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {decisions.map(d => (
                <button
                  key={d}
                  onClick={() => onPermission(d)}
                  style={{
                    fontFamily: 'var(--font-serif)', fontSize: 10, letterSpacing: 1,
                    padding: '3px 10px', border: '1px solid',
                    borderColor: d === 'deny' ? 'var(--ink-trace)'
                      : d === 'session' ? 'var(--jade)'
                      : accentColor,
                    color: d === 'deny' ? 'var(--ink-dim)'
                      : d === 'session' ? 'var(--jade)'
                      : accentColor,
                    background: 'transparent', cursor: 'pointer', borderRadius: 1,
                  }}
                >
                  {labelMap[d]}
                </button>
              ))}
            </div>
          </div>
        )
      })()}

      {/* ── 消息正文 ── */}
      {!hideText && (
        <div className="spirit-md">
          {msg.content
            ? <ReactMarkdown>{msg.content}</ReactMarkdown>
            : (!streaming ? <span style={{ color: 'var(--ink-trace)' }}>…</span> : null)
          }
          {streaming && phase === 'replying' && (
            <span style={{ opacity: 0.4, animation: 'spirit-blink 1s infinite' }}>▌</span>
          )}
        </div>
      )}
      {hasCards && <LibraryCards entries={msg.cards!} />}
    </div>
  )
})

// ── 主组件 ───────────────────────────────────────────────────

interface MCPInfo {
  allowDynamicInstall: boolean
  adapters: { namespace: string; name: string }[]
  tools: { name: string; displayName: string; description: string; category: string; params: string[] }[]
}

export default function SpiritWidget({ name = '青霄' }: { name?: string }) {
  const pathname = usePathname()

  // SSR 始终 false，hydration 完成后从 localStorage 恢复，避免服务端/客户端不一致
  const [open, setOpen] = useState(false)
  useEffect(() => { setOpen(localStorage.getItem('spirit-open') === '1') }, [])
  const [messages,   setMessages]   = useState<Message[]>([])
  const [input,      setInput]      = useState('')
  const [loading,    setLoading]    = useState(false)
  const [phase,      setPhase]      = useState<'idle'|'thinking'|'tooling'|'replying'>('idle')
  const [cmdMenu,    setCmdMenu]    = useState(false)
  const [cmdFilter,  setCmdFilter]  = useState('')
  const [cmdIdx,     setCmdIdx]     = useState(0)
  const [panelW,     setPanelW]     = useState(defaultWidth)
  // 上下文：支持多个叠加
  const [contexts,   setContexts]   = useState<{ text: string; path: string; label: string }[]>([])
  const [ctxLoading, setCtxLoading] = useState(false)
  // Tab 切换
  const [activeTab, setActiveTab] = useState<'chat' | 'tools'>('chat')
  // 法器 Tab 数据
  const [mcpData,    setMcpData]    = useState<MCPInfo | null>(null)
  const [toolList,   setToolList]   = useState<{ name: string; displayName: string; description: string; category: string }[]>([])
  const [installPkg, setInstallPkg] = useState('')
  const [installing, setInstalling] = useState(false)

  // 正在构建的卡片
  const pendingCards = useRef<LibraryCard[]>([])

  const bottomRef  = useRef<HTMLDivElement>(null)
  const inputRef   = useRef<HTMLTextAreaElement>(null)
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
      // 直接写 CSS variable → 主内容实时跟随，无需等 React re-render
      document.documentElement.style.setProperty('--spirit-panel-w', `${w}px`)
      setPanelW(w)
    }
    function onUp() {
      if (!dragging.current) return
      dragging.current = false
      document.body.style.userSelect  = ''
      document.body.style.cursor      = ''
      document.body.style.transition  = ''  // 恢复 CSS 里定义的 transition
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
    // 拖拽时禁用 body 的 transition，避免内容区跟随有延迟
    document.body.style.transition  = 'none'
  }

  // 加载今日会话
  useEffect(() => {
    if (!open) return
    fetch(`/api/spirit/session?date=${todayStr()}`)
      .then(r => r.json())
      .then((conv: { messages: Message[] }) => { if (conv.messages.length > 0) setMessages(conv.messages) })
      .catch(() => {})
  }, [open])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, phase])

  const saveSession = useCallback((msgs: Message[]) => {
    if (!msgs.length) return
    fetch('/api/spirit/session', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: msgs }),
    }).catch(() => {})
  }, [])

  /** 更新最后一条消息（步骤/策略写入用） */
  const updateLastMsg = useCallback((updater: (msg: Message) => Message) => {
    setMessages(prev => {
      if (prev.length === 0) return prev
      const updated = [...prev]
      updated[updated.length - 1] = updater(updated[updated.length - 1])
      return updated
    })
  }, [])

  // 权限弹窗按钮回调：调用 approve API，成功后触发新轮次
  const handlePermission = useCallback((msgIdx: number, decision: 'once' | 'session' | 'deny', token: string) => {
    // 立即标记 resolved，隐藏按钮
    setMessages(prev => {
      if (!prev[msgIdx]) return prev
      const updated = [...prev]
      updated[msgIdx] = {
        ...updated[msgIdx],
        permissionRequest: { ...updated[msgIdx].permissionRequest!, resolved: true },
      }
      return updated
    })
    if (decision === 'deny') {
      send('取消，不要执行该命令')
      return
    }
    // 通知服务端批准令牌，再触发新轮次
    fetch('/api/spirit/approve', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ token, decision }),
    })
      .then(r => r.json())
      .then((data: { ok?: boolean }) => {
        if (data.ok) send('已确认，请继续执行')
        else         send('确认请求失败，请重试')
      })
      .catch(() => send('确认请求失败，请重试'))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function resolveContent(raw: string): string {
    const matched = SLASH_COMMANDS.find(c => c.cmd === raw.trim())
    return matched ? (matched.fill || matched.cmd) : raw
  }

  async function loadPageContext(path = pathname): Promise<{ text: string; path: string } | null> {
    if (ctxLoading) return null
    // 已加载过则直接返回现有数据（不重复请求）
    const existing = contexts.find(c => c.path === path)
    if (existing) return existing
    setCtxLoading(true)
    try {
      const res  = await fetch(`/api/spirit/context?path=${encodeURIComponent(path)}`)
      const data = await res.json() as { text: string; path: string }
      if (data.text) {
        const label = path === '/' ? '主页' : path.split('/').filter(Boolean).join(' › ')
        const ctx = { text: data.text, path, label }
        setContexts(prev => [...prev, ctx])
        return ctx  // ← 返回刚加载的数据，供调用方直接使用（绕开 React 闭包）
      }
    } catch { /* ignore */ }
    finally { setCtxLoading(false) }
    return null
  }

  async function doInstall() {
    const pkg = installPkg.trim()
    if (!pkg || installing) return
    setInstalling(true)
    try {
      const res  = await fetch('/api/spirit/mcp', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'install', package: pkg }),
      })
      const data = await res.json() as { ok?: boolean; error?: string; toolCount?: number }
      if (data.ok) {
        setInstallPkg('')
        setMcpData(null)
        await loadTools(true)
      } else {
        alert(`装载失败：${data.error}`)
      }
    } catch (err) {
      alert(`装载失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setInstalling(false)
    }
  }

  async function loadTools(force = false) {
    if (mcpData && !force) return
    try {
      const res  = await fetch('/api/spirit/mcp')
      const data = await res.json() as MCPInfo
      setMcpData(data)
      setToolList(data.tools ?? [])
    } catch { /* ignore */ }
  }

  async function send(text?: string) {
    let raw = (text ?? input).trim()
    if (!raw || loading) return

    // 解析内联 /此页 — 触发上下文加载，从消息中移除
    // freshCtx：本次 send 中刚加载的 context（还未进入 React state）
    let freshCtx: { text: string; path: string } | null = null
    if (raw.includes('/此页')) {
      raw = raw.replace(/\/此页\s*/g, '').trim()
      freshCtx = await loadPageContext()
      if (!raw) { return }  // 纯 /此页 命令，只加载上下文
    }

    // ── /install 命令：动态安装 MCP 包 ──────────────────────
    const installMatch = raw.match(/^\/install\s+(.+)$/)
    if (installMatch) {
      const pkg = installMatch[1].trim()
      const userMsg: Message = { role: 'user', content: raw, timestamp: new Date().toISOString() }
      const loadingMsg: Message = { role: 'assistant', content: '', timestamp: new Date().toISOString() }
      setMessages(prev => [...prev, userMsg, loadingMsg])
      setInput(''); setCmdMenu(false); setLoading(true); setPhase('tooling')
      try {
        const res  = await fetch('/api/spirit/mcp', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'install', package: pkg }),
        })
        const data = await res.json() as { ok?: boolean; error?: string; message?: string; toolCount?: number }
        const reply = data.ok
          ? `已装载法器 **${pkg}**，共引入 ${data.toolCount} 个新工具。切换到「法器」Tab 查看。`
          : `装载失败：${data.error}`
        setMessages(prev => {
          const c = [...prev]
          c[c.length - 1] = { ...c[c.length - 1], content: reply }
          return c
        })
        if (data.ok) { setMcpData(null); loadTools(true) }
      } catch (err) {
        setMessages(prev => {
          const c = [...prev]
          c[c.length - 1] = { ...c[c.length - 1], content: `装载失败：${err instanceof Error ? err.message : String(err)}` }
          return c
        })
      } finally { setLoading(false); setPhase('idle') }
      return
    }

    const content = resolveContent(raw)

    // 合并已有 contexts 和本次刚加载的 freshCtx（绕开 React state 闭包）
    const allContexts = freshCtx && !contexts.some(c => c.path === freshCtx!.path)
      ? [...contexts, freshCtx]
      : contexts

    const ctxLabels = allContexts.length > 0
      ? allContexts.map(c => c.path === '/' ? '主页' : c.path.split('/').filter(Boolean).join(' › '))
      : undefined

    const userMsg: Message = { role: 'user', content: raw, timestamp: new Date().toISOString(), ctxLabels }
    const history = [...messages, userMsg]
    setMessages([...history, { role: 'assistant', content: '', timestamp: new Date().toISOString() }])
    setInput('')
    setCmdMenu(false)
    setContexts([])   // 上下文已注入消息，清空引用栏
    setLoading(true)
    setPhase('thinking')
    pendingCards.current = []

    // SSE 闭包变量（生命周期 = 本次请求）
    let stepSeq       = 0
    let curStrategy: string | null = null
    // tool name → [stepId, ...] FIFO，处理同名工具多次调用
    const pendingTools = new Map<string, string[]>()

    try {
      const ctxMessages = allContexts.map(c => ({
        role:    'system' as const,
        content: `[页面上下文 — ${c.path}]\n${c.text}`,
      }))

      const res = await fetch('/api/spirit/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            // 当前页面：让 AI 知道用户所在页面的完整 URL，需要时可用 fetch_url 抓取内容
            { role: 'system', content: `[当前页面：${typeof window !== 'undefined' ? window.location.href : pathname}]` },
            ...ctxMessages,
            ...history.map((m, i) => ({
              role: m.role,
              content: i === history.length - 1 && m.role === 'user' ? content : m.content,
            })),
          ],
        }),
      })
      if (!res.ok || !res.body) throw new Error(await res.text())

      const reader = res.body.getReader()
      const dec    = new TextDecoder()
      let buf = '', final: Message[] = []

      outer: while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const lines = buf.split('\n'); buf = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          let ev: SpiritEvent
          try { ev = JSON.parse(line.slice(6)) as SpiritEvent } catch { continue }

          switch (ev.type) {

            // ── 思考流（<think> 内容）───────────────────────
            case 'thinking':
              updateLastMsg(msg => ({ ...msg, thinking: (msg.thinking ?? '') + ev.chunk }))
              break

            // ── 文本流 ──────────────────────────────────────
            case 'text':
              setPhase('replying')
              setMessages(prev => {
                const c    = [...prev]
                const last = c[c.length - 1]
                const cards = pendingCards.current.length > 0 && !last.cards
                  ? pendingCards.current : last.cards
                c[c.length - 1] = { ...last, content: last.content + ev.chunk, cards }
                final = c; return c
              })
              break

            // ── 藏经阁卡片 ──────────────────────────────────
            case 'cards':
              pendingCards.current = [...pendingCards.current, ...ev.entries]
              break

            // ── 执行策略（planner 决策完成）────────────────
            case 'strategy':
              curStrategy = ev.mode
              updateLastMsg(msg => ({ ...msg, strategy: ev.mode }))
              break

            // ── 并行子任务 ──────────────────────────────────
            case 'task_start':
              updateLastMsg(msg => ({
                ...msg,
                steps: [...(msg.steps ?? []), {
                  id: ev.taskId, type: 'task',
                  display: ev.display, desc: ev.desc, done: false,
                }],
              }))
              break
            case 'task_done':
              updateLastMsg(msg => ({
                ...msg,
                steps: (msg.steps ?? []).map(s =>
                  s.id === ev.taskId ? { ...s, done: true } : s
                ),
              }))
              break

            // ── 工具调用（非 parallel 模式显示）────────────
            case 'tool_start':
              if (curStrategy !== 'parallel') {
                setPhase('tooling')
                const sid = `t${stepSeq++}`
                if (!pendingTools.has(ev.name)) pendingTools.set(ev.name, [])
                pendingTools.get(ev.name)!.push(sid)
                updateLastMsg(msg => ({
                  ...msg,
                  steps: [...(msg.steps ?? []), {
                    id: sid, type: 'tool', display: ev.display,
                    desc: ev.desc,   // 工具参数摘要（执行中可见）
                    done: false,
                  }],
                }))
              }
              break
            case 'tool_done':
              if (curStrategy !== 'parallel') {
                const ids = pendingTools.get(ev.name)
                const sid = ids?.shift()
                if (sid) {
                  updateLastMsg(msg => ({
                    ...msg,
                    steps: (msg.steps ?? []).map(s =>
                      s.id === sid ? { ...s, done: true, brief: ev.brief, links: ev.links } : s
                    ),
                  }))
                }
              }
              break

            // ── Sequential agent 切换（只更新 phase）───────
            case 'agent_start':
              setPhase('tooling')
              break
            case 'agent_end':
              break

            // ── 权限请求 ────────────────────────────────────
            case 'permission_request':
              updateLastMsg(msg => ({
                ...msg,
                permissionRequest: {
                  token:    ev.token,
                  command:  ev.command,
                  workdir:  ev.workdir,
                  level:    ev.level,
                  resolved: false,
                },
              }))
              break

            case 'error': throw new Error(ev.message)
            case 'done':  break outer
          }
        }
      }

      // 卡片收尾
      if (pendingCards.current.length > 0) {
        setMessages(prev => {
          const c = [...prev]
          if (!c[c.length - 1].cards) {
            c[c.length - 1] = { ...c[c.length - 1], cards: pendingCards.current }
          }
          final = c; return c
        })
      }
      saveSession(final.length > 0 ? final : history)
    } catch (err) {
      setMessages(prev => {
        const c = [...prev]
        c[c.length - 1] = { ...c[c.length - 1], content: `（器灵暂时沉默——${err instanceof Error ? err.message : '未知'}）` }
        saveSession(c); return c
      })
    } finally {
      setLoading(false); setPhase('idle')
    }
  }

  function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value
    const ta = e.target
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 120) + 'px'
    setInput(val)
    if (val.startsWith('/')) { setCmdMenu(true); setCmdFilter(val.slice(1).toLowerCase()); setCmdIdx(0) }
    else setCmdMenu(false)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (cmdMenu) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setCmdIdx(prev => Math.min(prev + 1, filteredCmds.length - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setCmdIdx(prev => Math.max(prev - 1, 0))
        return
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault()
        selectCmd(filteredCmds[cmdIdx])
        return
      }
      if (e.key === 'Escape') { setCmdMenu(false); return }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!ctxLoading) send() }
  }

  function selectCmd(cmd?: typeof SLASH_COMMANDS[number]) {
    if (!cmd) return
    setCmdMenu(false)
    // /此页 命令：加载上下文，保留已有输入文字
    if (cmd.cmd === '/此页') {
      loadPageContext()
      // 清掉输入里的 /此页 前缀，保留后续文字
      setInput(prev => prev.replace(/^\/此页\s*/, ''))
      setTimeout(() => inputRef.current?.focus(), 0)
      return
    }
    // /install 命令：在输入框保留 "/install " 前缀，等待用户输入包名
    const val = cmd.fill || cmd.cmd
    setInput(val)
    setTimeout(() => {
      const ta = inputRef.current; if (!ta) return
      ta.style.height = 'auto'
      ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length)
    }, 0)
  }

  const filteredCmds = SLASH_COMMANDS.filter(c => c.cmd.includes(cmdFilter) || c.desc.includes(cmdFilter))

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

            <button onClick={() => setOpen(false)} style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--ink-dim)', fontSize: 16, padding: '2px 6px', lineHeight: 1,
                marginLeft: 'auto',
              }}>×</button>
          </div>

          {/* ── Tab 栏 ── */}
          <div style={{
            display: 'flex', borderBottom: '1px solid var(--ink-trace)',
            flexShrink: 0, background: 'var(--cave)',
          }}>
            {(['chat', 'tools'] as const).map(tab => (
              <button key={tab} onClick={() => { setActiveTab(tab); if (tab === 'tools') loadTools() }}
                style={{
                  padding: '9px 22px', border: 'none', background: 'none', cursor: 'pointer',
                  fontFamily: 'var(--font-serif)', fontSize: 12, letterSpacing: 4, textIndent: 4,
                  color: activeTab === tab ? 'var(--gold)' : 'var(--ink-dim)',
                  borderBottom: activeTab === tab ? '1px solid var(--gold)' : '1px solid transparent',
                  marginBottom: -1, transition: 'color 0.2s',
                }}>
                {tab === 'chat' ? '问道' : '法器'}
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
                  {/* 内置法术 */}
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

                  {/* MCP 法器 */}
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

                  {/* 无 MCP 提示 */}
                  {mcpData.adapters.length === 0 && (
                    <div style={{ padding: '16px 16px 8px', borderTop: '1px solid var(--ink-trace)',
                      fontFamily: 'var(--font-serif)', fontSize: 11, color: 'var(--ink-trace)',
                      letterSpacing: 2, lineHeight: 2,
                    }}>
                      暂无 MCP 法器<br/>
                      <span style={{ fontSize: 10 }}>在 codelife.config.ts → mcpServers 配置，或用 /install 装载</span>
                    </div>
                  )}
                </>
              )}

              {/* 安装框 */}
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

          {/* 消息区（仅问道 tab）*/}
          {activeTab === 'chat' && <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 8px' }}>
            {messages.length === 0 && (
              <div style={{
                fontFamily: 'var(--font-serif)', fontSize: 13, color: 'var(--ink-dim)',
                letterSpacing: 2, textAlign: 'center', marginTop: 72, lineHeight: 3,
              }}>
                器灵在此<br/>
                <span style={{ fontSize: 10, color: 'var(--ink-trace)', letterSpacing: 1 }}>输入 / 查看快捷命令</span>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} style={{ marginBottom: 18 }}>
                <MessageItem
                  msg={msg}
                  isLast={i === messages.length - 1}
                  loading={loading}
                  phase={phase}
                  onPermission={msg.role === 'assistant' && msg.permissionRequest && !msg.permissionRequest.resolved
                    ? (d) => handlePermission(i, d, msg.permissionRequest!.token)
                    : undefined}
                />
              </div>
            ))}

            <div ref={bottomRef} />
          </div>}

          {/* 上下文徽章列（仅问道 tab）*/}
          {activeTab === 'chat' && (contexts.length > 0 || ctxLoading) && (
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

          {/* 输入区（仅问道 tab）*/}
          {activeTab === 'chat' && <div style={{ borderTop: '1px solid var(--ink-trace)', position: 'relative', flexShrink: 0 }}>
            {/* slash 菜单 */}
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
          </div>}
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

        .spirit-md { font-family: var(--font-serif); font-size: 13px; color: var(--ink); line-height: 1.85; }
        .spirit-md p { margin: 0.45em 0; }
        .spirit-md p:first-child { margin-top: 0; }
        .spirit-md p:last-child  { margin-bottom: 0; }
        .spirit-md h1,.spirit-md h2,.spirit-md h3 {
          color: var(--ink); font-weight: 500; letter-spacing: 1px;
          margin: 1em 0 0.35em; line-height: 1.4;
        }
        .spirit-md h1 { font-size: 15px; }
        .spirit-md h2 { font-size: 14px; border-bottom: 1px solid var(--ink-trace); padding-bottom: 0.2em; }
        .spirit-md h3 { font-size: 13px; color: var(--ink-mid); }
        .spirit-md ul,.spirit-md ol { padding-left: 1.4em; margin: 0.4em 0; }
        .spirit-md li { margin: 0.2em 0; }
        .spirit-md strong { color: var(--ink); font-weight: 600; }
        .spirit-md em { color: var(--ink-mid); font-style: italic; }
        .spirit-md a { color: var(--gold-dim); text-decoration: underline; }
        .spirit-md code {
          font-family: var(--font-mono); font-size: 11px;
          background: var(--surface); color: var(--gold-dim);
          padding: 1px 4px; border-radius: 2px;
        }
        .spirit-md pre {
          background: var(--deep); border: 1px solid var(--ink-trace);
          padding: 10px 14px; overflow-x: auto; margin: 0.6em 0; border-radius: 2px;
        }
        .spirit-md pre code {
          background: none; color: var(--ink); padding: 0;
          font-size: 11px; line-height: 1.6;
        }
        .spirit-md blockquote {
          border-left: 2px solid var(--gold-dim); margin: 0.6em 0;
          padding: 0.1em 0 0.1em 12px; color: var(--ink-dim);
        }
        .spirit-md hr { border: none; border-top: 1px solid var(--ink-trace); margin: 0.8em 0; }
        .spirit-md table { border-collapse: collapse; width: 100%; font-size: 12px; margin: 0.6em 0; }
        .spirit-md th,.spirit-md td { border: 1px solid var(--ink-trace); padding: 4px 8px; text-align: left; }
        .spirit-md th { color: var(--ink); background: var(--deep); }
      `}</style>
    </>
  )
}
