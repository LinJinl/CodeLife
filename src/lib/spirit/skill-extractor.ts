/**
 * 技能提炼模块
 *
 * 每周分析近期对话，提炼可复用的知识洞察（SkillCard），持久化到 content/spirit/skills/。
 * 用 embedding cosine 去重，避免重复积累相似卡片。
 */

import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { z }                           from 'zod'
import type { ChatOpenAI }             from '@langchain/openai'
import {
  getRecentConversations,
  getSkills, saveSkills,
  getSkillEmbeddings, saveSkillEmbeddings,
  type SkillCard,
} from './memory'
import { cosine } from './hybrid-search'

// ── LLM Schema ────────────────────────────────────────────────

const skillSchema = z.object({
  skills: z.array(z.object({
    title:   z.string(),
    insight: z.string(),
    tags:    z.array(z.string()),
  })).max(10),
})

const EXTRACT_SYSTEM = `你是一个知识管理助手，负责从对话记录中提炼可复用的知识洞察。

每条洞察需要满足：
- 对未来类似问题有参考价值（不是一次性的闲聊）
- title：≤20字，概括核心要点
- insight：2-4句话，说清楚发现了什么、解决了什么问题、结论是什么
- tags：2-4个，技术领域或主题标签

类型举例：
- 解决了某个技术 bug 的根因和方法
- 发现了用户的学习偏好或习惯
- 整理了某个领域的学习路线
- 记录了某个工具/库的使用规律

必须返回 JSON，不输出其他内容。`

// ── 主函数 ────────────────────────────────────────────────────

/**
 * 分析最近 days 天的对话，提炼新 SkillCard 并合并到现有列表。
 * 返回合并后的完整列表。
 */
export async function extractSkills(
  days: number,
  model: ChatOpenAI,
): Promise<SkillCard[]> {
  const existing = getSkills()
  const convs    = getRecentConversations(days)

  if (convs.length === 0) return existing

  // 组装对话文本（每条消息最多 400 字，总量限制 8000 字）
  let totalChars = 0
  const lines: string[] = []
  for (const conv of convs) {
    for (const msg of conv.messages) {
      if (!msg.content.trim()) continue
      const role    = msg.role === 'user' ? '修士' : '器灵'
      const content = msg.content.slice(0, 400)
      const line    = `[${conv.date}] ${role}：${content}`
      totalChars += line.length
      if (totalChars > 8000) break
      lines.push(line)
    }
    if (totalChars > 8000) break
  }

  const transcript     = lines.join('\n')
  const existingTitles = existing.map(s => s.title).join('、') || '无'

  try {
    const llm    = model.withStructuredOutput(skillSchema)
    const result = await llm.invoke([
      new SystemMessage(EXTRACT_SYSTEM),
      new HumanMessage(
        `已有洞察（避免重复）：${existingTitles}\n\n` +
        `以下是最近 ${days} 天的对话记录：\n\n${transcript}\n\n` +
        `请提炼3-8条新的知识洞察（不包含已有的）。`
      ),
    ])

    const today    = new Date().toISOString().slice(0, 10)
    const newCards = result.skills.map((s, i) => ({
      id:         `skill_${today.replace(/-/g, '')}_${String(i + 1).padStart(3, '0')}`,
      title:      s.title,
      insight:    s.insight,
      tags:       s.tags,
      sourceDate: today,
      createdAt:  new Date().toISOString(),
      useCount:   0,
    })) as SkillCard[]

    const deduped = await deduplicateSkills(newCards, existing)
    const merged  = [...existing, ...deduped]

    saveSkills(merged)
    return merged
  } catch (err) {
    console.warn('[skill-extractor] extractSkills failed:', err)
    return existing
  }
}

// ── 去重 ──────────────────────────────────────────────────────

const SIMILARITY_THRESHOLD = 0.85

/**
 * 用 cosine 相似度去重：新卡片与已有卡片相似度 > 0.85 则跳过。
 * 没有 embedder 时退化为标题字符串去重。
 */
async function deduplicateSkills(
  newCards:  SkillCard[],
  existing:  SkillCard[],
): Promise<SkillCard[]> {
  if (existing.length === 0) return newCards

  // 优先用 embedding 去重
  try {
    const { OpenAIEmbeddings } = await import('@langchain/openai')
    const config = (await import('../../../codelife.config')).default
    const embedder = new OpenAIEmbeddings({
      apiKey:    config.spirit?.apiKey,
      modelName: 'text-embedding-3-small',
      ...(config.spirit?.baseURL ? { configuration: { baseURL: config.spirit.baseURL } } : {}),
    })

    const cache    = getSkillEmbeddings()
    const cacheMap = new Map(cache.map(e => [e.id, e.vec]))

    // 计算已有卡片的 embedding（优先用缓存）
    const existingMissing = existing.filter(s => !cacheMap.has(s.id))
    if (existingMissing.length > 0) {
      const vecs = await embedder.embedDocuments(existingMissing.map(s => s.title + '。' + s.insight))
      existingMissing.forEach((s, i) => cacheMap.set(s.id, vecs[i]))
    }

    // 计算新卡片的 embedding
    const newVecs = await embedder.embedDocuments(newCards.map(s => s.title + '。' + s.insight))

    // 持久化所有 embedding（已有 + 新的）
    const allEntries = [
      ...Array.from(cacheMap.entries()).map(([id, vec]) => ({ id, vec })),
      ...newCards.map((s, i) => ({ id: s.id, vec: newVecs[i] })),
    ]
    saveSkillEmbeddings(allEntries)

    // 过滤：与任何已有卡片相似度过高的新卡片丢弃
    const existingVecs = existing.map(s => cacheMap.get(s.id)!)
    return newCards.filter((_, ni) => {
      const nv = newVecs[ni]
      return existingVecs.every(ev => ev ? cosine(nv, ev) < SIMILARITY_THRESHOLD : true)
    })
  } catch {
    // 降级：标题字符串去重
    const existingTitles = new Set(existing.map(s => s.title))
    return newCards.filter(s => !existingTitles.has(s.title))
  }
}

// ── 是否需要提炼 ──────────────────────────────────────────────

/**
 * 判断本周是否已提炼过技能（避免重复触发）。
 * 逻辑：检查 skills/index.json 中是否有本周内 createdAt 的卡片。
 */
export function shouldExtractSkills(): boolean {
  const skills = getSkills()
  if (skills.length === 0) return true

  const now      = new Date()
  const weekStart = new Date(now)
  weekStart.setDate(now.getDate() - now.getDay())  // 本周日（或周一，取决于 locale）
  weekStart.setHours(0, 0, 0, 0)

  const latest = skills[skills.length - 1]
  const latestDate = new Date(latest.createdAt)
  return latestDate < weekStart
}
