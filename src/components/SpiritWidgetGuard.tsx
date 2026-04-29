'use client'

import { usePathname } from 'next/navigation'
import SpiritWidget    from './SpiritWidget'

/**
 * 在专注模式（/spirit）下隐藏浮窗，该页面有独立的全屏对话界面。
 * 其它 /spirit/* 管理页面仍保留器灵入口，方便边看边问。
 */
export function SpiritWidgetGuard({ name }: { name?: string }) {
  const pathname = usePathname()
  if (pathname === '/spirit') return null
  return <SpiritWidget name={name} />
}
