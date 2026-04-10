import type { RealmConfig } from '@/lib/config'

export interface RealmStatus {
  name: string
  stage: string
  displayName: string      // 例："金丹期"，或 "炼气期 · 一重"
  currentPoints: number
  threshold: number        // 当前境界起点
  nextThreshold: number    // 下一境界起点（-1 表示已是最高）
  progress: number         // 0-100
  pointsToNext: number     // -1 表示已是最高
}

export function getRealmStatus(totalPoints: number, realms: RealmConfig[]): RealmStatus {
  const sorted = [...realms].sort((a, b) => a.threshold - b.threshold)

  let current = sorted[0]
  let nextIdx = 1

  for (let i = 0; i < sorted.length; i++) {
    if (totalPoints >= sorted[i].threshold) {
      current = sorted[i]
      nextIdx = i + 1
    }
  }

  const next = nextIdx < sorted.length ? sorted[nextIdx] : null

  const threshold     = current.threshold
  const nextThreshold = next?.threshold ?? -1
  const displayName   = current.stage
    ? `${current.name} · ${current.stage}`
    : current.name

  const progress = next
    ? Math.min(100, Math.round(((totalPoints - threshold) / (nextThreshold - threshold)) * 100))
    : 100

  const pointsToNext = next ? nextThreshold - totalPoints : -1

  return {
    name:          current.name,
    stage:         current.stage,
    displayName,
    currentPoints: totalPoints,
    threshold,
    nextThreshold,
    progress,
    pointsToNext,
  }
}
