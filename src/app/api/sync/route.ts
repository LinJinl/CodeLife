/**
 * 手动同步端点
 *
 * 用于：
 *   - 在 Vercel/自托管服务器上配置定时任务（cron）
 *   - 本地调试：curl http://localhost:3002/api/sync?source=all&secret=xxx
 *   - Notion 暂不支持 Webhook 时的手动刷新
 *   - LeetCode 定时拉取（因无 Webhook）
 *
 * 使用方法：
 *   GET /api/sync?source=all&secret=<SYNC_SECRET>
 *   GET /api/sync?source=github&secret=<SYNC_SECRET>
 *   GET /api/sync?source=blog&secret=<SYNC_SECRET>
 *   GET /api/sync?source=leetcode&secret=<SYNC_SECRET>
 *
 * .env.local 设置：
 *   SYNC_SECRET=你自己设置的随机密钥（用于防止外部随意触发）
 *
 * 定时任务示例（在服务器上用 crontab 或 Vercel Cron）：
 *   # 每小时同步 GitHub
 *   0 * * * * curl https://yourdomain.dev/api/sync?source=github&secret=xxx
 *   # 每天凌晨同步 LeetCode
 *   0 2 * * * curl https://yourdomain.dev/api/sync?source=leetcode&secret=xxx
 *
 * Vercel Cron（vercel.json）：
 *   {
 *     "crons": [
 *       { "path": "/api/sync?source=github&secret=xxx", "schedule": "0 * * * *" },
 *       { "path": "/api/sync?source=leetcode&secret=xxx", "schedule": "0 2 * * *" }
 *     ]
 *   }
 */

import { revalidateTag } from 'next/cache'
import config from '../../../../codelife.config'
import { createBlogAdapter }     from '@/lib/adapters/blog'
import { createLeetcodeAdapter } from '@/lib/adapters/leetcode'

const SYNC_SECRET = process.env.SYNC_SECRET ?? ''

const VALID_SOURCES = ['blog', 'github', 'leetcode', 'all'] as const
type Source = typeof VALID_SOURCES[number]

export async function GET(request: Request) {
  const url    = new URL(request.url)
  const secret = url.searchParams.get('secret')
  const source = (url.searchParams.get('source') ?? 'all') as Source

  // 校验密钥（SYNC_SECRET 未设置时允许本地访问）
  if (SYNC_SECRET && secret !== SYNC_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!VALID_SOURCES.includes(source)) {
    return Response.json(
      { error: `Invalid source. Valid values: ${VALID_SOURCES.join(', ')}` },
      { status: 400 }
    )
  }

  const revalidated: string[] = []

  if (source === 'all' || source === 'blog') {
    // 先重建 WC 文件缓存（含重试 wordCount=0 的条目），再失效 Next.js 缓存
    try {
      const blog = createBlogAdapter(config.blog, config.cultivation)
      await blog.getPosts()
    } catch {
      // 失败不中断，至少失效缓存让下次请求重试
    }
    revalidateTag('blog', 'max')
    revalidated.push('blog')
  }
  if (source === 'all' || source === 'github') {
    revalidateTag('github', 'max')
    revalidated.push('github')
  }
  if (source === 'all' || source === 'leetcode') {
    // 先预热：直接调用 adapter 拉取最新数据，再失效缓存让页面下次渲染时直接命中
    if (config.leetcode.enabled) {
      try {
        const lc = createLeetcodeAdapter(config.leetcode, config.cultivation)
        await Promise.all([lc.getStats(), lc.getProblems()])
      } catch {
        // 失败不中断
      }
    }
    revalidateTag('leetcode', 'max')
    revalidated.push('leetcode')
  }

  console.log(`[Sync] revalidated tags: ${revalidated.join(', ')}`)

  return Response.json({
    ok: true,
    revalidated,
    timestamp: new Date().toISOString(),
  })
}
