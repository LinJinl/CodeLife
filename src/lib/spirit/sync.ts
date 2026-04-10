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
} from './memory'
import type { DailyLog, DailyActivity, WeeklyPattern, PersonaProfile } from './memory'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'

// 避免在 sync 里直接引入 data.ts（会带着 unstable_cache 的服务端约束）
// 改为直接调用 adapter，sync 只在 API route 里执行
import config                      from '../../../codelife.config'
import { createBlogAdapter }       from '../adapters/blog'
import { createLeetcodeAdapter }   from '../adapters/leetcode'
import {
  getBlogEmbeddings, saveBlogEmbeddings,
  getConvEmbeddings, saveConvEmbeddings,
  getRecentConversations,
  getBlogPostsCache, saveBlogPostsCache, type CachedBlogPost,
} from './memory'

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

/** 计算连续天数（从今天往前数有日志的天数） */
function calcStreak(todayDate: string): number {
  let streak = 0
  const logs = getRecentDailyLogs(90)
  const logSet = new Set(logs.map(l => l.date))
  const d = new Date(todayDate)
  // 从昨天往前
  d.setDate(d.getDate() - 1)
  while (logSet.has(d.toISOString().slice(0, 10))) {
    streak++
    d.setDate(d.getDate() - 1)
  }
  return streak + 1  // 加上今天
}

export async function syncToday(): Promise<DailyLog> {
  const date       = todayStr()
  const activities: DailyActivity[] = []
  let   totalPoints = 0

  // ── 博客 ──────────────────────────────────────────────────
  try {
    const blog  = createBlogAdapter(config.blog, config.cultivation)
    const posts = await blog.getPosts()

    // 全量 metadata 缓存到本地，供器灵搜索时离线使用
    const cached: CachedBlogPost[] = posts.map(p => ({
      slug:        p.slug,
      title:       p.title,
      excerpt:     p.excerpt ?? '',
      content:     '',
      category:    p.category,
      tags:        p.tags ?? [],
      wordCount:   p.wordCount,
      publishedAt: typeof p.publishedAt === 'string' ? p.publishedAt : (p.publishedAt as Date).toISOString(),
      pointsEarned: p.pointsEarned,
    }))
    saveBlogPostsCache(cached)

    const todayPosts = posts.filter(p => {
      const d = typeof p.publishedAt === 'string' ? p.publishedAt : (p.publishedAt as Date).toISOString()
      return d.startsWith(date)
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
  } catch { /* 数据源未配置时跳过 */ }

  // ── LeetCode ──────────────────────────────────────────────
  try {
    if (config.leetcode.enabled) {
      const lc       = createLeetcodeAdapter(config.leetcode, config.cultivation)
      const problems = await lc.getProblems()
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
  } catch { /* 数据源未配置时跳过 */ }

  const log: DailyLog = {
    date,
    activities,
    totalPoints,
    streakDay: calcStreak(date),
  }

  saveDailyLog(log)
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
      if (goal.completedDates.includes(log.date)) continue  // 已记录过今天
      let met = false
      switch (goal.metric) {
        case 'blog_daily':
          met = log.activities.some(a => a.type === 'blog' && a.count > 0); break
        case 'leetcode_daily':
          met = log.activities.some(a => a.type === 'leetcode' && a.count > 0); break
        case 'github_daily':
          met = log.activities.some(a => a.type === 'github' && a.count > 0); break
        case 'any_daily':
          met = log.activities.length > 0; break
        default:
          break  // manual — 不自动更新
      }
      if (met) {
        goal.completedDates.push(log.date)
        changed = true
      }
    }
  }

  if (changed) saveVows(vows)
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
  const weekStart = getMonday(new Date()).toISOString().slice(0, 10)
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
      lastUpdated:     new Date().toISOString().slice(0, 10),
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
    const adapter    = createBlogAdapter(config.blog, config.cultivation)
    const posts      = await adapter.getPosts()
    const embCache   = getBlogEmbeddings()
    const embMap     = new Map(embCache.map(e => [e.id, e.vec]))
    const postCache  = getBlogPostsCache()
    const postMap    = new Map(postCache.map(p => [p.slug, p]))

    // 找出还没有全文的文章
    const needContent = posts.filter(p => !postMap.get(p.slug)?.content)

    // 逐篇拉全文（并发 3 篇，避免 API 过载）
    for (let i = 0; i < needContent.length; i += 3) {
      const batch = needContent.slice(i, i + 3)
      await Promise.all(batch.map(async p => {
        try {
          const detail  = await adapter.getPostContentById(p.id)
          const content = detail.content
            ? detail.content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
            : p.excerpt ?? ''
          postMap.set(p.slug, {
            slug: p.slug, title: p.title, excerpt: p.excerpt ?? '',
            content,
            category: p.category, tags: p.tags ?? [],
            wordCount: p.wordCount,
            publishedAt: typeof p.publishedAt === 'string' ? p.publishedAt : (p.publishedAt as Date).toISOString(),
            pointsEarned: p.pointsEarned,
          })
        } catch {
          // 单篇拉失败不中断整体
        }
      }))
    }

    // 补充还没进 postMap 的文章（元数据）
    for (const p of posts) {
      if (!postMap.has(p.slug)) {
        postMap.set(p.slug, {
          slug: p.slug, title: p.title, excerpt: p.excerpt ?? '', content: p.excerpt ?? '',
          category: p.category, tags: p.tags ?? [], wordCount: p.wordCount,
          publishedAt: typeof p.publishedAt === 'string' ? p.publishedAt : (p.publishedAt as Date).toISOString(),
          pointsEarned: p.pointsEarned,
        })
      }
    }
    saveBlogPostsCache(Array.from(postMap.values()))

    // embedding：用 title + content（截断到 6000 字避免超 token）
    const missingEmb = posts.filter(p => !embMap.has(p.slug))
    if (missingEmb.length > 0) {
      const texts = missingEmb.map(p => {
        const cached = postMap.get(p.slug)
        const body   = cached?.content ?? cached?.excerpt ?? ''
        return `${p.title}\n${body}`.slice(0, 6000)
      })
      const vecs = await embedder.embedDocuments(texts)
      missingEmb.forEach((p, i) => embMap.set(p.slug, vecs[i]))
      saveBlogEmbeddings(Array.from(embMap.entries()).map(([id, vec]) => ({ id, vec })))
      blogNew = missingEmb.length
    }
  } catch (e) {
    console.warn('[preIndex] 博客索引失败:', e)
  }

  // ── 对话预索引（近 7 天）────────────────────────────────
  try {
    const convs    = getRecentConversations(7)
    const cache    = getConvEmbeddings()
    const cacheMap = new Map(cache.map(e => [`${e.date}::${e.msgIndex}`, e.vec]))

    const missing: { key: string; date: string; msgIndex: number; role: string; content: string; timestamp: string }[] = []
    for (const conv of convs) {
      conv.messages.forEach((msg, idx) => {
        const key = `${conv.date}::${idx}`
        if (msg.content.trim() && !cacheMap.has(key)) {
          missing.push({ key, date: conv.date, msgIndex: idx, role: msg.role, content: msg.content, timestamp: msg.timestamp ?? '' })
        }
      })
    }

    if (missing.length > 0) {
      const vecs = await embedder.embedDocuments(missing.map(m => m.content))
      missing.forEach((m, i) => {
        cacheMap.set(m.key, vecs[i])
        cache.push({ date: m.date, msgIndex: m.msgIndex, role: m.role as 'user'|'assistant', content: m.content, timestamp: m.timestamp, vec: vecs[i] })
      })
      saveConvEmbeddings(cache)
      convNew = missing.length
    }
  } catch (e) {
    console.warn('[preIndex] 对话索引失败:', e)
  }

  return { blogNew, convNew }
}

/** 是否需要本周 pattern 更新（每周一检查上周） */
export function shouldGenerateWeeklyPattern(): boolean {
  const today = new Date().getDay()  // 0=Sun, 1=Mon
  if (today !== 1) return false      // 只在周一触发
  const existing = getWeeklyPatterns(1)
  const weekStart = getMonday(new Date()).toISOString().slice(0, 10)
  return existing.length === 0 || existing[existing.length - 1].weekStart !== weekStart
}

/** 是否需要更新 persona（距上次更新超 7 天） */
export function shouldUpdatePersona(): boolean {
  const p = getPersona()
  if (!p.lastUpdated) return true
  return (Date.now() - new Date(p.lastUpdated).getTime()) / 86400000 >= 7
}

function getMonday(date: Date): Date {
  const d   = new Date(date)
  const day = d.getDay() || 7
  d.setDate(d.getDate() - day + 1)
  d.setHours(0, 0, 0, 0)
  return d
}
