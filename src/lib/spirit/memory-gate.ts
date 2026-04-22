import fs from 'fs'
import path from 'path'
import {
  getActiveVows,
  getRecentConversations,
  getRecentDailyLogs,
  getSkills,
  getWeeklyPatterns,
  type ConversationMessage,
  type Vow,
} from './memory'
import { clampSummary, formatMemoryPack, type MemoryPackItem } from './memory-pack'

export type MemoryIntent =
  | 'recent_status'
  | 'weekly_pattern'
  | 'vow_progress'
  | 'skill_lookup'
  | 'conversation_lookup'
  | 'note_lookup'
  | 'none'

export interface MemoryIntentResult {
  intents: MemoryIntent[]
  strength: 'strong' | 'weak' | 'none'
  queries: string[]
  requiredTools: string[]
}

export interface PrefetchedMemoryPack {
  intent: MemoryIntentResult
  items: MemoryPackItem[]
  content?: string
}

const NOTES_DIR = path.resolve(process.cwd(), 'content/spirit/notes')

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items))
}

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function inferQueries(text: string): string[] {
  const normalized = normalize(text)
  const quoted = Array.from(normalized.matchAll(/[「“"]([^」”"]{2,80})[」”"]/g)).map(m => m[1])
  return unique([...(quoted.length ? quoted : [normalized.slice(0, 80)])].filter(Boolean))
}

function extractDate(text: string): string | undefined {
  const match = text.match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})/)
  if (!match) return undefined
  const [, y, m, d] = match
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
}

export function inferMemoryIntent(text: string): MemoryIntentResult {
  const intents: MemoryIntent[] = []
  const requiredTools: string[] = []

  if (/近况|最近状态|这几天|今天.*(做|状态)|晨省|修炼情况|最近.*做/.test(text)) {
    intents.push('recent_status')
    requiredTools.push('get_daily_logs')
  }
  if (/上周|这个月|规律|趋势|状态怎么样|周期|隐患|复盘/.test(text)) {
    intents.push('weekly_pattern')
    requiredTools.push('get_weekly_patterns')
  }
  if (/誓约|目标|进度|打卡|还差多少|deadline|截止/.test(text)) {
    intents.push('vow_progress')
    requiredTools.push('vow_summary')
  }
  if (/之前总结|有没有.*洞察|技能卡|学过|经验|方法论|上次解决/.test(text)) {
    intents.push('skill_lookup')
    requiredTools.push('search_skills')
  }
  if (/上次|之前.*聊|哪天.*聊|历史对话|我们.*说过|提到过/.test(text)) {
    intents.push('conversation_lookup')
    requiredTools.push('search_conversations')
  }
  if (/随手记|笔记|记了什么|帮我记|note/.test(text)) {
    intents.push('note_lookup')
    requiredTools.push('search_notes')
  }

  const uniqueIntents = unique(intents)
  return {
    intents: uniqueIntents.length ? uniqueIntents : ['none'],
    strength: uniqueIntents.length ? 'strong' : 'none',
    queries: inferQueries(text),
    requiredTools: unique(requiredTools),
  }
}

function dailyLogItems(limit = 7): MemoryPackItem[] {
  return getRecentDailyLogs(limit).map(log => {
    const parts = log.activities.map(a => {
      const label = { blog: '著述', leetcode: '铸剑', github: '声望' }[a.type] ?? a.type
      const detail = a.titles?.length ? `（${a.titles.join('、')}）` : ''
      return `${label}×${a.count}${detail} +${a.points}修为`
    })
    return {
      type: 'daily_log',
      id: `daily_log:${log.date}`,
      date: log.date,
      summary: parts.length ? `${parts.join('；')}；连续第 ${log.streakDay} 日；总 +${log.totalPoints}` : `无修炼；连续第 ${log.streakDay} 日；总 +${log.totalPoints}`,
      confidence: 1,
    }
  })
}

function weeklyPatternItems(limit = 4): MemoryPackItem[] {
  return getWeeklyPatterns(limit).map(pattern => ({
    type: 'weekly_pattern',
    id: `weekly_pattern:${pattern.weekStart}`,
    date: pattern.weekStart,
    title: `${pattern.weekStart} 周规律`,
    summary: `${pattern.narrative}${pattern.flags.length ? ` 隐患：${pattern.flags.join('、')}` : ''}`,
    confidence: 0.8,
  }))
}

function summarizeVow(vow: Vow): string {
  const daysLeft = Math.ceil((new Date(vow.deadline).getTime() - Date.now()) / 86400000)
  const goals = vow.subGoals.map(goal => {
    const done = goal.done ? '已完成' : '未完成'
    const count = typeof goal.currentCount === 'number' && goal.target
      ? ` ${goal.currentCount}/${goal.target}`
      : ''
    return `${goal.description}：${done}${count}`
  }).join('；')
  const grace = (vow.graceCount ?? 0) > 0 ? `；宽限 ${vow.graceUsed ?? 0}/${vow.graceCount}` : ''
  return `截止 ${vow.deadline}，剩 ${daysLeft} 天${grace}。${goals}`
}

function vowItems(): MemoryPackItem[] {
  return getActiveVows().map(vow => ({
    type: 'vow',
    id: vow.id,
    date: vow.deadline,
    title: vow.title,
    summary: summarizeVow(vow),
    source: 'content/spirit/vows.json',
    confidence: 1,
  }))
}

function matchText(text: string, queries: string[]): boolean {
  const lower = text.toLowerCase()
  return queries.some(q => {
    const query = q.toLowerCase()
    if (query.length < 2) return false
    return lower.includes(query) || query.split(/[^\p{L}\p{N}]+/u).filter(t => t.length >= 2).some(t => lower.includes(t))
  })
}

function skillItems(queries: string[], limit = 6): MemoryPackItem[] {
  const skills = [...getSkills()].reverse()
  const matched = skills.filter(skill =>
    matchText(`${skill.title} ${skill.insight} ${skill.tags.join(' ')}`, queries)
  )
  const selected = (matched.length ? matched : skills).slice(0, limit)
  return selected.map(skill => ({
    type: 'skill',
    id: skill.id,
    date: skill.sourceDate,
    title: skill.title,
    summary: `${skill.insight}${skill.tags.length ? ` 标签：${skill.tags.join('、')}` : ''}`,
    source: skill.sourceDate,
    confidence: matched.includes(skill) ? 0.75 : 0.45,
  }))
}

function noteItems(queries: string[], limit = 6): MemoryPackItem[] {
  if (!fs.existsSync(NOTES_DIR)) return []
  const files = fs.readdirSync(NOTES_DIR)
    .filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
    .sort()
    .reverse()
  const entries: { date: string; text: string }[] = []
  for (const file of files) {
    const date = file.replace('.md', '')
    const text = fs.readFileSync(path.join(NOTES_DIR, file), 'utf-8')
    for (const block of text.split(/\n(?=## )/).filter(Boolean)) {
      entries.push({ date, text: block.trim() })
    }
  }
  return entries
    .filter(entry => matchText(entry.text, queries))
    .slice(0, limit)
    .map((entry, idx) => ({
      type: 'note',
      id: `note:${entry.date}:${idx}`,
      date: entry.date,
      summary: clampSummary(entry.text, 420),
      source: `content/spirit/notes/${entry.date}.md`,
      confidence: 0.8,
    }))
}

function messageSummary(message: ConversationMessage): string {
  const role = message.role === 'user' ? '修士' : '器灵'
  return `${message.timestamp ? `${message.timestamp} ` : ''}${role}：${message.content}`
}

function conversationItems(queries: string[], limit = 6): MemoryPackItem[] {
  const date = extractDate(queries.join(' '))
  const conversations = getRecentConversations(30)
  const messages = conversations.flatMap(conv =>
    conv.messages.map((message, index) => ({ date: conv.date, index, message }))
  )
  const scoped = date ? messages.filter(item => item.date === date) : messages
  const matched = scoped.filter(item => matchText(item.message.content, queries))
  return matched.slice(0, limit).map(item => ({
    type: 'conversation',
    id: `conversation:${item.date}:${item.index}`,
    date: item.date,
    title: item.message.role === 'user' ? '用户消息' : '助手消息',
    summary: messageSummary(item.message),
    source: `content/spirit/conversations/${item.date}.json`,
    confidence: 0.65,
  }))
}

export function prefetchMemoryPack(text: string): PrefetchedMemoryPack {
  const intent = inferMemoryIntent(text)
  if (intent.strength === 'none') return { intent, items: [] }

  const items: MemoryPackItem[] = []
  if (intent.intents.includes('recent_status')) items.push(...dailyLogItems(7))
  if (intent.intents.includes('weekly_pattern')) items.push(...weeklyPatternItems(4))
  if (intent.intents.includes('vow_progress')) items.push(...vowItems())
  if (intent.intents.includes('skill_lookup')) items.push(...skillItems(intent.queries))
  if (intent.intents.includes('note_lookup')) items.push(...noteItems(intent.queries))
  if (intent.intents.includes('conversation_lookup')) items.push(...conversationItems(intent.queries))

  return {
    intent,
    items,
    content: items.length ? formatMemoryPack(items.slice(0, 24), '服务端预取记忆') : undefined,
  }
}
