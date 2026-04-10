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
 * metric 约定（自动检测用）：
 *   blog_daily     — 当日 DailyLog 中有 blog 活动
 *   leetcode_daily — 当日 DailyLog 中有 leetcode 活动
 *   github_daily   — 当日 DailyLog 中有 github 活动
 *   any_daily      — 当日有任何活动
 *   manual         — 只能手动标记
 */
export type VowMetric =
  | 'blog_daily'
  | 'leetcode_daily'
  | 'github_daily'
  | 'any_daily'
  | 'manual'

export interface VowSubGoal {
  description:    string
  metric:         VowMetric
  done:           boolean       // 一次性目标用
  completedDates: string[]      // 每日目标用，存 "YYYY-MM-DD"
}

export interface Vow {
  id:         string
  createdAt:  string
  deadline:   string
  raw:        string
  normalized: string
  title:      string            // 简短标题，显示在侧边栏
  subGoals:   VowSubGoal[]
  status:     'active' | 'fulfilled' | 'broken' | 'expired'
  verdict?:   string
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
  return readJSON<Vow[]>(vowsFile, [])
}

export function saveVows(vows: Vow[]) {
  writeJSON(vowsFile, vows)
}

export function getActiveVows(): Vow[] {
  return getVows().filter(v => v.status === 'active')
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
  writeJSON(path.join(conversationsDir, `${conv.date}.json`), conv)
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
  id:         string    // skill_YYYYMMDD_NNN
  title:      string    // 简短标题（≤20字）
  insight:    string    // 完整知识洞察（2-4句）
  tags:       string[]
  sourceDate: string    // 哪天对话提炼的
  createdAt:  string
  useCount:   number
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
