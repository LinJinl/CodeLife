'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { MessageItem }  from '@/components/spirit/MessageItem'
import { useSpiritChat } from '@/components/spirit/useSpiritChat'
import type { Message } from '@/components/spirit/types'
import { addDays, dateInTZ } from '@/lib/spirit/time'

function todayStr() { return dateInTZ() }

function fmtDate(d: string) {
  const today = todayStr()
  if (d === today) return { main: '今日', sub: '' }
  if (d === addDays(today, -1)) return { main: '昨日', sub: '' }
  const [y, m, day] = d.split('-')
  const now = new Date()
  const isSameYear = parseInt(y) === now.getFullYear()
  return { main: `${parseInt(m)}月${parseInt(day)}日`, sub: isSameYear ? '' : y }
}

// ── 历史消息只读视图 ──────────────────────────────────────────

function ReadonlyMessages({ messages, loading }: { messages: Message[]; loading: boolean }) {
  const bottomRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  if (loading) return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100%', color: 'var(--ink-trace)',
      fontFamily: 'var(--font-sans)', fontSize: 12, letterSpacing: 3,
    }}>
      读取中…
    </div>
  )
  if (messages.length === 0) return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100%', color: 'var(--ink-trace)',
      fontFamily: 'var(--font-sans)', fontSize: 12, letterSpacing: 3,
    }}>
      此日无对话记录
    </div>
  )
  return (
    <div style={{ padding: '40px clamp(24px, 8%, 80px) 32px' }}>
      {messages.map((msg, i) => (
        <div key={i} style={{ marginBottom: 32 }}>
          <MessageItem msg={msg} isLast={false} loading={false} phase="idle" />
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  )
}

// ── 主页面 ────────────────────────────────────────────────────

export default function SpiritPage() {
  const router = useRouter()
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  const [dateList,       setDateList]       = useState<string[]>([])
  const [selectedDate,   setSelectedDate]   = useState(todayStr())
  const [readonlyMsgs,   setReadonlyMsgs]   = useState<Message[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)

  const chat    = useSpiritChat(true)
  const isToday = selectedDate === todayStr()

  useEffect(() => {
    fetch('/api/spirit/session?list=true')
      .then(r => r.json())
      .then((data: string[]) => setDateList(data))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (isToday) { setReadonlyMsgs([]); return }
    setLoadingHistory(true)
    fetch(`/api/spirit/session?date=${selectedDate}`)
      .then(r => r.json())
      .then((data: { messages: Message[] }) => setReadonlyMsgs(data.messages ?? []))
      .catch(() => setReadonlyMsgs([]))
      .finally(() => setLoadingHistory(false))
  }, [selectedDate, isToday])

  const handleDateClick = useCallback((date: string) => setSelectedDate(date), [])

  if (!mounted) return null

  return createPortal(
    <div style={{
      position:   'fixed',
      inset:      0,
      zIndex:     9999,
      display:    'flex',
      background: 'var(--void)',
    }}>

      {/* ── 左侧边栏 ───────────────────────────────────── */}
      <aside style={{
        width:          200,
        flexShrink:     0,
        display:        'flex',
        flexDirection:  'column',
        background:     'var(--cave)',
        borderRight:    '1px solid var(--ink-trace)',
      }}>
        {/* 头部：标题 + 退出 */}
        <div style={{
          padding:      '20px 18px 16px',
          borderBottom: '1px solid var(--ink-trace)',
          display:      'flex',
          alignItems:   'flex-start',
          justifyContent: 'space-between',
        }}>
          <div>
            <div style={{
              fontFamily:    'var(--font-xiaowei), serif',
              fontSize:      15,
              letterSpacing: 5,
              color:         'var(--gold)',
              marginBottom:  5,
            }}>
              器灵·青霄
            </div>
            <div style={{
              fontFamily:    'var(--font-mono)',
              fontSize:      9,
              color:         'var(--ink-dim)',
              letterSpacing: 2,
            }}>
              FOCUS MODE
            </div>
          </div>

          {/* 退出专注 */}
          <button
            onClick={() => router.back()}
            title="退出专注"
            style={{
              background:  'none',
              border:      '1px solid var(--ink-trace)',
              cursor:      'pointer',
              color:       'var(--ink-dim)',
              fontSize:    10,
              padding:     '3px 7px',
              lineHeight:  1.4,
              letterSpacing: 1,
              fontFamily:  'var(--font-sans)',
              transition:  'border-color 0.15s, color 0.15s',
              flexShrink:  0,
              marginTop:   2,
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = 'var(--gold-dim)'
              e.currentTarget.style.color       = 'var(--gold-dim)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = 'var(--ink-trace)'
              e.currentTarget.style.color       = 'var(--ink-dim)'
            }}
          >
            收起
          </button>
        </div>

        {/* 金线分隔 */}
        <div style={{
          height:     1,
          margin:     '0 18px',
          background: 'linear-gradient(90deg, var(--gold-line), transparent)',
          flexShrink: 0,
        }} />

        {/* 日期列表 */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
          <DateItem
            label="今日"
            active={isToday}
            onClick={() => handleDateClick(todayStr())}
          />
          {dateList.filter(d => d !== todayStr()).length > 0 && (
            <div style={{
              margin:     '8px 18px 4px',
              height:     1,
              background: 'var(--ink-trace)',
              opacity:    0.5,
            }} />
          )}
          {dateList.filter(d => d !== todayStr()).map(date => {
            const { main, sub } = fmtDate(date)
            return (
              <DateItem
                key={date}
                label={main}
                sub={sub}
                active={selectedDate === date}
                onClick={() => handleDateClick(date)}
              />
            )
          })}
        </div>
      </aside>

      {/* ── 右侧对话区 ─────────────────────────────────── */}
      <div style={{
        flex:          1,
        display:       'flex',
        flexDirection: 'column',
        overflow:      'hidden',
        minWidth:      0,
        background:    'var(--void)',
      }}>

        {/* 顶部装饰线 */}
        <div style={{
          height:     1,
          background: 'linear-gradient(90deg, var(--gold-line) 0%, transparent 60%)',
          flexShrink: 0,
        }} />

        {/* 消息流 */}
        <div ref={chat.scrollRef} onScroll={chat.handleScroll} style={{ flex: 1, overflowY: 'auto', minHeight: 0, position: 'relative' }}>
          {isToday ? (
            <>
              {chat.messages.length === 0 && !chat.loading && <TodayEmpty />}
              <div style={{ padding: '40px clamp(24px, 8%, 80px) 32px' }}>
                {chat.messages.map((msg, i) => (
                  <div key={i} style={{ marginBottom: 32 }}>
                    <MessageItem
                      msg={msg}
                      isLast={i === chat.messages.length - 1}
                      loading={chat.loading}
                      phase={chat.phase}
                      onPermission={
                        msg.permissionRequest
                          ? (d) => chat.handlePermission(i, d, msg.permissionRequest!.token)
                          : undefined
                      }
                    />
                  </div>
                ))}
                <div ref={chat.bottomRef} />
              </div>
            </>
          ) : (
            <ReadonlyMessages messages={readonlyMsgs} loading={loadingHistory} />
          )}
        </div>

        {/* 斜杠命令菜单 */}
        {isToday && chat.cmdMenu && chat.filteredCmds.length > 0 && (
          <div style={{
            borderTop:  '1px solid var(--ink-trace)',
            background: 'var(--cave)',
            maxHeight:  220,
            overflowY:  'auto',
            flexShrink: 0,
          }}>
            {chat.filteredCmds.map((c, idx) => (
              <button
                key={c.cmd}
                onMouseDown={e => { e.preventDefault(); chat.selectCmd(c) }}
                onMouseEnter={() => chat.setCmdIdx(idx)}
                style={{
                  display:       'flex',
                  alignItems:    'baseline',
                  gap:           16,
                  width:         '100%',
                  textAlign:     'left',
                  padding:       '10px clamp(24px, 8%, 80px)',
                  background:    idx === chat.cmdIdx ? 'var(--gold-wash)' : 'none',
                  border:        'none',
                  borderBottom:  '1px solid var(--ink-trace)',
                  borderLeft:    `2px solid ${idx === chat.cmdIdx ? 'var(--gold-dim)' : 'transparent'}`,
                  cursor:        'pointer',
                }}
              >
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--gold-dim)', width: 72, flexShrink: 0 }}>
                  {c.cmd}
                </span>
                <span style={{ fontFamily: 'var(--font-sans)', fontSize: 11, color: 'var(--ink-dim)', letterSpacing: 1 }}>
                  {c.desc}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* 输入区 */}
        {isToday ? (
          <div style={{
            borderTop:  '1px solid var(--ink-trace)',
            padding:    '16px clamp(24px, 8%, 80px)',
            background: 'var(--cave)',
            flexShrink: 0,
          }}>
            {/* 注入的上下文标签 */}
            {chat.contexts.length > 0 && (
              <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
                {chat.contexts.map(ctx => (
                  <span key={ctx.path} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{
                      fontFamily:    'var(--font-serif)',
                      fontSize:      9,
                      letterSpacing: 1,
                      color:         'var(--jade)',
                      padding:       '1px 7px',
                      border:        '1px solid rgba(74,125,94,0.3)',
                    }}>
                      ¶ {ctx.label}
                    </span>
                    <button
                      onClick={() => chat.setContexts(prev => prev.filter(c => c.path !== ctx.path))}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-trace)', fontSize: 11, padding: 0, lineHeight: 1 }}
                    >×</button>
                  </span>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14 }}>
              <textarea
                ref={chat.inputRef}
                value={chat.input}
                onChange={chat.handleInput}
                onKeyDown={chat.handleKeyDown}
                placeholder={chat.ctxLoading ? '正在提取页面内容…' : '同一问道，或输入 / 召唤命令'}
                disabled={chat.loading || chat.ctxLoading}
                rows={1}
                style={{
                  flex:          1,
                  background:    'none',
                  border:        'none',
                  outline:       'none',
                  fontFamily:    'var(--font-serif)',
                  fontSize:      14,
                  color:         'var(--ink)',
                  letterSpacing: 0.5,
                  lineHeight:    1.75,
                  resize:        'none',
                  maxHeight:     140,
                  overflowY:     'auto',
                  padding:       0,
                }}
              />
              <button
                onClick={() => chat.send()}
                disabled={chat.loading || !chat.input.trim()}
                style={{
                  background:    'none',
                  border:        `1px solid ${chat.loading || !chat.input.trim() ? 'var(--ink-trace)' : 'var(--gold-dim)'}`,
                  color:         chat.loading || !chat.input.trim() ? 'var(--ink-trace)' : 'var(--gold-dim)',
                  padding:       '6px 22px',
                  fontFamily:    'var(--font-xiaowei), serif',
                  fontSize:      14,
                  letterSpacing: 4,
                  cursor:        chat.loading || !chat.input.trim() ? 'not-allowed' : 'pointer',
                  flexShrink:    0,
                  transition:    'border-color 0.2s, color 0.2s',
                }}
              >
                {chat.loading ? '…' : '问'}
              </button>
            </div>
          </div>
        ) : (
          <div style={{
            borderTop:     '1px solid var(--ink-trace)',
            padding:       '12px 0',
            textAlign:     'center',
            fontFamily:    'var(--font-mono)',
            fontSize:      9,
            color:         'var(--ink-trace)',
            letterSpacing: 3,
            flexShrink:    0,
          }}>
            HISTORY · READ ONLY
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}

// ── 子组件 ────────────────────────────────────────────────────

function DateItem({ label, sub, active, onClick }: {
  label: string; sub?: string; active: boolean; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display:        'flex',
        justifyContent: 'space-between',
        alignItems:     'center',
        width:          '100%',
        padding:        '9px 18px',
        background:     active ? 'rgba(212,168,67,0.07)' : 'none',
        border:         'none',
        borderLeft:     `2px solid ${active ? 'var(--gold-dim)' : 'transparent'}`,
        cursor:         'pointer',
        fontFamily:     'var(--font-serif)',
        fontSize:       12,
        letterSpacing:  1,
        color:          active ? 'var(--gold)' : 'var(--ink-dim)',
        textAlign:      'left',
        transition:     'color 0.15s, background 0.15s',
      }}
    >
      <span>{label}</span>
      {sub && (
        <span style={{ fontSize: 9, color: 'var(--ink-trace)', fontFamily: 'var(--font-mono)' }}>
          {sub}
        </span>
      )}
    </button>
  )
}

function TodayEmpty() {
  return (
    <div style={{
      position:      'absolute',
      inset:         0,
      display:       'flex',
      flexDirection: 'column',
      alignItems:    'center',
      justifyContent:'center',
      pointerEvents: 'none',
      userSelect:    'none',
    }}>
      <div style={{
        width:        8,
        height:       8,
        borderRadius: '50%',
        background:   'var(--gold)',
        boxShadow:    '0 0 12px var(--gold), 0 0 28px rgba(212,168,67,0.3)',
        marginBottom: 20,
        animation:    'spirit-breathe 3s ease-in-out infinite',
      }} />
      <div style={{
        fontFamily:    'var(--font-serif)',
        fontSize:      14,
        color:         'var(--ink-dim)',
        letterSpacing: 4,
        marginBottom:  10,
      }}>
        器灵候问
      </div>
      <div style={{
        fontFamily:    'var(--font-mono)',
        fontSize:      9,
        color:         'var(--ink-trace)',
        letterSpacing: 2,
      }}>
        / 召唤命令 · Enter 发送
      </div>
    </div>
  )
}
