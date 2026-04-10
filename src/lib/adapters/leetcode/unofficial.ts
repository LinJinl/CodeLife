/**
 * LeetCode Unofficial API Adapter（国际版）
 *
 * 使用说明：
 *   LeetCode 无官方公开 API。此 adapter 使用 leetcode.com 的 GraphQL 端点，
 *   该端点为内部接口，随时可能变更。
 *
 *   如遇到 403 / CORS 问题，需要提供登录态 Cookie：
 *   1. 浏览器登录 leetcode.com
 *   2. 打开 DevTools → Network → 任意一个 graphql 请求
 *   3. 复制 Request Headers 中的 Cookie 字段值
 *   4. 写入 .env.local → LEETCODE_COOKIE=...
 *
 * 注意：此方式仅能获取「已提交通过」的题目（accepted submissions）。
 *       如需记录笔记/心得，仍需配合 manual adapter 或在本地记录。
 */

import type { LeetcodeAdapter, LeetcodeProblem, LeetcodeStats, Difficulty } from './types'
import type { LeetcodeConfig, CultivationConfig } from '@/lib/config'

const LC_GRAPHQL = 'https://leetcode.com/graphql'

export class UnofficialLeetcodeAdapter implements LeetcodeAdapter {
  private username: string
  private cookie?: string
  private cult: CultivationConfig

  constructor(config: LeetcodeConfig, cult: CultivationConfig) {
    this.username = config.username
    this.cookie   = config.unofficial?.cookie
    this.cult     = cult
  }

  private async query(query: string, variables?: Record<string, unknown>) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.cookie) headers['Cookie'] = this.cookie

    const res = await fetch(LC_GRAPHQL, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query, variables }),
    })
    if (!res.ok) throw new Error(`[LeetCode] ${res.status}: ${await res.text()}`)
    const json = await res.json()
    if (json.errors) throw new Error(`[LeetCode] GraphQL errors: ${JSON.stringify(json.errors)}`)
    return json.data
  }

  async getProblems(): Promise<LeetcodeProblem[]> {
    // 获取 AC submissions（只返回最近 N 条，LeetCode 无法批量拉全量）
    const data = await this.query(`
      query recentAcSubmissions($username: String!, $limit: Int!) {
        recentAcSubmissionList(username: $username, limit: $limit) {
          id
          title
          titleSlug
          timestamp
          lang
        }
      }
    `, { username: this.username, limit: 50 })

    const items = data.recentAcSubmissionList as Array<{
      id: string
      title: string
      titleSlug: string
      timestamp: string
      lang: string
    }>

    // recentAcSubmissionList 不含 difficulty，需要额外查询（或从 questionData 接口拿）
    // 此处简化：difficulty 设为 unknown，后续可以补全
    const pointsMap: Record<Difficulty, number> = {
      easy:   this.cult.leetcode.easy,
      medium: this.cult.leetcode.medium,
      hard:   this.cult.leetcode.hard,
    }

    return items.map(item => ({
      id:           Number(item.id),
      title:        item.title,
      titleSlug:    item.titleSlug,
      difficulty:   'medium' as Difficulty,  // placeholder，需要额外 API 补全
      language:     item.lang,
      solvedAt:     new Date(Number(item.timestamp) * 1000),
      category:     '',
      note:         '',
      pointsEarned: pointsMap['medium'],
      pointsLabel:  '试炼',
    }))
  }

  async getStats(): Promise<LeetcodeStats> {
    const data = await this.query(`
      query userProfile($username: String!) {
        matchedUser(username: $username) {
          submitStats: submitStatsGlobal {
            acSubmissionNum {
              difficulty
              count
            }
          }
        }
      }
    `, { username: this.username })

    const acStats = data.matchedUser.submitStats.acSubmissionNum as Array<{
      difficulty: string
      count: number
    }>

    const getCount = (d: string) => acStats.find(s => s.difficulty === d)?.count ?? 0
    const easy   = getCount('Easy')
    const medium = getCount('Medium')
    const hard   = getCount('Hard')

    return {
      totalSolved: easy + medium + hard,
      easy,
      medium,
      hard,
      totalPoints:
        easy   * this.cult.leetcode.easy +
        medium * this.cult.leetcode.medium +
        hard   * this.cult.leetcode.hard,
      categories: [],  // unofficial API 无法按分类统计，建议切换 manual
    }
  }
}
