import fs from 'fs'
import path from 'path'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import type { ChatOpenAI } from '@langchain/openai'
import { z } from 'zod'
import {
  getActiveVows,
  getRecentConversations,
  getRecentDailyLogs,
  getRecentSummaries,
  getSkills,
  getWeeklyPatterns,
  type ConversationMessage,
  type Vow,
} from './memory'
import { clampSummary, formatMemoryPack, type MemoryPackItem } from './memory-pack'
import { formatSkillForMemory } from './skill-format'

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

const MEMORY_INTENT_SCHEMA = z.object({
  intents: z.array(z.enum([
    'recent_status',
    'weekly_pattern',
    'vow_progress',
    'skill_lookup',
    'conversation_lookup',
    'note_lookup',
    'none',
  ])).describe('用户问题需要的记忆类型；如果完全不需要历史记忆，只返回 none'),
})

const MEMORY_INTENT_SYSTEM = `你是个人助手的记忆路由器。判断用户问题需要哪些历史记忆。

可选记忆类型：
- recent_status：用户问最近在做什么、近况、最近忙什么、近期活动/产出/状态
- weekly_pattern：用户问规律、趋势、状态怎么样、复盘、隐患、周期性问题
- vow_progress：用户问目标、誓约、计划、进度、截止时间、打卡情况
- skill_lookup：用户问之前总结过的经验、方法论、技能卡、学过什么、洞察
- conversation_lookup：用户问之前聊过什么、上次说过什么、某次对话内容
- note_lookup：用户问随手记、笔记、记录过什么
- none：不需要历史记忆即可回答

规则：
- 可以多选，但只选真正需要的。
- "我最近在干什么 / 最近忙什么 / 这段时间做了什么" 属于 recent_status，通常也需要 weekly_pattern。
- 不要因为问题里有"你觉得"就选 none；只要判断依赖用户历史，就选对应记忆类型。
- 只输出 JSON，不输出解释。`

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
  const asksRecentActivity = /(近况|最近状态|这几天|这段时间|最近.*(做|干|忙|搞|状态)|最近.*(干什么|干嘛|忙什么|做什么|做了什么|搞什么)|在干什么|在干嘛|忙什么|做了什么|干了什么)/.test(text)

  if (asksRecentActivity || /今天.*(做|干|忙|状态)|晨省|修炼情况/.test(text)) {
    intents.push('recent_status')
    requiredTools.push('get_daily_logs', 'get_weekly_patterns', 'search_conversations')
  }
  if (asksRecentActivity || /上周|这个月|规律|趋势|状态怎么样|周期|隐患|复盘/.test(text)) {
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

export async function inferMemoryIntentWithAI(
  text: string,
  model: ChatOpenAI,
): Promise<MemoryIntentResult> {
  const rule = inferMemoryIntent(text)
  if (rule.strength !== 'none') return rule

  try {
    const classifierModel = (model as unknown as { bind(args: Record<string, unknown>): unknown })
      .bind({ stream: false }) as ChatOpenAI
    const classifier = classifierModel.withStructuredOutput(MEMORY_INTENT_SCHEMA)
    const invoke = classifier.invoke([
      new SystemMessage(MEMORY_INTENT_SYSTEM),
      new HumanMessage(text.slice(0, 500)),
    ])
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('memory-intent timeout')), 3500)
    )
    const result = await Promise.race([invoke, timeout])
    const intents = unique((result.intents ?? []).filter(intent => intent !== 'none')) as MemoryIntent[]
    if (intents.length === 0) return rule

    return {
      intents,
      strength: 'strong',
      queries: inferQueries(text),
      requiredTools: toolsForIntents(intents),
    }
  } catch (err) {
    console.warn('[spirit] memory intent classifier failed, fallback to rules:', err instanceof Error ? err.message : err)
    return rule
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

function sessionSummaryItems(limit = 10): MemoryPackItem[] {
  return getRecentSummaries(limit).map(summary => ({
    type: 'session_summary',
    id: `session_summary:${summary.date}`,
    date: summary.date,
    title: summary.topics.length ? summary.topics.join('、') : '当日对话摘要',
    summary: summary.summary,
    source: `content/spirit/summaries/${summary.date}.json`,
    confidence: 0.72,
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
    summary: formatSkillForMemory(skill, 520),
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

function toolsForIntents(intents: MemoryIntent[]): string[] {
  const requiredTools: string[] = []
  if (intents.includes('recent_status')) requiredTools.push('get_daily_logs', 'get_weekly_patterns', 'search_conversations')
  if (intents.includes('weekly_pattern')) requiredTools.push('get_weekly_patterns')
  if (intents.includes('vow_progress')) requiredTools.push('vow_summary')
  if (intents.includes('skill_lookup')) requiredTools.push('search_skills')
  if (intents.includes('conversation_lookup')) requiredTools.push('search_conversations')
  if (intents.includes('note_lookup')) requiredTools.push('search_notes')
  return unique(requiredTools)
}

function buildPrefetchedMemoryPack(intent: MemoryIntentResult): PrefetchedMemoryPack {
  if (intent.strength === 'none') return { intent, items: [] }

  const items: MemoryPackItem[] = []
  if (intent.intents.includes('recent_status')) {
    items.push(...dailyLogItems(14))
    items.push(...sessionSummaryItems(14))
  }
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

export function prefetchMemoryPack(text: string): PrefetchedMemoryPack {
  return buildPrefetchedMemoryPack(inferMemoryIntent(text))
}

export async function prefetchMemoryPackWithAI(
  text: string,
  model: ChatOpenAI,
): Promise<PrefetchedMemoryPack> {
  return buildPrefetchedMemoryPack(await inferMemoryIntentWithAI(text, model))
}
