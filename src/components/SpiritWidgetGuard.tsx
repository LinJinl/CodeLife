'use client'

import { usePathname } from 'next/navigation'
import SpiritWidget    from './SpiritWidget'

/**
 * 在专注模式（/spirit）下隐藏浮窗，该页面有独立的全屏对话界面。
 */
export function SpiritWidgetGuard({ name }: { name?: string }) {
  const pathname = usePathname()
  if (pathname.startsWith('/spirit')) return null
  return <SpiritWidget name={name} />
}
