/**
 * POST /api/spirit/approve
 * 用户在 UI 点击权限确认按钮时调用
 *
 * body: { token: string, decision: 'once' | 'session' | 'deny' }
 *
 * 安全设计：
 *   - 令牌由 shell-permissions.ts 生成（服务端，不可伪造）
 *   - 批准后令牌进入 approvedTokens，由 run_shell 工具消费（一次性）
 *   - 拒绝时仅删除 pending 令牌，不写入 approved
 */

import { NextRequest } from 'next/server'
import { approveToken } from '@/lib/spirit/shell-permissions'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const body = await req.json() as { token?: string; decision?: string }
  const { token, decision } = body

  if (!token || typeof token !== 'string') {
    return Response.json({ error: '缺少 token' }, { status: 400 })
  }

  if (decision === 'deny') {
    // 拒绝：不需要操作 approvedTokens，令牌自然过期即可
    return Response.json({ ok: true, executed: false })
  }

  if (decision !== 'once' && decision !== 'session') {
    return Response.json({ error: '无效的 decision' }, { status: 400 })
  }

  const approved = approveToken(token, decision)
  if (!approved) {
    return Response.json({ error: '令牌无效或已过期' }, { status: 410 })
  }

  return Response.json({ ok: true })
}
