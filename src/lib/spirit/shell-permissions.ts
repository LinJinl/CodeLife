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
    workdir:   toolName,
    level:     'write',
    expiresAt: Date.now() + TOKEN_TTL_MS,
  })
  setTimeout(() => {
    pendingApprovals.delete(token)
    approvedTokens.delete(token)
  }, TOKEN_TTL_MS + 1000)
  return token
}

/**
 * 消费写操作令牌（重调时验证工具名匹配）。
 * 返回 true 表示可以执行，同时销毁令牌（一次性）。
 */
export function consumeWriteToken(token: string, toolName: string): boolean {
  const approval = approvedTokens.get(token)
  if (!approval) return false
  if (Date.now() > approval.expiresAt) { approvedTokens.delete(token); return false }
  if (approval.level !== 'write') return false
  if (approval.workdir !== toolName) return false   // 工具名不一致，拒绝
  approvedTokens.delete(token)
  return true
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
 * 工具侧：消费令牌并验证命令一致性。
 * 返回 true 表示可以执行，同时销毁令牌（一次性）。
 */
export function consumeToken(token: string, command: string): boolean {
  const approval = approvedTokens.get(token)
  if (!approval) return false
  if (Date.now() > approval.expiresAt) { approvedTokens.delete(token); return false }
  if (approval.command !== command) return false   // 命令不一致，拒绝
  approvedTokens.delete(token)
  return true
}

/** 检查会话级中等权限是否已开放 */
export function isSessionModerateAllowed(): boolean {
  return sessionAllowModerate
}
