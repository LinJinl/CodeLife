'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

interface CandidatePreview {
  id: string
  proposedType: string
  reason: string
  confidence: number
}

export function MemoryConsoleActions({ pendingCandidates }: { pendingCandidates: CandidatePreview[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  async function run(id: string, action: () => Promise<Response>, okText: string) {
    if (busy) return
    setBusy(id)
    setMessage(null)
    try {
      const res = await action()
      const data = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      setMessage(okText)
      router.refresh()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  function maintenance(action: string, body: Record<string, unknown> = {}) {
    return fetch('/api/spirit/maintenance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...body }),
    })
  }

  function candidate(id: string, action: 'promote' | 'ignore' | 'merge') {
    return fetch('/api/spirit/candidates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action }),
    })
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        <ActionButton disabled={Boolean(busy)} onClick={() => run(
          'extract_skills',
          () => maintenance('extract_skills', { days: 14 }),
          '技能提炼已完成',
        )}>提炼技能</ActionButton>
        <ActionButton disabled={Boolean(busy)} onClick={() => run(
          'extract_preferences',
          () => maintenance('extract_preferences', { days: 14 }),
          '偏好提炼已完成',
        )}>提炼偏好</ActionButton>
        <ActionButton disabled={Boolean(busy)} onClick={() => run(
          'refresh_blog_cache',
          () => maintenance('refresh_blog_cache'),
          '博客正文缓存已刷新',
        )}>刷新博客缓存</ActionButton>
        <ActionButton disabled={Boolean(busy)} onClick={() => run(
          'reset_cursor',
          () => maintenance('reset_cursor'),
          '提炼游标已重置',
        )}>重置游标</ActionButton>
      </div>

      {message && (
        <div style={{
          fontFamily: 'var(--font-serif)',
          fontSize: 12,
          color: 'var(--ink-dim)',
          lineHeight: 1.8,
        }}>{message}</div>
      )}

      <div style={{
        border: '1px solid var(--ink-trace)',
        background: 'var(--deep)',
        padding: '14px 16px',
      }}>
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          color: 'var(--gold-dim)',
          letterSpacing: 2,
          marginBottom: 12,
        }}>
          待审核候选 {pendingCandidates.length}
        </div>
        {pendingCandidates.length === 0 ? (
          <div style={{ fontFamily: 'var(--font-serif)', fontSize: 12, color: 'var(--ink-trace)' }}>
            当前没有待处理候选。
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {pendingCandidates.slice(0, 8).map(item => (
              <div key={item.id} style={{
                border: '1px solid var(--ink-trace)',
                background: 'var(--void)',
                padding: '10px 12px',
              }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--jade)' }}>
                    {item.proposedType}
                  </span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--ink-trace)' }}>
                    conf {item.confidence.toFixed(2)}
                  </span>
                </div>
                <div style={{ fontFamily: 'var(--font-serif)', fontSize: 12, color: 'var(--ink-dim)', lineHeight: 1.7, marginBottom: 10 }}>
                  {item.reason}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <MiniButton disabled={Boolean(busy)} onClick={() => run(
                    `promote:${item.id}`,
                    () => candidate(item.id, 'promote'),
                    '候选已晋升',
                  )}>晋升</MiniButton>
                  <MiniButton disabled={Boolean(busy)} onClick={() => run(
                    `merge:${item.id}`,
                    () => candidate(item.id, 'merge'),
                    '候选已标记合并',
                  )}>合并</MiniButton>
                  <MiniButton disabled={Boolean(busy)} onClick={() => run(
                    `ignore:${item.id}`,
                    () => candidate(item.id, 'ignore'),
                    '候选已忽略',
                  )}>忽略</MiniButton>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ActionButton({ children, disabled, onClick }: {
  children: React.ReactNode
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      style={{
        border: '1px solid var(--gold-line)',
        background: 'var(--deep)',
        color: disabled ? 'var(--ink-trace)' : 'var(--gold-dim)',
        cursor: disabled ? 'default' : 'pointer',
        fontFamily: 'var(--font-serif)',
        fontSize: 12,
        padding: '8px 12px',
        letterSpacing: 1,
      }}
    >
      {children}
    </button>
  )
}

function MiniButton({ children, disabled, onClick }: {
  children: React.ReactNode
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      style={{
        border: '1px solid var(--ink-trace)',
        background: 'transparent',
        color: disabled ? 'var(--ink-trace)' : 'var(--ink-dim)',
        cursor: disabled ? 'default' : 'pointer',
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        padding: '4px 8px',
      }}
    >
      {children}
    </button>
  )
}
