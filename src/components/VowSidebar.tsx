'use client'

import { useEffect, useState, useCallback } from 'react'
import type { Vow } from '@/lib/spirit/memory'

function todayStr() { return new Date().toISOString().slice(0, 10) }

/** 距截止日期剩余天数 */
function daysLeft(deadline: string): number {
  return Math.ceil((new Date(deadline).getTime() - Date.now()) / 86400000)
}

/** 誓约总时长（天） */
function totalDays(vow: Vow): number {
  return Math.ceil((new Date(vow.deadline).getTime() - new Date(vow.createdAt).getTime()) / 86400000)
}

/** 某个子目标已完成的天数（每日型） */
function completedCount(dates: string[]): number {
  return dates.length
}

/** 今天是否已完成 */
function doneToday(dates: string[]): boolean {
  return dates.includes(todayStr())
}

function SubGoalRow({ goal, isDaily }: {
  goal: Vow['subGoals'][number]
  isDaily: boolean
}) {
  const today   = isDaily ? doneToday(goal.completedDates) : goal.done
  const count   = completedCount(goal.completedDates)

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, padding: '3px 0' }}>
      <span style={{
        fontSize: 8,
        marginTop: 3,
        color: today ? 'var(--jade)' : 'var(--ink-trace)',
        flexShrink: 0,
      }}>
        {today ? '✓' : '○'}
      </span>
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
        {isDaily && count > 0 && (
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 9,
            color: 'var(--ink-dim)',
            marginTop: 1,
          }}>
            已完成 {count} 日
          </div>
        )}
      </div>
    </div>
  )
}

function VowCard({ vow }: { vow: Vow }) {
  const isDaily   = vow.subGoals.some(g =>
    ['blog_daily', 'leetcode_daily', 'github_daily', 'any_daily'].includes(g.metric)
  )
  const left      = daysLeft(vow.deadline)
  const total     = totalDays(vow)
  const todayDone = isDaily && vow.subGoals.every(g =>
    ['blog_daily', 'leetcode_daily', 'github_daily', 'any_daily'].includes(g.metric)
      ? doneToday(g.completedDates)
      : g.done
  )

  // 进度：已过天数 / 总天数
  const elapsed  = total - Math.max(left, 0)
  const progress = Math.min(elapsed / total, 1)

  return (
    <div style={{
      padding: '10px 12px',
      borderBottom: '1px solid var(--ink-trace)',
    }}>
      {/* 标题行 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
        <span style={{
          fontFamily: 'var(--font-xiaowei), serif',
          fontSize: 12,
          color: 'var(--gold)',
          letterSpacing: 2,
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {vow.title}
        </span>
        {isDaily && (
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 8,
            color: todayDone ? 'var(--jade)' : 'var(--gold-dim)',
            flexShrink: 0,
          }}>
            {todayDone ? '今日 ✓' : '今日 ○'}
          </span>
        )}
      </div>

      {/* 进度条 */}
      <div style={{
        height: 2,
        background: 'var(--ink-trace)',
        borderRadius: 1,
        marginBottom: 7,
        overflow: 'hidden',
      }}>
        <div style={{
          height: '100%',
          width: `${progress * 100}%`,
          background: left <= 3 ? 'var(--seal)' : 'var(--gold-dim)',
          borderRadius: 1,
          transition: 'width 0.3s ease',
        }} />
      </div>

      {/* 子目标 */}
      {vow.subGoals.map((g, i) => (
        <SubGoalRow key={i} goal={g} isDaily={isDaily} />
      ))}

      {/* 截止 */}
      <div style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 8,
        color: left <= 3 ? 'var(--seal)' : 'var(--ink-trace)',
        marginTop: 6,
        letterSpacing: 0.5,
      }}>
        截止 {vow.deadline}
        {left >= 0 ? `　剩 ${left} 天` : '　已过期'}
      </div>
    </div>
  )
}

export function VowSidebar() {
  const [vows,    setVows]    = useState<Vow[]>([])
  const [open,    setOpen]    = useState(false)
  const [loading, setLoading] = useState(true)

  const fetchVows = useCallback(async () => {
    try {
      const res  = await fetch('/api/spirit/vows')
      const data = await res.json() as Vow[]
      setVows(data)
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchVows() }, [fetchVows])

  const SIDEBAR_W = 200

  return (
    <div style={{
      position: 'fixed',
      top:    0,
      left:   0,
      bottom: 0,
      width:  SIDEBAR_W,
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
          top: 110,
          right: -22,
          width: 22,
          height: 56,
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
        padding: '72px 12px 10px',  // 72px 留出导航栏高度
        borderBottom: '1px solid var(--ink-trace)',
        flexShrink: 0,
      }}>
        <div style={{
          fontFamily: 'var(--font-xiaowei), serif',
          fontSize: 11,
          letterSpacing: 4,
          color: 'var(--gold-dim)',
        }}>
          目 标 追 踪
        </div>
        <div style={{
          fontFamily: 'var(--font-serif)',
          fontSize: 9,
          color: 'var(--ink-trace)',
          letterSpacing: 1,
          marginTop: 2,
        }}>
          {vows.length} 个活跃誓约
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
        {!loading && vows.length === 0 && (
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
        {vows.map(v => <VowCard key={v.id} vow={v} />)}
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
