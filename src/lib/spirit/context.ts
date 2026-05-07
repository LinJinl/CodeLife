import type { ConversationMessage } from './memory'
import { getConversation } from './memory'
import { dateInTZ } from './time'

export interface ContextBudget {
  todaySummaryChars: number
  recentHistoryChars: number
  minRecentMessages: number
  maxRecentMessages: number
  maxSingleMessageChars: number
}

export interface PackedTodayHistoryDiagnostics {
  date: string
  totalSaved: number
  selected: number
  chars: number
  skipped: number
  deduped: boolean
  summarized: number
  truncated: number
}

export interface PackedTodayHistory {
  summary?: string
  messages: ConversationMessage[]
  diagnostics: PackedTodayHistoryDiagnostics
}

export interface PackedCurrentConversation {
  summary?: string
  messages: { role: 'user' | 'assistant' | 'system'; content: string }[]
  diagnostics: {
    total: number
    selected: number
    summarized: number
    chars: number
    truncated: number
  }
}

export const DEFAULT_CONTEXT_BUDGET: ContextBudget = {
  todaySummaryChars: 800,
  recentHistoryChars: 1000,
  minRecentMessages: 4,
  maxRecentMessages: 8,
  maxSingleMessageChars: 500,
}

const CURRENT_CONVERSATION_BUDGET = {
  summaryChars: 900,
  recentChars: 2400,
  minRecentMessages: 6,
  maxRecentMessages: 12,
  maxSingleMessageChars: 900,
}

function normalizeContent(content: string): string {
  return content.replace(/\s+/g, ' ').trim()
}

function truncateContent(content: string, maxChars: number): { content: string; truncated: boolean } {
  const normalized = normalizeContent(content)
  if (normalized.length <= maxChars) return { content: normalized, truncated: false }
  return {
    content: `${normalized.slice(0, Math.max(0, maxChars - 12)).trimEnd()}...[已截断]`,
    truncated: true,
  }
}

function isUsableMessage(message: ConversationMessage): boolean {
  return normalizeContent(message.content).length > 0
}

function compressMessageToLine(message: ConversationMessage): string {
  const role = message.role === 'user' ? '用户' : '助手'
  const content = normalizeContent(message.content)
  const maxChars = message.role === 'user' ? 120 : 180
  const compact = content.length <= maxChars
    ? content
    : `${content.slice(0, Math.floor(maxChars * 0.55)).trimEnd()} ... ${content.slice(-Math.floor(maxChars * 0.35)).trimStart()}`
  const time = message.timestamp ? `${message.timestamp.slice(11, 16)} ` : ''
  return `- ${time}${role}：${compact}`
}

function buildEarlierSummary(messages: ConversationMessage[], maxChars: number): string | undefined {
  if (messages.length === 0) return undefined

  const header = `【今日较早对话摘要】共 ${messages.length} 条旧消息，以下为压缩摘录，用于保持连续性；具体事实不确定时应再查历史对话。`
  const lines: string[] = []
  let chars = header.length

  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    const line = compressMessageToLine(message)
    if (chars + line.length + 1 > maxChars) break
    lines.unshift(line)
    chars += line.length + 1
  }

  if (lines.length === 0) return undefined
  return `${header}\n${lines.join('\n')}`
}

function compressCurrentMessageToLine(message: { role: string; content: string }): string {
  const role = message.role === 'assistant' ? '助手' : message.role === 'system' ? '系统' : '用户'
  const content = normalizeContent(message.content)
  const maxChars = message.role === 'user' ? 120 : message.role === 'assistant' ? 180 : 160
  const compact = content.length <= maxChars
    ? content
    : `${content.slice(0, Math.floor(maxChars * 0.55)).trimEnd()} ... ${content.slice(-Math.floor(maxChars * 0.35)).trimStart()}`
  return `- ${role}：${compact}`
}

function buildCurrentConversationSummary(
  messages: { role: 'user' | 'assistant' | 'system'; content: string }[],
  maxChars: number,
): string | undefined {
  if (messages.length === 0) return undefined
  const header = `【本轮较早对话摘要】共 ${messages.length} 条较早消息，以下为压缩摘录；若需要精确原文，应调用历史对话检索工具。`
  const lines: string[] = []
  let chars = header.length

  for (let i = messages.length - 1; i >= 0; i--) {
    const line = compressCurrentMessageToLine(messages[i])
    if (chars + line.length + 1 > maxChars) break
    lines.unshift(line)
    chars += line.length + 1
  }

  if (lines.length === 0) return undefined
  return `${header}\n${lines.join('\n')}`
}

function isAlreadyInCurrentConversation(
  currentMessages: { role: string; content: string }[],
  saved: ConversationMessage,
): boolean {
  const snippet = normalizeContent(saved.content).slice(0, 50)
  if (!snippet) return false

  return currentMessages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .some(m => normalizeContent(m.content).includes(snippet))
}

export function packTodayHistory(
  currentMessages: { role: string; content: string }[],
  budget: ContextBudget = DEFAULT_CONTEXT_BUDGET,
): PackedTodayHistory {
  const date = dateInTZ()
  const conv = getConversation(date)
  const totalSaved = conv.messages.length
  const diagnostics: PackedTodayHistoryDiagnostics = {
    date,
    totalSaved,
    selected: 0,
    chars: 0,
    skipped: 0,
    deduped: false,
    summarized: 0,
    truncated: 0,
  }

  const usable = conv.messages.filter(isUsableMessage)
  diagnostics.skipped = totalSaved - usable.length

  if (usable.length === 0) return { messages: [], diagnostics }

  const savedOnly = usable.filter(message => {
    const deduped = isAlreadyInCurrentConversation(currentMessages, message)
    if (deduped) diagnostics.deduped = true
    return !deduped
  })

  if (savedOnly.length === 0) return { messages: [], diagnostics }

  const recent: { index: number; message: ConversationMessage }[] = []
  let chars = 0

  for (let i = savedOnly.length - 1; i >= 0 && recent.length < budget.maxRecentMessages; i--) {
    const original = savedOnly[i]
    const packed = truncateContent(original.content, budget.maxSingleMessageChars)
    const message: ConversationMessage = {
      ...original,
      content: packed.content,
    }
    const isRequiredRecent = recent.length < budget.minRecentMessages
    const cost = message.content.length

    if (!isRequiredRecent && chars + cost > budget.recentHistoryChars) {
      continue
    }

    recent.push({ index: i, message })
    chars += cost
    if (packed.truncated) diagnostics.truncated++
  }

  recent.reverse()
  const earliestRecentIndex = recent[0]?.index ?? -1
  const earlier = earliestRecentIndex > 0 ? savedOnly.slice(0, earliestRecentIndex) : []
  const summary = buildEarlierSummary(earlier, budget.todaySummaryChars)

  diagnostics.summarized = summary ? earlier.length : 0
  diagnostics.selected = recent.length
  diagnostics.chars = chars + (summary?.length ?? 0)

  return { summary, messages: recent.map(item => item.message), diagnostics }
}

export function packCurrentConversation(
  messages: { role: 'user' | 'assistant' | 'system'; content: string }[],
  budget = CURRENT_CONVERSATION_BUDGET,
): PackedCurrentConversation {
  const usable = messages
    .filter(message => message.role === 'user' || message.role === 'assistant' || message.role === 'system')
    .filter(message => normalizeContent(message.content).length > 0)
  const diagnostics = {
    total: usable.length,
    selected: 0,
    summarized: 0,
    chars: 0,
    truncated: 0,
  }

  if (usable.length === 0) return { messages: [], diagnostics }

  const currentUserIndex = usable.map(message => message.role).lastIndexOf('user')
  const currentUser = currentUserIndex >= 0 ? usable[currentUserIndex] : usable[usable.length - 1]
  const beforeCurrent = currentUserIndex >= 0 ? usable.slice(0, currentUserIndex) : usable.slice(0, -1)

  const recent: { index: number; message: { role: 'user' | 'assistant' | 'system'; content: string } }[] = []
  let chars = normalizeContent(currentUser.content).length

  for (let i = beforeCurrent.length - 1; i >= 0 && recent.length < budget.maxRecentMessages; i--) {
    const original = beforeCurrent[i]
    const packed = truncateContent(original.content, budget.maxSingleMessageChars)
    const message = { ...original, content: packed.content }
    const isRequiredRecent = recent.length < budget.minRecentMessages
    const cost = message.content.length

    if (!isRequiredRecent && chars + cost > budget.recentChars) continue
    recent.push({ index: i, message })
    chars += cost
    if (packed.truncated) diagnostics.truncated++
  }

  recent.reverse()
  const earliestRecentIndex = recent[0]?.index ?? beforeCurrent.length
  const earlier = beforeCurrent.slice(0, earliestRecentIndex)
  const summary = buildCurrentConversationSummary(earlier, budget.summaryChars)

  const packedMessages = [
    ...(summary ? [{ role: 'system' as const, content: summary }] : []),
    ...recent.map(item => item.message),
    currentUser,
  ]

  diagnostics.selected = recent.length + 1
  diagnostics.summarized = summary ? earlier.length : 0
  diagnostics.chars = packedMessages.reduce((sum, message) => sum + message.content.length, 0)

  return { summary, messages: packedMessages, diagnostics }
}
