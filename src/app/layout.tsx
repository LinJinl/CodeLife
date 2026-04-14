import type { Metadata } from "next"
import { cookies }        from "next/headers"
import "./globals.css"
import { WorldBackground } from "@/components/layout/WorldBackground"
import { Navigation }      from "@/components/layout/Navigation"
import { SpiritWidgetGuard } from "@/components/SpiritWidgetGuard"
import { VowSidebar }      from "@/components/VowSidebar"
import { config }          from "@/lib/data"

// 中文字体体积极大，Turbopack 不支持 @vercel/turbopack-next/internal/font/google/font
// 统一改用 Google Fonts CDN <link> 加载，运行时按需拉取
export const metadata: Metadata = {
  title: '道途',
  description: config.site.subtitle,
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // 服务端读取主题 cookie，直接写入 <html data-theme>，无需客户端脚本，杜绝闪烁
  const cookieStore = await cookies()
  const themeCookie = cookieStore.get('theme')?.value
  const dataTheme   = themeCookie === 'light' ? 'light' : undefined

  return (
    // suppressHydrationWarning：客户端切换主题会改变 data-theme，React 无需警告此属性不匹配
    <html lang={config.site.locale ?? 'zh-CN'} data-theme={dataTheme} suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=ZCOOL+XiaoWei&family=Noto+Sans+SC:wght@300;400;500&family=Noto+Serif+SC:wght@300;400;600&family=JetBrains+Mono:wght@300;400&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <WorldBackground />
        <Navigation siteTitle={config.site.title} />
        {config.spirit?.enabled && <VowSidebar />}
        <main className="page-content pt-24">
          {children}
        </main>
        {config.spirit?.enabled && (
          <SpiritWidgetGuard name={config.spirit.name ?? '青霄'} />
        )}
      </body>
    </html>
  )
}
