/**
 * GitHub Webhook 端点
 *
 * 设置步骤：
 *   1. 你的 GitHub 仓库 → Settings → Webhooks → Add webhook
 *   2. Payload URL: https://yourdomain.dev/api/webhooks/github
 *   3. Content type: application/json
 *   4. Secret: 随机字符串，写入 .env.local → GITHUB_WEBHOOK_SECRET=xxx
 *   5. Events: 勾选 "Pushes"（如需 Star/Fork 统计，也可勾选对应事件）
 *   6. Active: ✓
 *
 * 触发后：自动刷新 /github 和 / 页面的 GitHub 缓存数据
 */

import { revalidateTag } from 'next/cache'
import { createHmac, timingSafeEqual } from 'crypto'

const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET ?? ''

function verifySignature(payload: string, signature: string | null): boolean {
  if (!WEBHOOK_SECRET || !signature) return false
  const expected = 'sha256=' + createHmac('sha256', WEBHOOK_SECRET).update(payload).digest('hex')
  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  } catch {
    return false
  }
}

export async function POST(request: Request) {
  const body      = await request.text()
  const signature = request.headers.get('x-hub-signature-256')
  const event     = request.headers.get('x-github-event')

  // 验签
  if (WEBHOOK_SECRET && !verifySignature(body, signature)) {
    return Response.json({ error: 'Invalid signature' }, { status: 401 })
  }

  // 仅处理 push 和 star 事件
  if (event === 'push' || event === 'create' || event === 'delete' ||
      event === 'watch' || event === 'fork') {
    revalidateTag('github', 'max')
    console.log(`[Webhook/GitHub] event=${event} → revalidated tag:github`)
    return Response.json({ ok: true, revalidated: 'github' })
  }

  // ping 事件：GitHub 在创建 webhook 时发送，直接返回 200
  if (event === 'ping') {
    return Response.json({ ok: true, message: 'pong' })
  }

  return Response.json({ ok: true, message: 'event ignored' })
}
