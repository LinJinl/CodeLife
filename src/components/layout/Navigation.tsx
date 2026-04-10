'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'

const NAV_ITEMS = [
  { href: '/',         label: '洞府' },
  { href: '/blog',     label: '心法' },
  { href: '/leetcode', label: '铸剑' },
  { href: '/github',   label: '声望' },
  { href: '/resources',label: '藏典' },
]

export function Navigation({ siteTitle }: { siteTitle: string }) {
  const pathname = usePathname()
  const [scrolled, setScrolled]           = useState(false)
  const [theme, setTheme]                 = useState<'dark' | 'light'>('dark')

  useEffect(() => {
    // 从 localStorage 初始化主题，并补写 cookie（供后续 SSR 读取）
    const saved = localStorage.getItem('theme') as 'dark' | 'light' | null
    const initial = saved ?? 'dark'
    setTheme(initial)
    document.documentElement.dataset.theme = initial === 'light' ? 'light' : ''
    document.cookie = `theme=${initial}; path=/; max-age=31536000; SameSite=Lax`
  }, [])

  useEffect(() => {
    function onScroll() { setScrolled(window.scrollY > 20) }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    localStorage.setItem('theme', next)
    // 同步写 cookie，供服务端在 SSR 时读取以消除闪烁
    document.cookie = `theme=${next}; path=/; max-age=31536000; SameSite=Lax`
    document.documentElement.dataset.theme = next === 'light' ? 'light' : ''
  }

  const isLight = theme === 'light'

  return (
    <header className="nav-header" style={{
      position: 'fixed',
      top: 0, left: 0, right: 0,
      zIndex: 50,
      textAlign: 'center',
      padding: '26px 0 20px',
      background: scrolled ? 'var(--nav-bg-scroll)' : 'var(--nav-bg-top)',
      backdropFilter: scrolled ? 'blur(14px)' : 'none',
      transition: 'background 0.3s ease, backdrop-filter 0.3s ease, padding-right 0.3s ease',
    }}>
      {/* 标题行 + 主题切换 */}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{
          fontFamily: 'var(--font-xiaowei), serif',
          fontSize: 17,
          letterSpacing: 14,
          textIndent: 14,
          color: 'var(--gold)',
          opacity: 0.88,
          marginBottom: 10,
        }}>
          {siteTitle.split('').join('　')}
        </div>

        {/* 昼夜切换 */}
        <button
          onClick={toggleTheme}
          title={isLight ? '切换夜间' : '切换白天'}
          style={{
            position: 'absolute',
            right: 24,
            top: -4,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--ink-dim)',
            fontSize: 13,
            padding: '4px 6px',
            lineHeight: 1,
            opacity: 0.7,
            transition: 'opacity 0.2s, color 0.2s',
          }}
          onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
          onMouseLeave={e => (e.currentTarget.style.opacity = '0.7')}
        >
          {isLight ? '☾' : '☀'}
        </button>
      </div>

      <div style={{
        width: 180, height: 1, margin: '0 auto 10px',
        background: 'linear-gradient(90deg, transparent, var(--gold-line), transparent)',
      }} />

      <nav style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        {NAV_ITEMS.map((item, i) => {
          const isActive = item.href === '/'
            ? pathname === '/'
            : pathname.startsWith(item.href)

          return (
            <span key={item.href} style={{ display: 'flex', alignItems: 'center' }}>
              {i > 0 && (
                <span style={{ color: 'var(--ink-trace)', fontSize: 9, userSelect: 'none', padding: '0 2px' }}>
                  ·
                </span>
              )}
              <Link href={item.href} style={{
                fontFamily: 'var(--font-serif), serif',
                fontSize: 13,
                letterSpacing: 4,
                textIndent: 4,
                color: isActive ? 'var(--gold)' : 'var(--ink-dim)',
                padding: '4px 18px',
                textDecoration: 'none',
                display: 'block',
                transition: 'color 0.4s',
              }}>
                {item.label}
                {isActive && (
                  <div style={{ textAlign: 'center', fontSize: 8, color: 'var(--gold)', marginTop: 1 }}>·</div>
                )}
              </Link>
            </span>
          )
        })}
      </nav>
    </header>
  )
}
