/**
 * LeetCode CN 非官方 Adapter
 *
 * 设置步骤：
 *   1. 浏览器登录 leetcode.cn → F12 → Application → Cookies → https://leetcode.cn
 *      复制 LEETCODE_SESSION 和 csrftoken 两个 Cookie 值
 *   2. .env.local 添加：
 *        LEETCODE_CN_USERNAME=你的用户名（力扣个人主页 URL 里的那段，如 jinl）
 *        LEETCODE_CN_COOKIE=LEETCODE_SESSION=xxx; csrftoken=yyy
 *   3. codelife.config.ts 设置 leetcode.provider = 'cn'
 *
 * Cookie 过期说明：
 *   过期后 API 返回 401/403，重新从浏览器复制即可。
 *
 * 实现说明：
 *   - 通过 userStatus 获取 userSlug（非手机号/邮箱账号）
 *   - 统计：userProfileUserQuestionProgress(userSlug)
 *   - 近期 AC：submissionList(status: AC) 过滤，从 url 提取 titleSlug
 *   - 难度：题目难度缓存到 content/leetcode_difficulty_cache.json，每个 slug 只查一次
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
function saveDiffCache(c: DiffCache) {
  fs.mkdirSync(path.dirname(DIFF_CACHE), { recursive: true })
  fs.writeFileSync(DIFF_CACHE, JSON.stringify(c, null, 2))
}

function extractCookie(str: string, key: string): string {
  return str.match(new RegExp(`(?:^|;\\s*)${key}=([^;]+)`))?.[1]?.trim() ?? ''
}

// ── GraphQL 查询 ───────────────────────────────────────────────────

const USER_STATUS_QUERY = `{ userStatus { userSlug } }`

const STATS_QUERY = `
  query userProgress($userSlug: String!) {
    userProfileUserQuestionProgress(userSlug: $userSlug) {
      numAcceptedQuestions { difficulty count }
    }
  }
`

// submissionList 支持 status 过滤，从 url 字段提取 titleSlug
const SUBMISSIONS_QUERY = `
  query submissions($offset: Int!, $limit: Int!) {
    submissionList(offset: $offset, limit: $limit, status: AC) {
      hasNext
      submissions { id title lang timestamp url frontendId }
    }
  }
`

const QUESTION_QUERY = `
  query questionDifficulty($titleSlug: String!) {
    question(titleSlug: $titleSlug) { difficulty }
  }
`

// ── Adapter ────────────────────────────────────────────────────────

export class LeetcodeCNAdapter implements LeetcodeAdapter {
  private cookie: string
  private cult:   CultivationConfig
  private userSlug: string | null = null   // 懒加载

  constructor(config: LeetcodeConfig, cult: CultivationConfig) {
    if (!config.cn?.cookie) throw new Error(
      '[LC CN] LEETCODE_CN_COOKIE 未设置。\n' +
      '浏览器登录 leetcode.cn → F12 → Application → Cookies\n' +
      '复制 LEETCODE_SESSION 和 csrftoken，格式：\n' +
      'LEETCODE_CN_COOKIE=LEETCODE_SESSION=xxx; csrftoken=yyy'
    )
    this.cookie = config.cn.cookie
    this.cult   = cult
  }

  // ── GraphQL 请求 ──────────────────────────────────────────────────

  private async gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const csrf = extractCookie(this.cookie, 'csrftoken')
    const res  = await fetch(LC_CN_GQL, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie':        this.cookie,
        'X-CSRFToken':   csrf,
        'Referer':       'https://leetcode.cn/',
      },
      body: JSON.stringify({ query, variables }),
    })
    if (res.status === 401 || res.status === 403) throw new Error(
      '[LC CN] Cookie 已过期，请重新从浏览器复制 LEETCODE_SESSION 和 csrftoken 到 .env.local'
    )
    if (!res.ok) throw new Error(`[LC CN] HTTP ${res.status}`)
    const json = await res.json() as { data: T; errors?: { message: string }[] }
    if (json.errors?.length) throw new Error(`[LC CN] ${json.errors[0].message}`)
    return json.data
  }

  private async ensureUserSlug(): Promise<string> {
    if (this.userSlug) return this.userSlug
    const data = await this.gql<{ userStatus: { userSlug: string } }>(USER_STATUS_QUERY)
    this.userSlug = data.userStatus.userSlug
    return this.userSlug
  }

  // ── 难度查询（带文件缓存，并发 5） ────────────────────────────────

  private async resolveDifficulties(slugs: string[]): Promise<DiffCache> {
    const cache   = loadDiffCache()
    const missing = [...new Set(slugs)].filter(s => !cache[s])

    for (let i = 0; i < missing.length; i += 5) {
      await Promise.all(missing.slice(i, i + 5).map(async slug => {
        try {
          const d = await this.gql<{ question: { difficulty: string } | null }>(QUESTION_QUERY, { titleSlug: slug })
          const raw = d.question?.difficulty?.toLowerCase() ?? ''
          cache[slug] = (['easy', 'medium', 'hard'].includes(raw) ? raw : 'medium') as Difficulty
        } catch { cache[slug] = 'medium' }
      }))
    }
    if (missing.length > 0) saveDiffCache(cache)
    return cache
  }

  // ── 公开接口 ──────────────────────────────────────────────────────

  async getStats(): Promise<LeetcodeStats> {
    const userSlug = await this.ensureUserSlug()
    const data = await this.gql<{
      userProfileUserQuestionProgress: { numAcceptedQuestions: { difficulty: string; count: number }[] }
    }>(STATS_QUERY, { userSlug })

    const ac = data.userProfileUserQuestionProgress.numAcceptedQuestions
    const get = (d: string) => ac.find(s => s.difficulty === d)?.count ?? 0
    const easy = get('EASY'), medium = get('MEDIUM'), hard = get('HARD')

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
    // 拉最多 100 条 AC 记录（两页各 50）
    const allSubs: Array<{ id: string; title: string; lang: string; timestamp: string; url: string; frontendId: number }> = []

    for (const offset of [0, 50]) {
      const data = await this.gql<{
        submissionList: {
          hasNext: boolean
          submissions: typeof allSubs
        }
      }>(SUBMISSIONS_QUERY, { offset, limit: 50 })
      allSubs.push(...(data.submissionList.submissions ?? []))
      if (!data.submissionList.hasNext) break
    }

    // 从 url 提取 titleSlug，去重保留最新 AC
    const seen = new Set<number>()
    const unique = allSubs
      .map(s => ({ ...s, titleSlug: s.url.match(/\/problems\/([^/]+)\//)?.[1] ?? '' }))
      .filter(s => { if (seen.has(s.frontendId)) return false; seen.add(s.frontendId); return true })

    const diffCache = await this.resolveDifficulties(unique.map(s => s.titleSlug))

    const pointsMap: Record<Difficulty, number> = {
      easy: this.cult.leetcode.easy, medium: this.cult.leetcode.medium, hard: this.cult.leetcode.hard,
    }
    const labelMap: Record<Difficulty, string> = { easy: '初锻', medium: '淬炼', hard: '神铸' }

    return unique.map(s => {
      const diff = diffCache[s.titleSlug] ?? 'medium'
      return {
        id:           s.frontendId,
        title:        s.title,
        titleSlug:    s.titleSlug,
        difficulty:   diff,
        language:     s.lang,
        category:     '',
        solvedAt:     new Date(Number(s.timestamp) * 1000),
        note:         '',
        pointsEarned: pointsMap[diff],
        pointsLabel:  labelMap[diff],
      }
    })
  }
}
