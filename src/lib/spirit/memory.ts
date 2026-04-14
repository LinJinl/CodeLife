/**
 * Spirit Memory Store
 * 三层记忆的读写，全部存在 content/spirit/ 下的 JSON 文件
 */

import fs   from 'fs'
import path from 'path'

// ── 类型定义 ──────────────────────────────────────────────────

export interface DailyActivity {
  type: 'blog' | 'leetcode' | 'github'
  count: number
  points: number
  titles?: string[]
}

export interface DailyLog {
  date: string                   // "2026-04-07"
  activities: DailyActivity[]
  totalPoints: number
  streakDay: number
  note?: string
}

export interface WeeklyPattern {
  weekStart: string              // "2026-03-31"
  narrative: string              // AI 生成的叙事段落
  stats: {
    activeDays: number
    dominantType: string
    totalPoints: number
    peakDay: string
  }
  flags: string[]                // ["连续断更3天", "只刷easy题"]
}

export interface PersonaProfile {
  observedTraits: string[]
  recurringIssues: string[]
  milestones: { date: string; event: string }[]
  currentPhase: string
  lastUpdated: string
}

/**
 * metric 约定：
 *   blog_daily     — 当日 DailyLog 中有 blog 活动
 *   leetcode_daily — 当日 DailyLog 中有 leetcode 活动
 *   github_daily   — 当日 DailyLog 中有 github 活动
 *   any_daily      — 当日有任何活动
 *   manual         — 只能手动标记
 *   count_total    — 累计完成次数达到 target（activityType 指定类型）
 *   count_weekly   — 每周完成次数达到 target（activityType 指定类型）
 *   streak_N       — 连续 target 天不间断（activityType 指定类型）
 *   reach_points   — 修为累计达到 target
 */
export type VowMetric =
  | 'blog_daily'
  | 'leetcode_daily'
  | 'github_daily'
  | 'any_daily'
  | 'manual'
  | 'count_total'
  | 'count_weekly'
  | 'streak_N'
  | 'reach_points'

export interface VowSubGoal {
  description:      string
  metric:           VowMetric
  target?:          number                   // 目标值（count_total/streak_N/reach_points 用）
  currentCount?:    number                   // 累计计数（count_total/count_weekly 用）
  weeklyLog?:       Record<string, number>   // weekStart → 当周计数（count_weekly 用）
  activityType?:    'blog' | 'leetcode' | 'github' | 'any'  // count_* / streak_N 用
  lastCountedDate?: string                   // 防重复计数（YYYY-MM-DD）
  done:             boolean                  // 一次性目标是否完成
  completedDates:   string[]                 // daily / streak_N 已完成日期
}

export interface Vow {
  id:          string
  createdAt:   string
  deadline:    string
  raw:         string
  normalized:  string
  title:       string            // 简短标题，显示在侧边栏
  subGoals:    VowSubGoal[]
  status:      'active' | 'fulfilled' | 'broken' | 'expired' | 'paused'
  verdict?:    string
  graceCount?: number            // 允许失败次数（daily 型）
  graceUsed?:  number            // 已用宽限次数
  motivation?: string            // 立誓动机
  tags?:       string[]          // 分类标签
}

/** 向后兼容：读取旧格式 vow，补全新字段默认值 */
export function migrateVow(raw: Record<string, unknown>): Vow {
  return {
    ...raw,
    status:     (raw.status     ?? 'active') as Vow['status'],
    graceCount: (raw.graceCount ?? 0)        as number,
    graceUsed:  (raw.graceUsed  ?? 0)        as number,
    tags:       (raw.tags       ?? [])       as string[],
    subGoals:   ((raw.subGoals ?? []) as Record<string, unknown>[]).map(g => ({
      ...g,
      currentCount:    (g.currentCount    ?? 0)  as number,
      weeklyLog:       (g.weeklyLog       ?? {}) as Record<string, number>,
      done:            (g.done            ?? false) as boolean,
      completedDates:  (g.completedDates  ?? [])  as string[],
    })),
  } as Vow
}

// ── 路径工具 ──────────────────────────────────────────────────

const BASE = path.resolve(process.cwd(), 'content/spirit')
const logsDir     = path.join(BASE, 'logs')
const patternsDir = path.join(BASE, 'patterns')
const personaFile = path.join(BASE, 'persona.json')
const vowsFile    = path.join(BASE, 'vows.json')

const conversationsDir = path.join(BASE, 'conversations')

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function readJSON<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as T
  } catch {
    return fallback
  }
}

function writeJSON(file: string, data: unknown) {
  ensureDir(path.dirname(file))
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8')
}

// ── DailyLog ──────────────────────────────────────────────────

export function getDailyLog(date: string): DailyLog | null {
  const file = path.join(logsDir, `${date}.json`)
  if (!fs.existsSync(file)) return null
  return readJSON<DailyLog>(file, null as unknown as DailyLog)
}

export function saveDailyLog(log: DailyLog) {
  ensureDir(logsDir)
  writeJSON(path.join(logsDir, `${log.date}.json`), log)
}

export function getRecentDailyLogs(days: number): DailyLog[] {
  ensureDir(logsDir)
  const logs: DailyLog[] = []
  for (let i = 0; i < days; i++) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const date = d.toISOString().slice(0, 10)
    const log  = getDailyLog(date)
    if (log) logs.push(log)
  }
  return logs
}

// ── WeeklyPattern ─────────────────────────────────────────────

export function getWeeklyPatterns(weeks: number): WeeklyPattern[] {
  ensureDir(patternsDir)
  const files = fs.readdirSync(patternsDir)
    .filter(f => f.endsWith('.json'))
    .sort()
    .slice(-weeks)
  return files.map(f => readJSON<WeeklyPattern>(path.join(patternsDir, f), null as unknown as WeeklyPattern))
    .filter(Boolean)
}

export function saveWeeklyPattern(pattern: WeeklyPattern) {
  ensureDir(patternsDir)
  // 文件名：2026-W14.json
  const d    = new Date(pattern.weekStart)
  const week = getISOWeek(d)
  const year = d.getFullYear()
  writeJSON(path.join(patternsDir, `${year}-W${String(week).padStart(2, '0')}.json`), pattern)
}

function getISOWeek(date: Date): number {
  const d   = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
}

// ── PersonaProfile ────────────────────────────────────────────

const DEFAULT_PERSONA: PersonaProfile = {
  observedTraits:  [],
  recurringIssues: [],
  milestones:      [],
  currentPhase:    '观察中，尚无足够数据',
  lastUpdated:     '',
}

export function getPersona(): PersonaProfile {
  return readJSON<PersonaProfile>(personaFile, DEFAULT_PERSONA)
}

export function savePersona(persona: PersonaProfile) {
  writeJSON(personaFile, persona)
}

// ── Vows ──────────────────────────────────────────────────────

export function getVows(): Vow[] {
  const raw = readJSON<Record<string, unknown>[]>(vowsFile, [])
  return raw.map(migrateVow)
}

export function saveVows(vows: Vow[]) {
  writeJSON(vowsFile, vows)
}

export function getActiveVows(): Vow[] {
  return getVows().filter(v => v.status === 'active')
}

// ── Vow Helper Functions ──────────────────────────────────────

/** 返回本周一（UTC+8 日历日期）的 YYYY-MM-DD */
export function getWeekStart(dateStr?: string): string {
  // 转为 Asia/Shanghai 的字符串，再 parse 成本地日期对象用于日历计算
  const ref     = dateStr ? new Date(dateStr + 'T00:00:00+08:00') : new Date()
  const utc8str = ref.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' })
  const d       = new Date(utc8str)
  const day     = d.getDay() || 7  // 1=Mon … 7=Sun
  d.setDate(d.getDate() - day + 1)
  // 用本地字段拼接，避免 toISOString() 偏移回 UTC 导致日期错位
  const y  = d.getFullYear()
  const m  = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

/** 近 90 天总修为（reach_points 用） */
export function getCumulativePoints(): number {
  return getRecentDailyLogs(90).reduce((s, l) => s + l.totalPoints, 0)
}

/**
 * 计算 completedDates 中从"最近已有记录日期"往前连续的天数。
 * 如果今天也在其中则从今天开始算；否则从最近已记录日往前算。
 */
export function calcVowStreak(dates: string[]): number {
  if (dates.length === 0) return 0
  const set = new Set(dates)
  const today = new Date().toISOString().slice(0, 10)
  // 从今天或最近一天往前数
  const start = set.has(today) ? today : [...dates].sort().pop()!
  let streak = 0
  const d = new Date(start + 'T00:00:00Z')
  while (set.has(d.toISOString().slice(0, 10))) {
    streak++
    d.setUTCDate(d.getUTCDate() - 1)
  }
  return streak
}

// ── Conversations ─────────────────────────────────────────────

export interface ConversationMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp: string
}

export interface Conversation {
  date: string
  messages: ConversationMessage[]
}

export function getConversation(date: string): Conversation {
  ensureDir(conversationsDir)
  const file = path.join(conversationsDir, `${date}.json`)
  return readJSON<Conversation>(file, { date, messages: [] })
}

export function saveConversation(conv: Conversation) {
  ensureDir(conversationsDir)
  const file    = path.join(conversationsDir, `${conv.date}.json`)
  const existing = readJSON<Conversation>(file, { date: conv.date, messages: [] })
  // 拒绝缩水写入：新数据条数少于已有数据时不覆盖，防止 bug 导致历史丢失
  if (conv.messages.length < existing.messages.length) {
    console.warn(`[memory] saveConversation blocked: new(${conv.messages.length}) < existing(${existing.messages.length}), skipping`)
    return
  }
  writeJSON(file, conv)
}

/** 返回所有有对话记录的日期（倒序），直接扫目录，不受时间窗口限制 */
export function getAllConversationDates(): string[] {
  ensureDir(conversationsDir)
  return fs.readdirSync(conversationsDir)
    .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .map(f => f.replace('.json', ''))
    .filter(date => {
      const conv = readJSON<Conversation>(path.join(conversationsDir, `${date}.json`), { date, messages: [] })
      return conv.messages.length > 0
    })
    .sort()
    .reverse()
}

export function getRecentConversations(days: number): Conversation[] {
  ensureDir(conversationsDir)
  const result: Conversation[] = []
  for (let i = 0; i < days; i++) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const date = d.toISOString().slice(0, 10)
    const conv = getConversation(date)
    if (conv.messages.length > 0) result.push(conv)
  }
  return result
}

// ── Conversation Embedding Cache ──────────────────────────────

export interface ConvEmbeddingEntry {
  date:      string
  msgIndex:  number
  role:      'user' | 'assistant'
  content:   string
  timestamp: string
  vec:       number[]
}

const convEmbeddingsFile = path.join(BASE, 'conv_embeddings.json')

export function getConvEmbeddings(): ConvEmbeddingEntry[] {
  return readJSON<ConvEmbeddingEntry[]>(convEmbeddingsFile, [])
}

export function saveConvEmbeddings(entries: ConvEmbeddingEntry[]) {
  writeJSON(convEmbeddingsFile, entries)
}

// ── Blog Posts Cache（同步时写入，搜索时读取，避免实时调 API）────

const blogPostsCacheFile = path.join(BASE, 'blog_posts_cache.json')

/** 缓存的博客文章（含正文，供器灵全文搜索） */
export interface CachedBlogPost {
  slug:        string
  title:       string
  excerpt:     string
  content:     string   // 正文（纯文本，去除 HTML/MDX 标签）
  category:    string
  tags:        string[]
  wordCount:   number
  publishedAt: string   // ISO string
  pointsEarned: number
}

export function getBlogPostsCache(): CachedBlogPost[] {
  return readJSON<CachedBlogPost[]>(blogPostsCacheFile, [])
}

export function saveBlogPostsCache(posts: CachedBlogPost[]) {
  writeJSON(blogPostsCacheFile, posts)
}

// ── Blog Embedding Cache ──────────────────────────────────────

const blogEmbeddingsFile = path.join(BASE, 'blog_embeddings.json')

export interface BlogEmbeddingEntry {
  id:  string   // slug
  vec: number[]
}

export function getBlogEmbeddings(): BlogEmbeddingEntry[] {
  return readJSON<BlogEmbeddingEntry[]>(blogEmbeddingsFile, [])
}

export function saveBlogEmbeddings(entries: BlogEmbeddingEntry[]) {
  writeJSON(blogEmbeddingsFile, entries)
}

// ── Library Embedding Cache ───────────────────────────────────

const libraryEmbeddingsFile = path.join(BASE, 'library', 'embeddings.json')

export interface LibEmbeddingEntry {
  id:  string
  vec: number[]
}

export function getLibEmbeddings(): LibEmbeddingEntry[] {
  return readJSON<LibEmbeddingEntry[]>(libraryEmbeddingsFile, [])
}

export function saveLibEmbeddings(entries: LibEmbeddingEntry[]) {
  writeJSON(libraryEmbeddingsFile, entries)
}

export function upsertVow(vow: Vow) {
  const vows = getVows()
  const idx  = vows.findIndex(v => v.id === vow.id)
  if (idx >= 0) vows[idx] = vow
  else vows.push(vow)
  saveVows(vows)
}

// ── SkillCard ─────────────────────────────────────────────────

/** 从对话中提炼的可复用知识洞察，每周生成一次 */
export interface SkillCard {
  id:          string    // skill_YYYYMMDD_NNN
  title:       string    // 简短标题（≤20字）
  insight:     string    // 一句话摘要，用于列表预览和 prompt 注入
  body?:       string    // 完整 markdown 内容（结构化的 skill 文档）
  tags:        string[]
  sourceDate:  string    // 哪天对话提炼的
  createdAt:   string
  useCount:    number
  userNotes?:  string    // 用户的想法、修正或补充，纳入下次提炼上下文
  editedAt?:   string    // 最后一次人工编辑时间
}

const skillsDir        = path.join(BASE, 'skills')
const skillsIndexFile  = path.join(skillsDir, 'index.json')
const skillsEmbFile    = path.join(skillsDir, 'embeddings.json')

export function getSkills(): SkillCard[] {
  return readJSON<SkillCard[]>(skillsIndexFile, [])
}

export function saveSkills(cards: SkillCard[]) {
  ensureDir(skillsDir)
  writeJSON(skillsIndexFile, cards)
}

export interface SkillEmbeddingEntry {
  id:  string
  vec: number[]
}

export function getSkillEmbeddings(): SkillEmbeddingEntry[] {
  return readJSON<SkillEmbeddingEntry[]>(skillsEmbFile, [])
}

export function saveSkillEmbeddings(entries: SkillEmbeddingEntry[]) {
  ensureDir(skillsDir)
  writeJSON(skillsEmbFile, entries)
}

// ── Preference ────────────────────────────────────────────────

/**
 * 用户偏好画像条目
 * 与技能卡不同：这里存储的是对"这个人是谁"的观察，每次提炼是 update-in-place，
 * 而非追加。置信度随观测次数持续收敛。
 */
export type PreferenceCategory = 'learning' | 'technical' | 'communication' | 'work'

export interface Preference {
  id:               string                // pref_YYYYMMDD_NNN
  category:         PreferenceCategory
  key:              string                // snake_case 标识，如 "prefers_code_first"
  description:      string               // 具体的习惯描述
  confidence:       number               // 0-1，随观测增加
  evidence:         string[]             // 观测到的日期列表
  counterEvidence?: string               // 反例描述（置信度低时）
  lastSeen:         string               // YYYY-MM-DD，最近一次被观测到
  updatedAt:        string               // ISO，最后一次更新时间
}

const preferencesFile = path.join(BASE, 'preferences.json')

export function getPreferences(): Preference[] {
  return readJSON<Preference[]>(preferencesFile, [])
}

export function savePreferences(prefs: Preference[]) {
  writeJSON(preferencesFile, prefs)
}

// ── SessionSummary ────────────────────────────────────────────

/** 每次对话结束后异步生成的当日摘要 */
export interface SessionSummary {
  date:        string
  summary:     string    // 1-2句话总结
  topics:      string[]  // 涉及主题标签
  generatedAt: string
}

const summariesDir = path.join(BASE, 'summaries')

export function getSessionSummary(date: string): SessionSummary | null {
  const file = path.join(summariesDir, `${date}.json`)
  if (!fs.existsSync(file)) return null
  return readJSON<SessionSummary>(file, null as unknown as SessionSummary)
}

export function saveSessionSummary(s: SessionSummary) {
  ensureDir(summariesDir)
  writeJSON(path.join(summariesDir, `${s.date}.json`), s)
}

export function getRecentSummaries(days: number): SessionSummary[] {
  ensureDir(summariesDir)
  const result: SessionSummary[] = []
  for (let i = 0; i < days; i++) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const date = d.toISOString().slice(0, 10)
    const s    = getSessionSummary(date)
    if (s) result.push(s)
  }
  return result
}
