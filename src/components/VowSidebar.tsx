'use client'

import { useEffect, useState, useCallback } from 'react'
import type { Vow, VowSubGoal } from '@/lib/spirit/memory'
import { addDays, dateInTZ, recentDates, weekStart } from '@/lib/spirit/time'

function todayStr() { return dateInTZ() }

function getWeekStartLocal(): string {
  return weekStart()
}

function daysLeft(deadline: string): number {
  return Math.ceil((new Date(deadline).getTime() - Date.now()) / 86400000)
}

function totalDays(vow: Vow): number {
  return Math.max(
    Math.ceil((new Date(vow.deadline).getTime() - new Date(vow.createdAt).getTime()) / 86400000),
    1,
  )
}

function calcStreak(dates: string[]): number {
  if (dates.length === 0) return 0
  const set   = new Set(dates)
  const today = todayStr()
  const start = set.has(today) ? today : [...dates].sort().pop()!
  let streak  = 0
  let cursor = start
  while (set.has(cursor)) {
    streak++
    cursor = addDays(cursor, -1)
  }
  return streak
}

const DAILY_METRICS = ['blog_daily', 'leetcode_daily', 'github_daily', 'any_daily']

// ── 进度环 ────────────────────────────────────────────────────────

function ProgressRing({ pct, size = 36, color }: { pct: number; size?: number; color: string }) {
  const r    = (size - 5) / 2
  const circ = 2 * Math.PI * r
  const dash = Math.min(pct, 1) * circ
  return (
    <svg width={size} height={size} style={{ flexShrink: 0 }}>
      <circle
        cx={size / 2} cy={size / 2} r={r}
        fill="none" stroke="var(--ink-trace)" strokeWidth={2.5}
      />
      <circle
        cx={size / 2} cy={size / 2} r={r}
        fill="none" stroke={color} strokeWidth={2.5}
        strokeDasharray={`${dash} ${circ}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dasharray 0.4s ease' }}
      />
      <text
        x={size / 2} y={size / 2 + 3.5}
        textAnchor="middle"
        fill={color}
        fontSize={8}
        fontFamily="var(--font-mono)"
      >
        {Math.round(pct * 100)}%
      </text>
    </svg>
  )
}

// ── 近 7 天打卡点 ─────────────────────────────────────────────────

function StreakDots({ dates }: { dates: string[] }) {
  const set  = new Set(dates)
  const dots = recentDates(7).reverse().map(s => ({ date: s, done: set.has(s) }))
  return (
    <div style={{ display: 'flex', gap: 2, marginTop: 4 }}>
      {dots.map(({ date, done }) => (
        <div
          key={date}
          title={date}
          style={{
            width: 6, height: 6,
            borderRadius: 1,
            background: done ? 'var(--jade)' : 'var(--ink-trace)',
            transition: 'background 0.2s',
          }}
        />
      ))}
    </div>
  )
}

// ── 子目标行 ──────────────────────────────────────────────────────

function SubGoalRow({
  goal, idx, vowId, onToggle,
}: {
  goal:     VowSubGoal
  idx:      number
  vowId:    string
  onToggle: (idx: number, done: boolean) => void
}) {
  const today = todayStr()
  const ws    = getWeekStartLocal()
  const isManual = goal.metric === 'manual'

  let primaryText = ''
  let subText     = ''
  let todayOk     = false
  let pct: number | null = null

  if (DAILY_METRICS.includes(goal.metric)) {
    todayOk     = goal.completedDates.includes(today)
    const streak = calcStreak(goal.completedDates)
    primaryText = `连续 ${streak} 天`
    subText     = `累计 ${goal.completedDates.length} 日`
  } else if (goal.metric === 'count_total') {
    const cur   = goal.currentCount ?? 0
    const tgt   = goal.target ?? 0
    primaryText = `${cur} / ${tgt}`
    pct         = tgt > 0 ? Math.min(cur / tgt, 1) : 0
    todayOk     = goal.done
  } else if (goal.metric === 'count_weekly') {
    const cur   = goal.weeklyLog?.[ws] ?? 0
    const tgt   = goal.target ?? 0
    primaryText = `本周 ${cur} / ${tgt}`
    pct         = tgt > 0 ? Math.min(cur / tgt, 1) : 0
  } else if (goal.metric === 'streak_N') {
    const streak = calcStreak(goal.completedDates)
    const tgt    = goal.target ?? 0
    primaryText  = `连续 ${streak} / ${tgt} 天`
    pct          = tgt > 0 ? Math.min(streak / tgt, 1) : 0
    todayOk      = goal.done
  } else if (goal.metric === 'reach_points') {
    primaryText = `目标 ${goal.target} 修为`
    subText     = goal.done ? '已达成' : '进行中'
    todayOk     = goal.done
  } else {
    // manual
    primaryText = goal.done ? '已完成' : '待标记'
    todayOk     = goal.done
  }

  const showDots = DAILY_METRICS.includes(goal.metric) && goal.completedDates.length >= 0

  return (
    <div style={{ padding: '4px 0' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
        {/* 状态按钮 */}
        {isManual ? (
          <button
            onClick={() => onToggle(idx, !goal.done)}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              fontSize: 10,
              marginTop: 2,
              color: todayOk ? 'var(--jade)' : 'var(--ink-trace)',
              flexShrink: 0,
              lineHeight: 1,
            }}
            title={goal.done ? '点击取消完成' : '点击标记完成'}
          >
            {todayOk ? '✓' : '○'}
          </button>
        ) : (
          <span style={{
            fontSize: 10, marginTop: 2,
            color: todayOk ? 'var(--jade)' : 'var(--ink-trace)',
            flexShrink: 0,
          }}>
            {todayOk ? '✓' : '○'}
          </span>
        )}

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontFamily: 'var(--font-serif)',
            fontSize: 10,
            color: 'var(--ink-mid)',
            lineHeight: 1.5,
            letterSpacing: 0.3,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {goal.description}
          </div>
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 9,
            color: 'var(--ink-dim)',
            marginTop: 1,
          }}>
            {primaryText}
            {subText ? `　${subText}` : ''}
          </div>

          {pct !== null && (
            <div style={{
              height: 2,
              background: 'var(--ink-trace)',
              borderRadius: 1,
              marginTop: 3,
              overflow: 'hidden',
            }}>
              <div style={{
                height: '100%',
                width: `${pct * 100}%`,
                background: pct >= 1 ? 'var(--jade)' : 'var(--gold-dim)',
                borderRadius: 1,
                transition: 'width 0.3s ease',
              }} />
            </div>
          )}

          {showDots && <StreakDots dates={goal.completedDates} />}
        </div>
      </div>
    </div>
  )
}

// ── 誓约卡片 ──────────────────────────────────────────────────────

function VowCard({
  vow,
  onAbandon,
  onToggleManual,
}: {
  vow:           Vow
  onAbandon:     (id: string) => void
  onToggleManual:(id: string, idx: number, done: boolean) => void
}) {
  const [confirmAbandon, setConfirmAbandon] = useState(false)
  const [expanded,       setExpanded]       = useState(false)

  const left  = daysLeft(vow.deadline)
  const total = totalDays(vow)

  const elapsed  = total - Math.max(left, 0)
  const timePct  = Math.min(elapsed / total, 1)

  const today      = todayStr()
  const dailyGoals = vow.subGoals.filter(g => DAILY_METRICS.includes(g.metric))
  const todayDone  = dailyGoals.length > 0 && dailyGoals.every(g => g.completedDates.includes(today))

  const hasGrace  = (vow.graceCount ?? 0) > 0
  const graceLeft = hasGrace ? (vow.graceCount! - (vow.graceUsed ?? 0)) : null

  const ringColor = left <= 3 ? 'var(--seal)' : timePct >= 1 ? 'var(--jade)' : 'var(--gold-dim)'
  const isClosed  = vow.status !== 'active' && vow.status !== 'paused'

  return (
    <div style={{
      padding: '10px 12px',
      borderBottom: '1px solid var(--ink-trace)',
      opacity: isClosed ? 0.6 : 1,
    }}>
      {/* 标题行 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        {/* 进度环 */}
        <ProgressRing pct={timePct} size={34} color={ringColor} />

        <div style={{ flex: 1, minWidth: 0 }}>
          <button
            onClick={() => setExpanded(v => !v)}
            style={{
              background: 'none', border: 'none', padding: 0,
              cursor: 'pointer', textAlign: 'left', width: '100%',
            }}
          >
            <div style={{
              fontFamily: 'var(--font-xiaowei), serif',
              fontSize: 12,
              color: 'var(--gold)',
              letterSpacing: 2,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {vow.title}
            </div>
          </button>

          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 2 }}>
            {dailyGoals.length > 0 && (
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 8,
                color: todayDone ? 'var(--jade)' : 'var(--gold-dim)',
              }}>
                {todayDone ? '今日 ✓' : '今日 ○'}
              </span>
            )}
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 8,
              color: left <= 3 ? 'var(--seal)' : 'var(--ink-trace)',
            }}>
              剩 {left >= 0 ? `${left} 天` : '已过期'}
            </span>
          </div>
        </div>

        {/* 放弃按钮 */}
        {!isClosed && (
          <div style={{ flexShrink: 0 }}>
            {confirmAbandon ? (
              <div style={{ display: 'flex', gap: 4 }}>
                <button
                  onClick={() => { onAbandon(vow.id); setConfirmAbandon(false) }}
                  style={{
                    background: 'var(--seal)',
                    border: 'none', borderRadius: 2,
                    padding: '2px 5px',
                    fontFamily: 'var(--font-serif)',
                    fontSize: 8,
                    color: '#fff',
                    cursor: 'pointer',
                  }}
                >
                  确认
                </button>
                <button
                  onClick={() => setConfirmAbandon(false)}
                  style={{
                    background: 'none',
                    border: '1px solid var(--ink-trace)',
                    borderRadius: 2,
                    padding: '2px 5px',
                    fontFamily: 'var(--font-serif)',
                    fontSize: 8,
                    color: 'var(--ink-dim)',
                    cursor: 'pointer',
                  }}
                >
                  取消
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmAbandon(true)}
                title="放弃此誓约"
                style={{
                  background: 'none',
                  border: 'none',
                  padding: '2px 4px',
                  cursor: 'pointer',
                  fontFamily: 'var(--font-serif)',
                  fontSize: 8,
                  color: 'var(--ink-trace)',
                  borderRadius: 2,
                  transition: 'color 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--seal)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--ink-trace)')}
              >
                放弃
              </button>
            )}
          </div>
        )}
      </div>

      {/* 子目标列表 */}
      {vow.subGoals.map((g, i) => (
        <SubGoalRow
          key={i}
          goal={g}
          idx={i}
          vowId={vow.id}
          onToggle={(idx, done) => onToggleManual(vow.id, idx, done)}
        />
      ))}

      {/* 展开详情：动机、截止 */}
      {expanded && (
        <div style={{
          marginTop: 6,
          padding: '6px 8px',
          background: 'rgba(0,0,0,0.15)',
          borderRadius: 4,
          fontFamily: 'var(--font-serif)',
          fontSize: 9,
          color: 'var(--ink-dim)',
          lineHeight: 1.7,
          letterSpacing: 0.5,
        }}>
          {vow.motivation && <div>「{vow.motivation}」</div>}
          <div style={{ marginTop: vow.motivation ? 4 : 0 }}>
            截止 {vow.deadline}
            {vow.verdict && <span style={{ marginLeft: 8, color: 'var(--gold-dim)' }}>{vow.verdict}</span>}
          </div>
        </div>
      )}

      {/* 宽限剩余 */}
      {hasGrace && (
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 8,
          color: (graceLeft ?? 0) <= 1 ? 'var(--seal)' : 'var(--ink-trace)',
          marginTop: 5,
        }}>
          宽限剩余 {graceLeft} 次
        </div>
      )}
    </div>
  )
}

// ── 主侧边栏 ──────────────────────────────────────────────────────

export function VowSidebar() {
  const [vows,       setVows]       = useState<Vow[]>([])
  const [open,       setOpen]       = useState(false)
  const [loading,    setLoading]    = useState(true)
  const [showClosed, setShowClosed] = useState(false)

  const fetchVows = useCallback(async () => {
    try {
      const res  = await fetch('/api/spirit/vows?status=all')
      const data = await res.json() as Vow[]
      setVows(data)
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchVows() }, [fetchVows])

  const activeVows = vows.filter(v => v.status === 'active' || v.status === 'paused')
  const closedVows = vows.filter(v => v.status === 'fulfilled' || v.status === 'broken' || v.status === 'expired')

  const handleAbandon = useCallback(async (id: string) => {
    await fetch('/api/spirit/vows', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ id, status: 'broken' }),
    })
    setVows(prev => prev.map(v => v.id === id ? { ...v, status: 'broken' } : v))
  }, [])

  const handleToggleManual = useCallback(async (vowId: string, idx: number, done: boolean) => {
    await fetch('/api/spirit/vows', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ id: vowId, subGoalIdx: idx, done }),
    })
    setVows(prev => prev.map(v => {
      if (v.id !== vowId) return v
      const subGoals = v.subGoals.map((g, i) => i === idx ? { ...g, done } : g)
      return { ...v, subGoals }
    }))
  }, [])

  const SIDEBAR_W = 200

  return (
    <div style={{
      position: 'fixed',
      top: 0, left: 0, bottom: 0,
      width: SIDEBAR_W,
      zIndex: 9990,
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--cave)',
      borderRight: '1px solid var(--ink-trace)',
      boxShadow: '2px 0 16px rgba(0,0,0,0.25)',
      transform: open ? 'translateX(0)' : `translateX(-${SIDEBAR_W - 16}px)`,
      transition: 'transform 0.3s ease',
    }}>
      {/* 收起/展开 tab */}
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          position: 'absolute',
          top: 110, right: -22,
          width: 22, height: 56,
          background: 'var(--cave)',
          border: '1px solid var(--ink-trace)',
          borderLeft: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--ink-dim)',
          fontSize: 10,
          padding: 0,
          borderRadius: '0 4px 4px 0',
        }}
        title={open ? '收起' : '目标追踪'}
      >
        {open ? (
          <span style={{ fontSize: 10 }}>‹</span>
        ) : (
          <span style={{
            writingMode: 'vertical-rl',
            textOrientation: 'mixed',
            fontSize: 9,
            letterSpacing: 3,
            color: 'var(--gold-dim)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 4,
          }}>
            <span style={{ fontSize: 8 }}>›</span>
            目标
          </span>
        )}
      </button>

      {/* 头部 */}
      <div style={{
        padding: '72px 12px 10px',
        borderBottom: '1px solid var(--ink-trace)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <div style={{
            fontFamily: 'var(--font-xiaowei), serif',
            fontSize: 11,
            letterSpacing: 4,
            color: 'var(--gold-dim)',
          }}>
            目 标 追 踪
          </div>
          <button
            onClick={fetchVows}
            title="刷新"
            style={{
              background: 'none', border: 'none', padding: 0,
              cursor: 'pointer', fontSize: 9,
              color: 'var(--ink-trace)',
              marginLeft: 'auto',
            }}
          >
            ↺
          </button>
        </div>
        <div style={{
          fontFamily: 'var(--font-serif)',
          fontSize: 9,
          color: 'var(--ink-trace)',
          letterSpacing: 1,
          marginTop: 2,
        }}>
          {activeVows.length} 个活跃誓约
        </div>
      </div>

      {/* 誓约列表 */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading && (
          <div style={{
            padding: '20px 12px',
            fontFamily: 'var(--font-serif)',
            fontSize: 10,
            color: 'var(--ink-trace)',
            letterSpacing: 1,
          }}>
            读取中…
          </div>
        )}

        {!loading && activeVows.length === 0 && (
          <div style={{
            padding: '24px 12px',
            fontFamily: 'var(--font-serif)',
            fontSize: 11,
            color: 'var(--ink-trace)',
            letterSpacing: 1,
            lineHeight: 2,
            textAlign: 'center',
          }}>
            尚无誓约<br/>
            <span style={{ fontSize: 9 }}>对器灵说「/立誓」以开始</span>
          </div>
        )}

        {activeVows.map(v => (
          <VowCard
            key={v.id}
            vow={v}
            onAbandon={handleAbandon}
            onToggleManual={handleToggleManual}
          />
        ))}

        {/* 已结束的誓约（折叠） */}
        {closedVows.length > 0 && (
          <div>
            <button
              onClick={() => setShowClosed(v => !v)}
              style={{
                width: '100%',
                background: 'none',
                border: 'none',
                borderTop: '1px solid var(--ink-trace)',
                padding: '8px 12px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                fontFamily: 'var(--font-serif)',
                fontSize: 9,
                color: 'var(--ink-trace)',
                letterSpacing: 1,
              }}
            >
              <span style={{ fontSize: 8 }}>{showClosed ? '▾' : '▸'}</span>
              已结束 ({closedVows.length})
            </button>
            {showClosed && closedVows.map(v => (
              <VowCard
                key={v.id}
                vow={v}
                onAbandon={handleAbandon}
                onToggleManual={handleToggleManual}
              />
            ))}
          </div>
        )}
      </div>

      {/* 底部提示 */}
      <div style={{
        padding: '8px 12px',
        borderTop: '1px solid var(--ink-trace)',
        fontFamily: 'var(--font-serif)',
        fontSize: 9,
        color: 'var(--ink-trace)',
        letterSpacing: 1,
        flexShrink: 0,
      }}>
        数据每次对话同步更新
      </div>
    </div>
  )
}
