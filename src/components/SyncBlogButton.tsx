'use client'

import { useState } from 'react'

export function SyncBlogButton() {
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')

  async function handleSync() {
    setState('loading')
    try {
      const res = await fetch('/api/sync?source=blog')
      if (!res.ok) throw new Error('sync failed')
      setState('done')
      // 同步完成后刷新页面拿最新数据
      setTimeout(() => window.location.reload(), 800)
    } catch {
      setState('error')
      setTimeout(() => setState('idle'), 2000)
    }
  }

  const label = state === 'loading' ? '同步中…' : state === 'done' ? '完成' : state === 'error' ? '失败' : '同步修为'

  return (
    <button
      onClick={handleSync}
      disabled={state === 'loading' || state === 'done'}
      style={{
        fontFamily: 'var(--font-serif)',
        fontSize: 11,
        letterSpacing: 2,
        padding: '4px 14px',
        border: '1px solid',
        borderColor: state === 'error' ? 'rgba(180,60,60,0.5)' : 'var(--ink-trace)',
        color: state === 'loading' ? 'var(--ink-dim)' : state === 'error' ? 'rgba(180,60,60,0.8)' : 'var(--ink-dim)',
        background: 'transparent',
        cursor: state === 'loading' || state === 'done' ? 'default' : 'pointer',
        opacity: state === 'loading' ? 0.6 : 1,
        transition: 'opacity 0.2s',
      }}
    >
      {label}
    </button>
  )
}
