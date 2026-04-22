/**
 * 用户偏好提炼模块
 *
 * 核心设计：自动观察不直接写长期偏好。
 * LLM 拿到完整的已有偏好列表 + 近期对话，输出建议更新、新发现和退役项；
 * 这些结果先进入 Candidate Memory，用户确认后再晋升。
 */

import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { z }                           from 'zod'
import type { ChatOpenAI }             from '@langchain/openai'
import {
  getRecentConversations,
  getPreferences,
  type Preference, type PreferenceCategory,
} from './memory'
import { dateInTZ } from './time'
import { addMemoryCandidates } from './candidate-memory'

// ── LLM Schema ────────────────────────────────────────────────

const prefUpdateSchema = z.object({
  updates: z.array(z.object({
    id:              z.string().nullable().optional(),      // null = 新增
    key:             z.string(),
    category:        z.enum(['learning', 'technical', 'communication', 'work']),
    description:     z.string(),
    confidence:      z.number().min(0).max(1),
    newEvidence:     z.array(z.string()).optional(),       // 本次观测到的日期
    counterEvidence: z.string().nullable().optional(),
  })),
  retire: z.array(z.string()).optional(),                  // 退役的偏好 id
})

const PREF_SYSTEM = `你是用户习惯观察者。根据近期对话，维护用户偏好画像（update-in-place）。

偏好类别：
- learning：学习方式（如"喜欢先看代码再看文档"、"需要具体例子才能理解抽象概念"）
- technical：技术偏好（如"倾向函数式风格"、"用 TypeScript 严格模式"）
- communication：表达风格（如"不喜欢废话"、"偏好直接给结论再解释原因"）
- work：工作节律（如"深夜更专注"、"频繁切换任务"）

规则：
- **已有偏好**：根据新对话确认（提高 confidence）或质疑（降低）
  - 有明显支撑证据 → confidence + 0.10 ~ 0.15（不超过 0.95）
  - 有明显矛盾行为 → confidence - 0.15 ~ 0.25
  - 无相关信息 → 保持不变（可以省略该条目不返回）
- **新发现**：id=null，confidence 从 0.4~0.6 开始
- **description** 要具体可验证，如"更倾向先看代码再看文档"而非"喜欢看代码"
- **retire**：confidence 趋近 0 或被对话明确否定时填入 id
- 若对话对偏好无任何新信息，updates 返回空数组（不要强行生成）

必须返回 JSON，不输出其他内容。`

// ── 主函数 ────────────────────────────────────────────────────

export interface PrefExtractResult {
  totalCount:   number
  changedCount: number
}

export async function extractPreferences(
  days: number,
  model: ChatOpenAI,
): Promise<PrefExtractResult> {
  const existing = getPreferences()
  const convs    = getRecentConversations(days)

  if (convs.length === 0) return { totalCount: existing.length, changedCount: 0 }

  // 组装对话文本（每条最多 300 字，总量限制 6000 字）
  let totalChars = 0
  const lines: string[] = []
  for (const conv of convs) {
    for (const msg of conv.messages) {
      if (!msg.content.trim()) continue
      const role    = msg.role === 'user' ? '修士' : '器灵'
      const content = msg.content.slice(0, 300)
      const line    = `[${conv.date}] ${role}：${content}`
      totalChars   += line.length
      if (totalChars > 6000) break
      lines.push(line)
    }
    if (totalChars > 6000) break
  }

  const existingStr = existing.length > 0
    ? existing.map(p =>
        `id:"${p.id}" key:"${p.key}" category:"${p.category}" ` +
        `conf:${p.confidence.toFixed(2)} lastSeen:"${p.lastSeen}"\n  ${p.description}`
      ).join('\n')
    : '（暂无已有偏好，请从对话中发现新的习惯）'

  try {
    const llm    = model.withStructuredOutput(prefUpdateSchema)
    const today  = dateInTZ()
    const result = await llm.invoke([
      new SystemMessage(PREF_SYSTEM),
      new HumanMessage(
        `已有偏好（请 review 并更新，只返回有变化的条目）：\n${existingStr}\n\n` +
        `近期 ${days} 天对话：\n\n${lines.join('\n')}\n\n` +
        `请返回更新内容。若无新观察，updates 返回 []。`
      ),
    ])

    if (result.updates.length === 0 && !result.retire?.length) {
      return { totalCount: existing.length, changedCount: 0 }
    }

    const candidates: Parameters<typeof addMemoryCandidates>[0] = []

    for (const u of result.updates) {
      if (u.id && existing.some(p => p.id === u.id)) {
        const ex = existing.find(p => p.id === u.id)
        candidates.push({
          proposedType: 'preference',
          payload: {
            id: u.id,
            key: u.key,
            category: u.category as PreferenceCategory,
            description: u.description,
            confidence: Math.min(1, Math.max(0, u.confidence)),
            evidence: u.newEvidence ?? [today],
            counterEvidence: u.counterEvidence ?? undefined,
            volatility: ex?.volatility ?? 'moderate',
            source: 'extractor',
          } satisfies Partial<Preference>,
          reason: `自动提炼建议更新已有偏好：${u.key}`,
          evidence: (u.newEvidence ?? [today]).map(date => ({ type: 'conversation', id: date, date })),
          confidence: Math.min(1, Math.max(0, u.confidence)),
        })
      } else {
        candidates.push({
          proposedType: 'preference',
          payload: {
            ...(u.id ? { id: u.id } : {}),
            key: u.key,
            category: u.category as PreferenceCategory,
            description: u.description,
            confidence: Math.min(1, Math.max(0, u.confidence)),
            evidence: u.newEvidence ?? [today],
            counterEvidence: u.counterEvidence ?? undefined,
            volatility: 'moderate',
            source: 'extractor',
          } satisfies Partial<Preference>,
          reason: u.id
            ? `自动提炼建议更新偏好但未找到原 id，按候选处理：${u.key}`
            : `自动提炼发现新偏好：${u.key}`,
          evidence: (u.newEvidence ?? [today]).map(date => ({ type: 'conversation', id: date, date })),
          confidence: Math.min(1, Math.max(0, u.confidence)),
        })
      }
    }

    for (const id of (result.retire ?? [])) {
      const ex = existing.find(p => p.id === id)
      if (ex) {
        candidates.push({
          proposedType: 'preference',
          payload: {
            ...ex,
            confidence: 0,
            counterEvidence: '自动提炼建议退役该偏好',
          } satisfies Preference,
          reason: `自动提炼建议退役偏好：${ex.key}`,
          evidence: [{ type: 'conversation', id: today, date: today }],
          confidence: 0.5,
        })
      }
    }

    const changedCount = candidates.length > 0 ? addMemoryCandidates(candidates, today).length : 0
    return { totalCount: existing.length, changedCount }
  } catch (err) {
    console.warn('[preference-extractor] failed:', err)
    return { totalCount: existing.length, changedCount: 0 }
  }
}
