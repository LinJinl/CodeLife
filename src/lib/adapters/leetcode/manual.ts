/**
 * Manual YAML LeetCode Adapter
 *
 * 手动维护 ./content/leetcode.yaml 文件来记录刷题情况。
 * 这是最稳定的方式，不依赖任何第三方 API。
 *
 * YAML 文件格式示例（见 content/leetcode.yaml）：
 *
 *   - id: 72
 *     title: 编辑距离
 *     difficulty: hard       # easy / medium / hard
 *     language: Go
 *     solvedAt: 2026-04-07
 *     note: |
 *       DP 经典题，状态转移方程 dp[i][j] = ...
 *
 *   - id: 1143
 *     title: 最长公共子序列
 *     difficulty: medium
 *     language: Go
 *     solvedAt: 2026-04-06
 */

import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'
import type { LeetcodeAdapter, LeetcodeProblem, LeetcodeStats, Difficulty } from './types'
import type { LeetcodeConfig, CultivationConfig } from '@/lib/config'

function parseYaml(content: string): Array<Record<string, string>> {
  return yaml.load(content) as Array<Record<string, string>>
}

const MASTERED_THRESHOLD = 10 // 某分类超过此题数视为「炼成」

export class ManualLeetcodeAdapter implements LeetcodeAdapter {
  private dataFile: string
  private cult: CultivationConfig

  constructor(config: LeetcodeConfig, cult: CultivationConfig) {
    this.dataFile = path.resolve(process.cwd(), config.manual?.dataFile ?? './content/leetcode.yaml')
    this.cult     = cult
  }

  async getProblems(): Promise<LeetcodeProblem[]> {
    if (!fs.existsSync(this.dataFile)) return []

    const raw     = fs.readFileSync(this.dataFile, 'utf-8')
    const records = parseYaml(raw)

    return records.map(r => {
      const diff = (r.difficulty?.toLowerCase() ?? 'easy') as Difficulty
      const pointsMap: Record<Difficulty, number> = {
        easy:   this.cult.leetcode.easy,
        medium: this.cult.leetcode.medium,
        hard:   this.cult.leetcode.hard,
      }
      const labelMap: Record<Difficulty, string> = {
        easy:   '初锻',
        medium: '淬炼',
        hard:   '神铸',
      }
      return {
        id:           Number(r.id),
        title:        r.title ?? '',
        titleSlug:    r.titleSlug ?? String(r.id),
        difficulty:   diff,
        language:     r.language ?? 'Unknown',
        category:     r.category ?? '',
        solvedAt:     new Date(r.solvedAt ?? Date.now()),
        note:         r.note ?? '',
        pointsEarned: pointsMap[diff],
        pointsLabel:  labelMap[diff],
      } satisfies LeetcodeProblem
    }).sort((a, b) => b.solvedAt.getTime() - a.solvedAt.getTime())
  }

  async getStats(): Promise<LeetcodeStats> {
    const problems = await this.getProblems()

    const easy   = problems.filter(p => p.difficulty === 'easy').length
    const medium = problems.filter(p => p.difficulty === 'medium').length
    const hard   = problems.filter(p => p.difficulty === 'hard').length
    const totalPoints = problems.reduce((s, p) => s + p.pointsEarned, 0)

    // 按 category 字段聚合（YAML 可选字段）
    const catMap = new Map<string, number>()
    problems.forEach(p => {
      const cat = p.category || '未分类'
      catMap.set(cat, (catMap.get(cat) ?? 0) + 1)
    })

    const categories = Array.from(catMap.entries()).map(([name, solved]) => ({
      name,
      solved,
      mastered: solved >= MASTERED_THRESHOLD,
    }))

    return {
      totalSolved: problems.length,
      easy,
      medium,
      hard,
      totalPoints,
      categories,
    }
  }
}
