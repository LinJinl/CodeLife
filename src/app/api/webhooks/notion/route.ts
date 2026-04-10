/**
 * Notion Webhook 端点（Beta）
 *
 * Notion Webhook 目前处于 Beta 阶段，需要申请才能使用。
 * 申请地址：https://www.notion.so/product/changelog/webhooks-beta
 *
 * 设置步骤（获得 Beta 资格后）：
 *   1. Notion Integrations 页面 → 你的 Integration → Webhooks
 *   2. Add Webhook → URL: https://yourdomain.dev/api/webhooks/notion
 *   3. 选择事件：page.created, page.updated, page.deleted
 *   4. 把 Notion 返回的 Verification Token → .env.local: NOTION_WEBHOOK_TOKEN=xxx
 *
 * 未获得 Beta 资格时的替代方案：
 *   - 在 codelife.config.ts 中保持较短的 revalidate（如 1800 = 30 分钟）
 *   - 或在 Notion 编辑完文章后，手动访问 /api/sync?source=blog&secret=xxx 触发刷新
 *
 * 参考文档：https://developers.notion.com/docs/webhooks
 */

import { revalidateTag } from 'next/cache'

const NOTION_WEBHOOK_TOKEN = process.env.NOTION_WEBHOOK_TOKEN ?? ''

export async function POST(request: Request) {
  // Notion webhook 验证：请求体包含 { verification_token: string }
  const body = await request.json() as Record<string, unknown>

  // Notion 的验证握手请求
  if (body.type === 'verification') {
    return Response.json({ challenge: body.challenge })
  }

  // 验证 token
  if (NOTION_WEBHOOK_TOKEN) {
    const token = request.headers.get('x-notion-secret') ?? body.verification_token
    if (token !== NOTION_WEBHOOK_TOKEN) {
      return Response.json({ error: 'Invalid token' }, { status: 401 })
    }
  }

  // 处理页面变更事件
  const eventType = body.type as string
  if (eventType?.startsWith('page.')) {
    revalidateTag('blog', 'max')
    console.log(`[Webhook/Notion] event=${eventType} → revalidated tag:blog`)
    return Response.json({ ok: true, revalidated: 'blog' })
  }

  return Response.json({ ok: true, message: 'event ignored' })
}
