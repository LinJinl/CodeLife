/**
 * 每日数据同步 + 周期记忆生成
 *
 * syncToday()              — 从数据适配器拉取当日活动 → DailyLog（每次 chat 自动触发）
 * generateWeeklyPattern()  — LLM 分析近 7 日日志 → WeeklyPattern（每周一自动触发）
 * updatePersona()          — LLM 分析近 30 日数据 → PersonaProfile（每 7 天自动触发）
 */

import {
  saveDailyLog, getRecentDailyLogs, getActiveVows, saveVows, getVows,
  saveWeeklyPattern, getWeeklyPatterns, getPersona, savePersona,
  getCumulativePoints, calcVowStreak, getWeekStart,
  updateDataSourceStatus, updateBlogCacheDiagnostics, recordDailySync,
} from './memory'
import { addDays, dateInTZ, weekStart } from './time'
import type { DailyLog, DailyActivity, WeeklyPattern, PersonaProfile, VowSubGoal } from './memory'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'

// 避免在 sync 里直接引入 data.ts（会带着 unstable_cache 的服务端约束）
// 改为直接调用 adapter，sync 只在 API route 里执行
import config                      from '../../../codelife.config'
import { createLeetcodeAdapter }   from '../adapters/leetcode'
import {
  getBlogEmbeddings, saveBlogEmbeddings,
  getConvEmbeddings, saveConvEmbeddings,
  getRecentConversations,
} from './memory'
import { blogDocId, refreshBlogPostsCache } from './blog-cache'

function todayStr(): string {
  return dateInTZ()
}

function convDocId(date: string, msgIndex: number): string {
  return `conversation:${date}:${msgIndex}`
}

/** 计算连续天数（从今天往前数有日志的天数） */
function calcStreak(todayDate: string): number {
  let streak = 0
  const logs = getRecentDailyLogs(90)
  const logSet = new Set(logs.map(l => l.date))
  let cursor = addDays(todayDate, -1)
  while (logSet.has(cursor)) {
    streak++
    cursor = addDays(cursor, -1)
  }
  return streak + 1  // 加上今天
}

export async function syncToday(): Promise<DailyLog> {
  const date       = todayStr()
  const activities: DailyActivity[] = []
  let   totalPoints = 0

  // ── 博客 ──────────────────────────────────────────────────
  try {
    const cache = await refreshBlogPostsCache({ includeContent: true, concurrency: 3 })
    const posts = cache.posts
    updateBlogCacheDiagnostics({
      total: cache.total,
      withContent: cache.withContent,
      fetchedContent: cache.fetchedContent,
      failedContent: cache.failedContent,
    })
    updateDataSourceStatus({
      source: 'blog',
      ok: true,
      message: `已同步 ${cache.total} 篇，${cache.withContent} 篇有正文缓存`,
    })

    const todayPosts = posts.filter(p => {
      return p.publishedAt.startsWith(date)
    })
    if (todayPosts.length > 0) {
      const pts = todayPosts.reduce((s, p) => s + p.pointsEarned, 0)
      activities.push({
        type:   'blog',
        count:  todayPosts.length,
        points: pts,
        titles: todayPosts.map(p => p.title),
      })
      totalPoints += pts
    }
  } catch (err) {
    updateDataSourceStatus({
      source: 'blog',
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    })
  }

  // ── LeetCode ──────────────────────────────────────────────
  try {
    if (config.leetcode.enabled) {
      const lc       = createLeetcodeAdapter(config.leetcode, config.cultivation)
      const problems = await lc.getProblems()
      updateDataSourceStatus({
        source: 'leetcode',
        ok: true,
        message: `已读取 ${problems.length} 条刷题记录`,
      })
      const todayProblems = problems.filter(p => {
        const d = typeof p.solvedAt === 'string' ? p.solvedAt : (p.solvedAt as Date).toISOString()
        return d.startsWith(date)
      })
      if (todayProblems.length > 0) {
        const pts = todayProblems.reduce((s, p) => s + p.pointsEarned, 0)
        activities.push({
          type:   'leetcode',
          count:  todayProblems.length,
          points: pts,
          titles: todayProblems.map(p => p.title),
        })
        totalPoints += pts
      }
    }
  } catch (err) {
    updateDataSourceStatus({
      source: 'leetcode',
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    })
  }

  // ── GitHub ────────────────────────────────────────────────
  try {
    const { createGithubAdapter } = await import('../adapters/github')
    const gh    = createGithubAdapter(config.github, config.cultivation)
    const stats = await gh.getStats()
    updateDataSourceStatus({
      source: 'github',
      ok: true,
      message: `总 commit ${stats.totalCommits}，连续 ${stats.currentStreak} 天`,
    })
    const todayContrib = stats.contributions.find((c: { date: string; count: number }) => c.date === date)
    if (todayContrib && todayContrib.count > 0) {
      const pts = todayContrib.count * (config.cultivation?.github?.commit ?? 15)
      activities.push({ type: 'github', count: todayContrib.count, points: pts })
      totalPoints += pts
    }
  } catch (err) {
    updateDataSourceStatus({
      source: 'github',
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    })
  }

  const log: DailyLog = {
    date,
    activities,
    totalPoints,
    streakDay: calcStreak(date),
  }

  saveDailyLog(log)
  recordDailySync(log)
  checkVowsForToday(log)
  return log
}

/** 根据当日 DailyLog 自动更新活跃誓约的完成状态 */
function checkVowsForToday(log: DailyLog) {
  const vows = getVows()
  let changed = false

  for (const vow of vows) {
    if (vow.status !== 'active') continue
    for (const goal of vow.subGoals) {
      changed = updateGoal(goal, log) || changed
    }
  }

  if (changed) saveVows(vows)
}

function getActivityCount(log: DailyLog, activityType?: VowSubGoal['activityType']): number {
  if (!activityType || activityType === 'any') {
    return log.activities.reduce((s, a) => s + a.count, 0)
  }
  return log.activities.find(a => a.type === activityType)?.count ?? 0
}

function updateGoal(goal: VowSubGoal, log: DailyLog): boolean {
  let changed = false

  switch (goal.metric) {
    // ── daily 型 ────────────────────────────────────────────
    case 'blog_daily': {
      if (goal.completedDates.includes(log.date)) break
      if (log.activities.some(a => a.type === 'blog' && a.count > 0)) {
        goal.completedDates.push(log.date)
        changed = true
      }
      break
    }
    case 'leetcode_daily': {
      if (goal.completedDates.includes(log.date)) break
      if (log.activities.some(a => a.type === 'leetcode' && a.count > 0)) {
        goal.completedDates.push(log.date)
        changed = true
      }
      break
    }
    case 'github_daily': {
      if (goal.completedDates.includes(log.date)) break
      if (log.activities.some(a => a.type === 'github' && a.count > 0)) {
        goal.completedDates.push(log.date)
        changed = true
      }
      break
    }
    case 'any_daily': {
      if (goal.completedDates.includes(log.date)) break
      if (log.activities.length > 0) {
        goal.completedDates.push(log.date)
        changed = true
      }
      break
    }

    // ── count_total：累计计数 ────────────────────────────────
    case 'count_total': {
      if (goal.lastCountedDate === log.date) break  // 防重复
      const cnt = getActivityCount(log, goal.activityType)
      if (cnt > 0) {
        goal.currentCount    = (goal.currentCount ?? 0) + cnt
        goal.lastCountedDate = log.date
        if (goal.target && goal.currentCount >= goal.target) goal.done = true
        changed = true
      }
      break
    }

    // ── count_weekly：每周计数 ───────────────────────────────
    case 'count_weekly': {
      if (goal.lastCountedDate === log.date) break
      const cnt = getActivityCount(log, goal.activityType)
      if (cnt > 0) {
        const ws = getWeekStart(log.date)
        goal.weeklyLog = goal.weeklyLog ?? {}
        goal.weeklyLog[ws] = (goal.weeklyLog[ws] ?? 0) + cnt
        goal.lastCountedDate = log.date
        changed = true
      }
      break
    }

    // ── streak_N：连续天数 ────────────────────────────────────
    case 'streak_N': {
      if (goal.completedDates.includes(log.date)) break
      const cnt = getActivityCount(log, goal.activityType)
      if (cnt > 0) {
        goal.completedDates.push(log.date)
        if (goal.target && calcVowStreak(goal.completedDates) >= goal.target) {
          goal.done = true
        }
        changed = true
      }
      break
    }

    // ── reach_points：修为阈值 ───────────────────────────────
    case 'reach_points': {
      if (goal.done) break
      const total = getCumulativePoints()
      if (goal.target && total >= goal.target) {
        goal.done = true
        changed   = true
      }
      break
    }

    default:
      break  // manual — 不自动更新
  }

  return changed
}

// ── 周期记忆生成 ─────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SimpleLLM = { invoke(messages: any[]): Promise<{ content: unknown }> }

/**
 * 基于近 7 日 DailyLog 生成 WeeklyPattern。
 * 仅当本周 pattern 尚不存在时执行。
 */
export async function generateWeeklyPattern(llm: SimpleLLM): Promise<WeeklyPattern | null> {
  const logs = getRecentDailyLogs(7)
  if (logs.length < 2) return null  // 数据太少，跳过

  // 检查本周 pattern 是否已存在
  const existing = getWeeklyPatterns(1)
  const weekStart = weekStartInCurrentTZ()
  if (existing.length > 0 && existing[existing.length - 1].weekStart === weekStart) {
    return existing[existing.length - 1]  // 本周已生成，幂等
  }

  const summary = logs.map(l => {
    const acts = l.activities.map(a => `${a.type} ${a.count}项 +${a.points}修为`).join('、') || '无活动'
    return `${l.date}：${acts}`
  }).join('\n')

  try {
    const res = await llm.invoke([
      new SystemMessage(`你是一个行为分析助手，请分析以下一周的修炼日志，输出 JSON（不要包裹在代码块里）：
{
  "narrative": "一两句话的叙事性总结，描述本周整体状态和节奏",
  "dominantType": "最活跃的类型（blog/leetcode/github）",
  "activeDays": 活跃天数（数字）,
  "totalPoints": 总修为（数字）,
  "peakDay": "修为最高的日期（YYYY-MM-DD）",
  "flags": ["隐患或异常模式，如连续断更3天，若无则空数组"]
}
只输出 JSON，不要任何解释。`),
      new HumanMessage(summary),
    ])

    const text = typeof res.content === 'string' ? res.content : JSON.stringify(res.content)
    const parsed = JSON.parse(text.replace(/```json?|```/g, '').trim())

    const pattern: WeeklyPattern = {
      weekStart,
      narrative:    parsed.narrative    ?? '本周数据不足',
      stats: {
        activeDays:   parsed.activeDays   ?? logs.filter(l => l.activities.length > 0).length,
        dominantType: parsed.dominantType ?? 'blog',
        totalPoints:  parsed.totalPoints  ?? logs.reduce((s, l) => s + l.totalPoints, 0),
        peakDay:      parsed.peakDay      ?? logs.sort((a, b) => b.totalPoints - a.totalPoints)[0]?.date ?? weekStart,
      },
      flags: parsed.flags ?? [],
    }
    saveWeeklyPattern(pattern)
    return pattern
  } catch {
    return null
  }
}

/**
 * 基于近 30 日数据更新 PersonaProfile。
 * 每 7 天更新一次（由 lastUpdated 判断）。
 */
export async function updatePersona(llm: SimpleLLM): Promise<PersonaProfile | null> {
  const logs     = getRecentDailyLogs(30)
  const patterns = getWeeklyPatterns(4)
  const current  = getPersona()

  // 距上次更新不足 7 天，跳过
  if (current.lastUpdated) {
    const daysSince = (Date.now() - new Date(current.lastUpdated).getTime()) / 86400000
    if (daysSince < 7) return current
  }

  if (logs.length < 3) return null  // 数据太少

  const logSummary = logs.map(l =>
    `${l.date}：${l.activities.map(a => `${a.type}×${a.count}`).join(' ') || '无活动'}`
  ).join('\n')
  const patternSummary = patterns.map(p => `[${p.weekStart}] ${p.narrative} 隐患：${p.flags.join('、') || '无'}`).join('\n')

  try {
    const res = await llm.invoke([
      new SystemMessage(`你是一个行为分析助手。请基于以下修炼记录，更新用户的人格与习惯档案，输出 JSON（不要包裹在代码块里）：
{
  "observedTraits":  ["已观察到的行为特征，3-5条，如「擅长连续高强度输出」「遇到困难题倾向跳过」"],
  "recurringIssues": ["反复出现的问题，2-4条，如「周末断更」「only easy题」"],
  "currentPhase":    "当前修炼阶段的一句话描述，基于数据判断",
  "milestones":      [{"date": "YYYY-MM-DD", "event": "重要里程碑"}]
}
只输出 JSON，不要任何解释。`),
      new HumanMessage(`近30日日志：\n${logSummary}\n\n近4周规律：\n${patternSummary}`),
    ])

    const text = typeof res.content === 'string' ? res.content : JSON.stringify(res.content)
    const parsed = JSON.parse(text.replace(/```json?|```/g, '').trim())

    const persona: PersonaProfile = {
      observedTraits:  parsed.observedTraits  ?? current.observedTraits,
      recurringIssues: parsed.recurringIssues ?? current.recurringIssues,
      milestones:      parsed.milestones      ?? current.milestones,
      currentPhase:    parsed.currentPhase    ?? current.currentPhase,
      lastUpdated:     dateInTZ(),
    }
    savePersona(persona)
    return persona
  } catch {
    return null
  }
}

/**
 * 预热 embedding 索引：博客 + 近期对话
 * 在 POST /api/spirit/sync 末尾调用，确保下次搜索时文档向量已全部就绪。
 * 只计算尚未缓存的条目（增量），API 消耗极低。
 */
export async function preIndexEmbeddings(llm: SimpleLLM): Promise<{ blogNew: number; convNew: number }> {
  // SimpleLLM 不是 Embeddings，需要单独构建 embedder
  // 延迟 import 避免循环依赖
  const { OpenAIEmbeddings } = await import('@langchain/openai')
  const embedder = new OpenAIEmbeddings({
    apiKey:    config.spirit?.apiKey ?? '',
    modelName: 'text-embedding-3-small',
    ...(config.spirit?.baseURL ? { configuration: { baseURL: config.spirit.baseURL } } : {}),
  })

  let blogNew = 0
  let convNew = 0

  // ── 博客预索引（含全文）──────────────────────────────────
  try {
    const cacheInfo = await refreshBlogPostsCache({ includeContent: true, concurrency: 3 })
    updateBlogCacheDiagnostics({
      total: cacheInfo.total,
      withContent: cacheInfo.withContent,
      fetchedContent: cacheInfo.fetchedContent,
      failedContent: cacheInfo.failedContent,
    })

    const posts    = cacheInfo.posts
    const embCache = getBlogEmbeddings()
    const embMap   = new Map(embCache.map(e => [e.id, e.vec]))

    // embedding：用 title + content（截断到 6000 字避免超 token）
    const missingEmb = posts
      .map(post => ({ post, id: blogDocId(post) }))
      .filter(item => !embMap.has(item.id))
    if (missingEmb.length > 0) {
      const texts = missingEmb.map(({ post }) => {
        const body = post.content || post.excerpt || ''
        return `${post.title}\n${body}`.slice(0, 6000)
      })
      const vecs = await embedder.embedDocuments(texts)
      missingEmb.forEach((item, i) => embMap.set(item.id, vecs[i]))
      saveBlogEmbeddings(Array.from(embMap.entries()).map(([id, vec]) => ({ id, vec })))
      blogNew = missingEmb.length
    }
    updateDataSourceStatus({
      source: 'embedding',
      ok: true,
      message: `博客新增 ${blogNew} 条向量`,
    })
  } catch (e) {
    console.warn('[preIndex] 博客索引失败:', e)
    updateDataSourceStatus({
      source: 'embedding',
      ok: false,
      message: e instanceof Error ? e.message : String(e),
    })
  }

  // ── 对话预索引（近 7 天）────────────────────────────────
  try {
    const convs    = getRecentConversations(7)
    const cache    = getConvEmbeddings()
    const cacheMap = new Map(cache.map(e => [e.id ?? convDocId(e.date, e.msgIndex), e.vec]))

    const missing: { key: string; date: string; msgIndex: number; role: string; content: string; timestamp: string }[] = []
    for (const conv of convs) {
      conv.messages.forEach((msg, idx) => {
        const key = convDocId(conv.date, idx)
        if (msg.content.trim() && !cacheMap.has(key)) {
          missing.push({ key, date: conv.date, msgIndex: idx, role: msg.role, content: msg.content, timestamp: msg.timestamp ?? '' })
        }
      })
    }

    if (missing.length > 0) {
      const vecs = await embedder.embedDocuments(missing.map(m => m.content))
      missing.forEach((m, i) => {
        cacheMap.set(m.key, vecs[i])
        cache.push({ id: m.key, date: m.date, msgIndex: m.msgIndex, role: m.role as 'user'|'assistant', content: m.content, timestamp: m.timestamp, vec: vecs[i] })
      })
      saveConvEmbeddings(cache)
      convNew = missing.length
    }
    updateDataSourceStatus({
      source: 'memory',
      ok: true,
      message: `对话新增 ${convNew} 条向量`,
    })
  } catch (e) {
    console.warn('[preIndex] 对话索引失败:', e)
    updateDataSourceStatus({
      source: 'memory',
      ok: false,
      message: e instanceof Error ? e.message : String(e),
    })
  }

  return { blogNew, convNew }
}

/** 是否需要本周 pattern 更新（每周一检查上周） */
export function shouldGenerateWeeklyPattern(): boolean {
  const today = new Date().getDay()  // 0=Sun, 1=Mon
  if (today !== 1) return false      // 只在周一触发
  const existing = getWeeklyPatterns(1)
  const weekStart = weekStartInCurrentTZ()
  return existing.length === 0 || existing[existing.length - 1].weekStart !== weekStart
}

/** 是否需要更新 persona（距上次更新超 7 天） */
export function shouldUpdatePersona(): boolean {
  const p = getPersona()
  if (!p.lastUpdated) return true
  return (Date.now() - new Date(p.lastUpdated).getTime()) / 86400000 >= 7
}

function weekStartInCurrentTZ(): string {
  return weekStart(dateInTZ())
}
