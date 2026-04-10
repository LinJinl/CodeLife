export type Difficulty = 'easy' | 'medium' | 'hard'

export interface LeetcodeProblem {
  id: number
  title: string
  titleSlug: string
  difficulty: Difficulty
  language: string
  category: string   // 算法分类：动态规划 / 滑动窗口 / 二分搜索 等
  solvedAt: Date
  note: string
  pointsEarned: number
  pointsLabel: string // 初锻 / 淬炼 / 神铸
}

export interface LeetcodeCategory {
  name: string
  solved: number
  mastered: boolean
}

export interface LeetcodeStats {
  totalSolved: number
  easy:   number
  medium: number
  hard:   number
  totalPoints: number
  categories: LeetcodeCategory[]
}

export interface LeetcodeAdapter {
  getProblems(): Promise<LeetcodeProblem[]>
  getStats(): Promise<LeetcodeStats>
}
