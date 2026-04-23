import type { SkillCard } from './memory'
import { clampSummary } from './memory-pack'

/**
 * Skill 注入给模型时要像能力卡，而不是只给一句摘要。
 * body 仍然限长，避免长文抢占当前任务上下文。
 */
export function formatSkillForMemory(card: SkillCard, maxBodyChars = 720): string {
  const parts = [
    `能力：${card.insight}`,
    card.body ? `用法：${clampSummary(card.body, maxBodyChars)}` : '',
    card.tags.length ? `标签：${card.tags.join('、')}` : '',
  ].filter(Boolean)
  return parts.join('\n')
}
