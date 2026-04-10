export interface GithubRepo {
  name: string
  description: string | null
  url: string
  stars: number
  language: string | null
  pushedAt: Date
  commitCount: number   // 来自 defaultBranch totalCount（GraphQL）
}

export interface GithubCommit {
  hash: string
  message: string
  repoName: string
  committedAt: Date
  pointsEarned: number  // 固定为 cultivation.github.commit
}

export interface GithubContribution {
  date: string   // YYYY-MM-DD
  count: number
  points: number
}

export interface GithubStats {
  totalCommits: number
  totalPoints:  number
  currentStreak: number
  longestStreak: number
  contributions: GithubContribution[]
}

export interface GithubAdapter {
  getRepos(): Promise<GithubRepo[]>
  getRecentCommits(limit?: number): Promise<GithubCommit[]>
  getStats(): Promise<GithubStats>
}
