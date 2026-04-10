/**
 * LeetCode CN 非官方 Adapter
 *
 * 设置步骤：
 *   1. 浏览器登录 leetcode.cn，打开 DevTools（F12）
 *      → Application → Cookies → https://leetcode.cn
 *      复制 LEETCODE_SESSION 和 csrftoken 两个值
 *   2. 在 .env.local 添加：
 *        LEETCODE_CN_USERNAME=你的用户名（URL中可见）
 *        LEETCODE_CN_COOKIE=LEETCODE_SESSION=xxx; csrftoken=yyy
 *   3. 在 codelife.config.ts 设置 leetcode.provider = 'cn'
 *
 * Cookie 过期说明：
 *   - LEETCODE_SESSION 通常有效期数周，过期后重新从浏览器复制即可
 *   - 过期时 GraphQL 请求会返回 401/403，日志中会有提示
 *
 * 数据说明：
 *   - getStats()：总 AC 数按难度分类（Easy/Medium/Hard）
 *   - getProblems()：最近 100 道 AC 题目，去重保留最新一次
 *   - 题目难度缓存到 content/leetcode_difficulty_cache.json（每个 slug 只查一次）
 *   - category / note 无法从 API 获取，保留空字符串
 */

import fs   from 'fs'
import path from 'path'
import type { LeetcodeAdapter, LeetcodeProblem, LeetcodeStats, Difficulty } from './types'
import type { LeetcodeConfig, CultivationConfig } from '@/lib/config'

const LC_CN_GQL = 'https://leetcode.cn/graphql/'
const DIFF_CACHE = path.resolve(process.cwd(), 'content/leetcode_difficulty_cache.json')

// ── 难度缓存 ───────────────────────────────────────────────────────

type DiffCache = Record<string, Difficulty>

function loadDiffCache(): DiffCache {
  try { return JSON.parse(fs.readFileSync(DIFF_CACHE, 'utf-8')) as DiffCache } catch { return {} }
}

function saveDiffCache(cache: DiffCache) {
  fs.mkdirSync(path.dirname(DIFF_CACHE), { recursive: true })
  fs.writeFileSync(DIFF_CACHE, JSON.stringify(cache, null, 2))
}

/** 从 "KEY=val; KEY2=val2" 格式中提取指定 key 的值 */
function extractCookie(cookieStr: string, key: string): string {
  const m = cookieStr.match(new RegExp(`(?:^|;\\s*)${key}=([^;]+)`))
  return m?.[1]?.trim() ?? ''
}

// ── GraphQL 查询 ───────────────────────────────────────────────────

const STATS_QUERY = `
  query userProfile($username: String!) {
    matchedUser(username: $username) {
      submitStats: submitStatsGlobal {
        acSubmissionNum { difficulty count }
      }
    }
  }
`

const RECENT_AC_QUERY = `
  query recentAcSubmissions($username: String!, $limit: Int!) {
    recentAcSubmissionList(username: $username, limit: $limit) {
      id
      title
      titleSlug
      timestamp
      lang
    }
  }
`

const QUESTION_QUERY = `
  query questionDifficulty($titleSlug: String!) {
    question(titleSlug: $titleSlug) {
      difficulty
    }
  }
`

// ── Adapter ────────────────────────────────────────────────────────

export class LeetcodeCNAdapter implements LeetcodeAdapter {
  private username: string
  private cookie:   string   // "LEETCODE_SESSION=xxx; csrftoken=yyy"
  private cult:     CultivationConfig

  constructor(config: LeetcodeConfig, cult: CultivationConfig) {
    if (!config.cn) throw new Error(
      '[LC CN] 请在 codelife.config.ts 配置 leetcode.cn，并在 .env.local 设置 LEETCODE_CN_USERNAME / LEETCODE_CN_COOKIE'
    )
    if (!config.cn.cookie) throw new Error(
      '[LC CN] LEETCODE_CN_COOKIE 未设置。\n' +
      '请浏览器登录 leetcode.cn → F12 → Application → Cookies → 复制 LEETCODE_SESSION 和 csrftoken\n' +
      '格式：LEETCODE_SESSION=xxx; csrftoken=yyy'
    )
    this.username = config.cn.username
    this.cookie   = config.cn.cookie
    this.cult     = cult
  }

  // ── GraphQL 请求 ──────────────────────────────────────────────────

  private async gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const csrftoken = extractCookie(this.cookie, 'csrftoken')

    const res = await fetch(LC_CN_GQL, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie':        this.cookie,
        'X-CSRFToken':   csrftoken,
        'Referer':       'https://leetcode.cn/',
        'User-Agent':    'Mozilla/5.0 (compatible; CodeLife/1.0)',
      },
      body: JSON.stringify({ query, variables }),
    })

    if (res.status === 401 || res.status === 403) {
      throw new Error(
        '[LC CN] Cookie 已过期，请重新从浏览器复制 LEETCODE_SESSION 和 csrftoken 到 .env.local 的 LEETCODE_CN_COOKIE'
      )
    }
    if (!res.ok) throw new Error(`[LC CN] HTTP ${res.status}`)

    const json = await res.json() as { data: T; errors?: unknown[] }
    if (json.errors?.length) throw new Error(`[LC CN] GraphQL: ${JSON.stringify(json.errors)}`)
    return json.data
  }

  // ── 难度查询（带文件缓存，并发 5） ────────────────────────────────

  private async resolveDifficulties(slugs: string[]): Promise<DiffCache> {
    const cache   = loadDiffCache()
    const missing = [...new Set(slugs)].filter(s => !cache[s])

    if (missing.length > 0) {
      for (let i = 0; i < missing.length; i += 5) {
        const batch = missing.slice(i, i + 5)
        await Promise.all(batch.map(async slug => {
          try {
            const data = await this.gql<{ question: { difficulty: string } | null }>(
              QUESTION_QUERY, { titleSlug: slug }
            )
            const raw = data.question?.difficulty?.toLowerCase() ?? ''
            cache[slug] = (['easy', 'medium', 'hard'].includes(raw) ? raw : 'medium') as Difficulty
          } catch {
            cache[slug] = 'medium'
          }
        }))
      }
      saveDiffCache(cache)
    }

    return cache
  }

  // ── 公开接口 ──────────────────────────────────────────────────────

  async getStats(): Promise<LeetcodeStats> {
    const data = await this.gql<{
      matchedUser: {
        submitStats: { acSubmissionNum: Array<{ difficulty: string; count: number }> }
      } | null
    }>(STATS_QUERY, { username: this.username })

    const ac = data.matchedUser?.submitStats.acSubmissionNum ?? []
    const getCount = (d: string) =>
      ac.find(s => s.difficulty.toLowerCase() === d.toLowerCase())?.count ?? 0

    const easy   = getCount('easy')
    const medium = getCount('medium')
    const hard   = getCount('hard')

    return {
      totalSolved: easy + medium + hard,
      easy, medium, hard,
      totalPoints:
        easy   * this.cult.leetcode.easy +
        medium * this.cult.leetcode.medium +
        hard   * this.cult.leetcode.hard,
      categories: [],
    }
  }

  async getProblems(): Promise<LeetcodeProblem[]> {
    const data = await this.gql<{
      recentAcSubmissionList: Array<{
        id:        string
        title:     string
        titleSlug: string
        timestamp: string
        lang:      string
      }>
    }>(RECENT_AC_QUERY, { username: this.username, limit: 100 })

    const submissions = data.recentAcSubmissionList ?? []
    const diffCache   = await this.resolveDifficulties(submissions.map(s => s.titleSlug))

    const pointsMap: Record<Difficulty, number> = {
      easy: this.cult.leetcode.easy, medium: this.cult.leetcode.medium, hard: this.cult.leetcode.hard,
    }
    const labelMap: Record<Difficulty, string> = {
      easy: '初锻', medium: '淬炼', hard: '神铸',
    }

    const seen = new Set<string>()
    const problems: LeetcodeProblem[] = []

    for (const s of submissions) {
      if (seen.has(s.titleSlug)) continue
      seen.add(s.titleSlug)
      const diff = diffCache[s.titleSlug] ?? 'medium'
      problems.push({
        id:           Number(s.id),
        title:        s.title,
        titleSlug:    s.titleSlug,
        difficulty:   diff,
        language:     s.lang ?? '',
        category:     '',
        solvedAt:     new Date(Number(s.timestamp) * 1000),
        note:         '',
        pointsEarned: pointsMap[diff],
        pointsLabel:  labelMap[diff],
      })
    }

    return problems.sort((a, b) => b.solvedAt.getTime() - a.solvedAt.getTime())
  }
}
