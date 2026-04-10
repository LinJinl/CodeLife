/**
 * LeetCode CN 非官方 Adapter
 *
 * 设置步骤：
 *   1. 在 .env.local 添加：
 *        LEETCODE_CN_USERNAME=你的用户名
 *        LEETCODE_CN_PASSWORD=你的密码
 *   2. 在 codelife.config.ts 设置 leetcode.provider = 'cn'，并填写 cn 配置
 *
 * 工作原理：
 *   - 首次运行时自动用账号密码登录，Session Cookie 缓存到
 *     content/leetcode_cn_session.txt（已在 .gitignore 中忽略）
 *   - Cookie 过期（HTTP 403/401）时自动重新登录
 *   - 题目难度缓存到 content/leetcode_difficulty_cache.json，
 *     每个 titleSlug 只查一次，后续直接读文件
 *
 * 数据说明：
 *   - 最多拉取最近 100 道 AC 题目（LeetCode API 限制）
 *   - category / note 字段无法从 API 获取，保留空字符串
 *   - 如有更早的记录，可同时保留 content/leetcode.yaml 用 manual 模式补充
 *     （未来可支持合并，当前只走 CN API）
 */

import fs   from 'fs'
import path from 'path'
import type { LeetcodeAdapter, LeetcodeProblem, LeetcodeStats, Difficulty } from './types'
import type { LeetcodeConfig, CultivationConfig } from '@/lib/config'

const LC_CN_BASE = 'https://leetcode.cn'
const LC_CN_GQL  = 'https://leetcode.cn/graphql/'

const COOKIE_FILE = path.resolve(process.cwd(), 'content/leetcode_cn_session.txt')
const DIFF_CACHE  = path.resolve(process.cwd(), 'content/leetcode_difficulty_cache.json')
const MASTERED_THRESHOLD = 10

// ── Cookie 存储 ────────────────────────────────────────────────────

interface CookieStore {
  csrftoken:        string
  LEETCODE_SESSION: string
}

function loadCookieStore(): CookieStore | null {
  try { return JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf-8')) as CookieStore } catch { return null }
}

function saveCookieStore(store: CookieStore) {
  fs.mkdirSync(path.dirname(COOKIE_FILE), { recursive: true })
  fs.writeFileSync(COOKIE_FILE, JSON.stringify(store))
}

/** 解析 Response 里所有 Set-Cookie 头，返回 { name: value } */
function parseSCHeaders(res: Response): Record<string, string> {
  const result: Record<string, string> = {}
  // Node 18+: getSetCookie() 返回 string[]，避免逗号歧义
  const headers = res.headers as typeof res.headers & { getSetCookie?: () => string[] }
  const raw = headers.getSetCookie?.() ?? [res.headers.get('set-cookie') ?? '']
  for (const h of raw) {
    const [kv] = h.split(';')
    const idx  = kv.indexOf('=')
    if (idx < 0) continue
    result[kv.slice(0, idx).trim()] = kv.slice(idx + 1).trim()
  }
  return result
}

// ── 难度缓存 ───────────────────────────────────────────────────────

type DiffCache = Record<string, Difficulty>

function loadDiffCache(): DiffCache {
  try { return JSON.parse(fs.readFileSync(DIFF_CACHE, 'utf-8')) as DiffCache } catch { return {} }
}

function saveDiffCache(cache: DiffCache) {
  fs.mkdirSync(path.dirname(DIFF_CACHE), { recursive: true })
  fs.writeFileSync(DIFF_CACHE, JSON.stringify(cache, null, 2))
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
  private username:    string
  private password:    string
  private cult:        CultivationConfig
  private store:       CookieStore | null = null

  constructor(config: LeetcodeConfig, cult: CultivationConfig) {
    if (!config.cn) throw new Error(
      '[LC CN] 请在 codelife.config.ts 配置 leetcode.cn，并在 .env.local 设置 LEETCODE_CN_USERNAME / LEETCODE_CN_PASSWORD'
    )
    this.username = config.cn.username
    this.password = config.cn.password
    this.cult     = cult
  }

  // ── 登录 ──────────────────────────────────────────────────────────

  private async login(): Promise<CookieStore> {
    // Step 1: 拿初始 csrftoken
    const initRes = await fetch(`${LC_CN_BASE}/`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CodeLife/1.0)' },
    })
    const initCookies = parseSCHeaders(initRes)
    const csrftoken   = initCookies['csrftoken'] ?? ''

    // Step 2: 提交账号密码
    const loginRes = await fetch(`${LC_CN_BASE}/accounts/login/`, {
      method:   'POST',
      redirect: 'manual',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie':        `csrftoken=${csrftoken}`,
        'Referer':       `${LC_CN_BASE}/accounts/login/`,
        'X-CSRFToken':   csrftoken,
      },
      body: new URLSearchParams({
        login:               this.username,
        password:            this.password,
        csrfmiddlewaretoken: csrftoken,
      }).toString(),
    })

    const loginCookies = parseSCHeaders(loginRes)
    const session      = loginCookies['LEETCODE_SESSION']
    const newCsrf      = loginCookies['csrftoken'] ?? csrftoken

    if (!session) {
      throw new Error('[LC CN] 登录失败：未收到 LEETCODE_SESSION，请检查账号密码')
    }

    const store = { csrftoken: newCsrf, LEETCODE_SESSION: session }
    saveCookieStore(store)
    return store
  }

  private async ensureStore(): Promise<CookieStore> {
    if (this.store) return this.store
    const cached = loadCookieStore()
    if (cached) { this.store = cached; return cached }
    this.store = await this.login()
    return this.store
  }

  // ── GraphQL 请求（含自动重登） ─────────────────────────────────────

  private async gql<T>(
    query: string,
    variables: Record<string, unknown>,
    isRetry = false,
  ): Promise<T> {
    const store     = await this.ensureStore()
    const cookieStr = `csrftoken=${store.csrftoken}; LEETCODE_SESSION=${store.LEETCODE_SESSION}`

    const res = await fetch(LC_CN_GQL, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie':        cookieStr,
        'X-CSRFToken':   store.csrftoken,
        'Referer':       'https://leetcode.cn/',
      },
      body: JSON.stringify({ query, variables }),
    })

    // Cookie 过期 → 清缓存，重新登录，只重试一次
    if ((res.status === 401 || res.status === 403) && !isRetry) {
      this.store = null
      fs.rmSync(COOKIE_FILE, { force: true })
      this.store = await this.login()
      return this.gql<T>(query, variables, true)
    }

    if (!res.ok) throw new Error(`[LC CN] HTTP ${res.status}: ${await res.text().catch(() => '')}`)

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
      categories: [],  // CN API 无分类统计，显示功法台需配合 manual YAML
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
    const slugs       = submissions.map(s => s.titleSlug)
    const diffCache   = await this.resolveDifficulties(slugs)

    const pointsMap: Record<Difficulty, number> = {
      easy:   this.cult.leetcode.easy,
      medium: this.cult.leetcode.medium,
      hard:   this.cult.leetcode.hard,
    }
    const labelMap: Record<Difficulty, string> = {
      easy: '初锻', medium: '淬炼', hard: '神铸',
    }

    // 同一题只取最近一次 AC（去重）
    const seen     = new Set<string>()
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
