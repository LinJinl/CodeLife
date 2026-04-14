/**
 * shell 执行权限共享状态（进程级单例）
 *
 * shell.ts 工具生成令牌 → /api/spirit/approve 消费令牌
 * 两处共享同一个模块实例，确保令牌合法性由服务端掌控
 */

import { randomUUID } from 'crypto'

export type ApprovalLevel = 'moderate' | 'destructive' | 'write'

export interface PendingApproval {
  command:   string   // 待执行命令 / 写操作人类可读摘要
  workdir:   string   // shell: 工作目录；write: 工具名称（用于重调时验证）
  level:     ApprovalLevel
  expiresAt: number   // Date.now() + TOKEN_TTL_MS
}

const TOKEN_TTL_MS = 5 * 60 * 1000   // 5 分钟有效期

// 等待用户确认的令牌
const pendingApprovals = new Map<string, PendingApproval>()
// 已被用户批准、等待 AI 使用的令牌
const approvedTokens   = new Map<string, PendingApproval>()

// 会话级权限：仅对 moderate 命令有效（不对 destructive 开放批量免确认）
let sessionAllowModerate = false

/** 生成写操作一次性令牌（绑定 toolName，不绑定具体内容） */
export function createWriteToken(toolName: string, summary: string): string {
  const token = randomUUID()
  pendingApprovals.set(token, {
    command:   summary,
    workdir:   toolName,   // write 令牌复用 workdir 字段存 toolName，消费时校验
    level:     'write',
    expiresAt: Date.now() + TOKEN_TTL_MS,
  })
  setTimeout(() => {
    pendingApprovals.delete(token)
    approvedTokens.delete(token)
  }, TOKEN_TTL_MS + 1000)
  return token
}

/** 生成一次性令牌并存入待批准队列 */
export function createApprovalToken(approval: Omit<PendingApproval, 'expiresAt'>): string {
  const token = randomUUID()
  pendingApprovals.set(token, { ...approval, expiresAt: Date.now() + TOKEN_TTL_MS })
  // 定期清理过期令牌（不需要精确，延迟清理即可）
  setTimeout(() => {
    pendingApprovals.delete(token)
    approvedTokens.delete(token)
  }, TOKEN_TTL_MS + 1000)
  return token
}

/** 用户批准令牌（由 /api/spirit/approve 调用） */
export function approveToken(token: string, decision: 'once' | 'session'): boolean {
  const pending = pendingApprovals.get(token)
  if (!pending || Date.now() > pending.expiresAt) return false

  pendingApprovals.delete(token)
  approvedTokens.set(token, pending)

  if (decision === 'session' && pending.level === 'moderate') {
    sessionAllowModerate = true
  }
  return true
}

/**
 * 工具侧：消费令牌并验证一致性（一次性销毁）。
 * - shell 调用：传 { command } — 验证命令字符串匹配
 * - write 调用：传 { toolName } — 验证工具名匹配（存在 workdir 字段中）
 */
export function consumeToken(
  token: string,
  opts: { command: string; toolName?: never } | { toolName: string; command?: never },
): boolean {
  const approval = approvedTokens.get(token)
  if (!approval) return false
  if (Date.now() > approval.expiresAt) { approvedTokens.delete(token); return false }

  if (opts.toolName !== undefined) {
    // write 令牌：校验 toolName（存在 workdir 字段中）
    if (approval.level !== 'write') return false
    if (approval.workdir !== opts.toolName) return false
  } else {
    // shell 令牌：校验命令字符串
    if (approval.command !== opts.command) return false
  }

  approvedTokens.delete(token)
  return true
}

/** 检查会话级中等权限是否已开放 */
export function isSessionModerateAllowed(): boolean {
  return sessionAllowModerate
}
