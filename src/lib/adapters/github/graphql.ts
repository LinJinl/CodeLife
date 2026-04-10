/**
 * GitHub GraphQL Adapter
 *
 * 使用前提：
 *   1. 前往 https://github.com/settings/tokens → Generate new token (classic)
 *   2. 勾选权限：read:user, read:org（只需只读）
 *   3. 写入 .env.local → GITHUB_TOKEN=ghp_xxxxxxxxxxxx
 *
 * 数据说明：
 *   - getRepos()         公开仓库列表，按最近推送排序
 *   - getRecentCommits() 近期 commit（通过 REST /repos/:owner/:repo/commits）
 *   - getStats()         contributions calendar（仅支持当前年份，GraphQL API 限制）
 */

import type { GithubAdapter, GithubRepo, GithubCommit, GithubStats, GithubContribution } from './types'
import type { GithubConfig, CultivationConfig } from '@/lib/config'

const GH_GRAPHQL = 'https://api.github.com/graphql'
const GH_REST    = 'https://api.github.com'

async function gql(token: string, query: string, variables?: Record<string, unknown>) {
  const res = await fetch(GH_GRAPHQL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  })
  if (!res.ok) throw new Error(`[GitHub] GraphQL ${res.status}: ${await res.text()}`)
  const json = await res.json()
  if (json.errors) throw new Error(`[GitHub] GraphQL errors: ${JSON.stringify(json.errors)}`)
  return json.data
}

export class GithubGraphQLAdapter implements GithubAdapter {
  private token: string
  private username: string
  private pinnedRepos: string[]
  private commitPoints: number

  constructor(config: GithubConfig, cult: CultivationConfig) {
    this.token      = config.token ?? ''
    this.username   = config.username
    this.pinnedRepos = config.pinnedRepos ?? []
    this.commitPoints = cult.github.commit
  }

  async getRepos(): Promise<GithubRepo[]> {
    const data = await gql(this.token, `
      query($login: String!) {
        user(login: $login) {
          repositories(
            first: 20
            privacy: PUBLIC
            orderBy: { field: PUSHED_AT, direction: DESC }
            isFork: false
          ) {
            nodes {
              name
              description
              url
              stargazerCount
              primaryLanguage { name }
              pushedAt
              defaultBranchRef {
                target {
                  ... on Commit {
                    history { totalCount }
                  }
                }
              }
            }
          }
        }
      }
    `, { login: this.username })

    const nodes = data.user.repositories.nodes as Array<{
      name: string
      description: string | null
      url: string
      stargazerCount: number
      primaryLanguage: { name: string } | null
      pushedAt: string
      defaultBranchRef: { target: { history: { totalCount: number } } } | null
    }>

    const repos = nodes.map(n => ({
      name:        n.name,
      description: n.description,
      url:         n.url,
      stars:       n.stargazerCount,
      language:    n.primaryLanguage?.name ?? null,
      pushedAt:    new Date(n.pushedAt),
      commitCount: n.defaultBranchRef?.target?.history?.totalCount ?? 0,
    }))

    if (this.pinnedRepos.length > 0) {
      return repos.filter(r => this.pinnedRepos.includes(r.name))
    }
    return repos
  }

  async getRecentCommits(limit = 20): Promise<GithubCommit[]> {
    // REST API：获取用户所有 public repo 的最近 commit
    const reposRes = await fetch(
      `${GH_REST}/users/${this.username}/repos?type=public&per_page=10&sort=pushed`,
      { headers: { Authorization: `Bearer ${this.token}` } }
    )
    const repos = await reposRes.json() as Array<{ name: string }>

    const allCommits: GithubCommit[] = []
    await Promise.allSettled(
      repos.slice(0, 5).map(async repo => {
        const res = await fetch(
          `${GH_REST}/repos/${this.username}/${repo.name}/commits?per_page=10&author=${this.username}`,
          { headers: { Authorization: `Bearer ${this.token}` } }
        )
        if (!res.ok) return
        const commits = await res.json() as Array<{
          sha: string
          commit: { message: string; author: { date: string } }
        }>
        commits.forEach(c => allCommits.push({
          hash:         c.sha.slice(0, 7),
          message:      c.commit.message.split('\n')[0],
          repoName:     repo.name,
          committedAt:  new Date(c.commit.author.date),
          pointsEarned: this.commitPoints,
        }))
      })
    )

    return allCommits
      .sort((a, b) => b.committedAt.getTime() - a.committedAt.getTime())
      .slice(0, limit)
  }

  async getStats(): Promise<GithubStats> {
    const data = await gql(this.token, `
      query($login: String!) {
        user(login: $login) {
          contributionsCollection {
            contributionCalendar {
              totalContributions
              weeks {
                contributionDays {
                  date
                  contributionCount
                }
              }
            }
          }
        }
      }
    `, { login: this.username })

    const calendar = data.user.contributionsCollection.contributionCalendar
    const days: GithubContribution[] = calendar.weeks.flatMap(
      (w: { contributionDays: Array<{ date: string; contributionCount: number }> }) =>
        w.contributionDays.map(d => ({
          date:   d.date,
          count:  d.contributionCount,
          points: d.contributionCount * this.commitPoints,
        }))
    )

    // 计算连续天数
    let currentStreak = 0
    let longestStreak = 0
    let streak = 0
    for (const d of [...days].reverse()) {
      if (d.count > 0) {
        streak++
        if (currentStreak === 0) currentStreak = streak
        longestStreak = Math.max(longestStreak, streak)
      } else {
        if (currentStreak === 0) currentStreak = 0
        streak = 0
      }
    }

    return {
      totalCommits:  calendar.totalContributions,
      totalPoints:   calendar.totalContributions * this.commitPoints,
      currentStreak,
      longestStreak,
      contributions: days,
    }
  }
}
