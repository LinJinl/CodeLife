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

export const DEFAULT_CONTEXT_BUDGET: ContextBudget = {
  todaySummaryChars: 800,
  recentHistoryChars: 1000,
  minRecentMessages: 4,
  maxRecentMessages: 8,
  maxSingleMessageChars: 500,
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

function containsCurrentConversation(
  currentMessages: { role: string; content: string }[],
  saved: ConversationMessage[],
): boolean {
  const lastSavedSnippet = normalizeContent(saved.at(-1)?.content ?? '').slice(0, 50)
  if (!lastSavedSnippet) return false

  return currentMessages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .some(m => normalizeContent(m.content).includes(lastSavedSnippet))
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

  if (containsCurrentConversation(currentMessages, usable)) {
    diagnostics.deduped = true
    return { messages: [], diagnostics }
  }

  const recent: { index: number; message: ConversationMessage }[] = []
  let chars = 0

  for (let i = usable.length - 1; i >= 0 && recent.length < budget.maxRecentMessages; i--) {
    const original = usable[i]
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
  const earlier = earliestRecentIndex > 0 ? usable.slice(0, earliestRecentIndex) : []
  const summary = buildEarlierSummary(earlier, budget.todaySummaryChars)

  diagnostics.summarized = summary ? earlier.length : 0
  diagnostics.selected = recent.length
  diagnostics.chars = chars + (summary?.length ?? 0)

  return { summary, messages: recent.map(item => item.message), diagnostics }
}
