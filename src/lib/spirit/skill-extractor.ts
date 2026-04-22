/**
 * 技能提炼模块
 *
 * 每周分析近期对话，提炼可复用的知识洞察（SkillCard）。
 * 自动提炼结果先进入 Candidate Memory，用户确认后再晋升到长期技能卡。
 */

import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { z }                           from 'zod'
import type { ChatOpenAI }             from '@langchain/openai'
import {
  getRecentConversations,
  getSkills,
  getSkillEmbeddings, saveSkillEmbeddings,
  type SkillCard,
} from './memory'
import { cosine } from './hybrid-search'
import { dateInTZ, weekStart } from './time'
import { addMemoryCandidates, getAllCandidates } from './candidate-memory'

// ── LLM Schema ────────────────────────────────────────────────

const skillSchema = z.object({
  skills: z.array(z.object({
    title:   z.string(),
    insight: z.string(),    // 一句话摘要，≤50字
    body:    z.string(),    // 完整 markdown skill 文档
    tags:    z.array(z.string()),
  })).max(5),
})

const EXTRACT_SYSTEM = `你是一个高标准的技术知识管理助手，负责从对话中提炼真正有价值的 Skill 文档。

【筛选标准——极为严格，宁缺毋滥】
只提炼满足以下任一条件的内容：
- 解决了有深度的技术问题（有清晰的根因分析 + 解决方案）
- 整理了某个领域/工具的完整使用规律、核心概念或最佳实践
- 总结了学习方法论、架构设计思路或决策原则
- 记录了一个值得反复参考的系统性认知

【不要提炼的内容】
- 简单查询、闲聊、一句话问答
- 显而易见的常识
- 对话中只是顺带一提、没有展开讨论的点
- 已有 Skill 的重复

【每条 Skill 格式要求】
- title：≤20字，准确概括核心知识点
- insight：一句话摘要（≤50字），用于列表预览，说清楚"这篇 skill 解决什么问题"
- body：完整的 markdown 文档，要求：
  * 有结构：用 ## 二级标题分节（背景/问题/核心概念/方案/注意事项/总结 等）
  * 有深度：不只是结论，要有分析过程、原理说明
  * 有实用性：包含具体步骤、代码示例或决策框架
  * 长度：500-1500 字，视内容复杂度决定
  * 语言：中文，技术术语保持英文
- tags：2-5个，精准的技术领域或主题标签

⚠️ 如果对话中没有满足标准的内容，直接返回 {"skills": []}，不要凑数。

必须返回 JSON，不输出其他内容。`

// ── 主函数 ────────────────────────────────────────────────────

export interface ExtractResult {
  cards:    SkillCard[]  // 合并后的完整列表
  newCount: number       // 本次新增数量（0 = 无新洞察）
}

/**
 * 分析最近 days 天的对话，提炼新 SkillCard 并合并到现有列表。
 */
export async function extractSkills(
  days: number,
  model: ChatOpenAI,
): Promise<ExtractResult> {
  const existing = getSkills()
  const convs    = getRecentConversations(days)

  if (convs.length === 0) return { cards: existing, newCount: 0 }

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

  // 有用户注记的卡片：提炼时作为重要参考
  const cardsWithNotes = existing.filter(s => s.userNotes?.trim())
  const notesContext   = cardsWithNotes.length > 0
    ? '\n\n用户对已有洞察的想法（请在提炼时参考）：\n' +
      cardsWithNotes.map(s => `- 「${s.title}」：${s.userNotes}`).join('\n')
    : ''

  try {
    const llm    = model.withStructuredOutput(skillSchema)
    const result = await llm.invoke([
      new SystemMessage(EXTRACT_SYSTEM),
      new HumanMessage(
        `已有洞察（避免重复）：${existingTitles}${notesContext}\n\n` +
        `以下是最近 ${days} 天的对话记录：\n\n${transcript}\n\n` +
        `请提炼新的知识洞察（不包含已有的）。若无值得保留的新洞察，返回空数组。`
      ),
    ])

    const today    = dateInTZ()
    const todayPrefix = `skill_${today.replace(/-/g, '')}_`
    let seq = existing
      .filter(s => s.id.startsWith(todayPrefix))
      .map(s => Number(s.id.slice(todayPrefix.length)))
      .filter(Number.isFinite)
      .reduce((max, n) => Math.max(max, n), 0)

    const newCards = result.skills.map((s) => ({
      id:         `${todayPrefix}${String(++seq).padStart(3, '0')}`,
      title:      s.title,
      insight:    s.insight,
      body:       s.body,
      tags:       s.tags,
      sourceDate: today,
      createdAt:  new Date().toISOString(),
      useCount:   0,
    })) as SkillCard[]

    const deduped = await deduplicateSkills(newCards, existing)
    if (deduped.length > 0) {
      addMemoryCandidates(deduped.map(card => ({
        proposedType: 'skill',
        payload: card,
        reason: `自动提炼发现新技能卡：${card.title}`,
        evidence: [{ type: 'conversation', id: today, date: today }],
        confidence: 0.75,
      })), today)
    }
    return { cards: existing, newCount: deduped.length }
  } catch (err) {
    console.warn('[skill-extractor] extractSkills failed:', err)
    return { cards: existing, newCount: 0 }
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

    // 只持久化已晋升技能卡的 embedding；候选卡片未确认前不污染正式缓存。
    saveSkillEmbeddings(Array.from(cacheMap.entries()).map(([id, vec]) => ({ id, vec })))

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
  const weekStartDate = new Date(`${weekStart()}T00:00:00+08:00`)
  const recentSkillCandidate = getAllCandidates().some(candidate =>
    candidate.proposedType === 'skill' &&
    new Date(candidate.createdAt) >= weekStartDate
  )

  if (skills.length === 0) return !recentSkillCandidate

  const latest = skills[skills.length - 1]
  const latestDate = new Date(latest.createdAt)
  return latestDate < weekStartDate && !recentSkillCandidate
}
