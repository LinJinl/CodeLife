/**
 * 用户偏好工具
 * list_preferences  — 查看当前偏好画像
 * save_preference   — 手动记录/修正偏好（AI 直接写）
 */

import { registerTool }         from '../registry'
import { getPreferences, savePreferences, type Preference, type PreferenceCategory } from '../memory'

// ── list_preferences ──────────────────────────────────────────

registerTool(
  {
    name:        'list_preferences',
    description: '查看用户当前已知的偏好画像（学习方式、技术偏好、沟通风格、工作节律）。' +
                 '结果已按置信度排序。',
    parameters: {
      type:       'object',
      properties: {
        category: {
          type:        'string',
          description: '筛选类别（learning / technical / communication / work），不填则返回全部',
          enum:        ['learning', 'technical', 'communication', 'work'],
        },
        min_confidence: {
          type:        'number',
          description: '最低置信度阈值（0-1），默认 0',
        },
      },
    },
  },
  async (args) => {
    let prefs = getPreferences()
    if (args.category) prefs = prefs.filter(p => p.category === args.category)
    if (typeof args.min_confidence === 'number') {
      prefs = prefs.filter(p => p.confidence >= (args.min_confidence as number))
    }
    prefs = prefs.sort((a, b) => b.confidence - a.confidence)
    return {
      content: JSON.stringify(prefs, null, 2),
      brief:   `${prefs.length} 条偏好画像`,
    }
  },
  {
    displayName: '查看偏好画像',
    domain:      'knowledge',
    agents:      ['planner_agent'],
  },
)

// ── save_preference ───────────────────────────────────────────

registerTool(
  {
    name:        'save_preference',
    description: '记录或更新一条用户偏好观察。当你在对话中发现用户明显的习惯倾向时使用。' +
                 '已有相同 key 的条目会被更新，否则新建。',
    parameters: {
      type:       'object',
      required:   ['key', 'category', 'description', 'confidence'],
      properties: {
        key: {
          type:        'string',
          description: 'snake_case 标识，如 "prefers_code_first"',
        },
        category: {
          type:        'string',
          description: '类别：learning / technical / communication / work',
          enum:        ['learning', 'technical', 'communication', 'work'],
        },
        description: {
          type:        'string',
          description: '具体可验证的习惯描述，如"更倾向先看代码再看文档"（不要写"喜欢代码"这种模糊描述）',
        },
        confidence: {
          type:        'number',
          description: '置信度 0-1。首次观察到建议 0.4~0.55；反复确认到 0.7+；极其强烈且多次验证才 0.85+',
        },
        counter_evidence: {
          type:        'string',
          description: '如果有矛盾行为，简短描述反例',
        },
      },
    },
  },
  async (args) => {
    const prefs = getPreferences()
    const today = new Date().toISOString().slice(0, 10)
    const now   = new Date().toISOString()

    const existingIdx = prefs.findIndex(p => p.key === args.key)
    if (existingIdx >= 0) {
      const ex = prefs[existingIdx]
      ex.description     = args.description as string
      ex.confidence      = Math.min(1, Math.max(0, args.confidence as number))
      ex.category        = args.category as PreferenceCategory
      ex.evidence        = [...new Set([...ex.evidence, today])]
      ex.counterEvidence = (args.counter_evidence as string | undefined) ?? ex.counterEvidence
      ex.lastSeen        = today
      ex.updatedAt       = now
    } else {
      const seq   = prefs.length + 1
      const newId = `pref_${today.replace(/-/g, '')}_${String(seq).padStart(3, '0')}`
      prefs.push({
        id:              newId,
        category:        args.category as PreferenceCategory,
        key:             args.key as string,
        description:     args.description as string,
        confidence:      Math.min(1, Math.max(0, args.confidence as number)),
        evidence:        [today],
        counterEvidence: (args.counter_evidence as string | undefined),
        lastSeen:        today,
        updatedAt:       now,
      } satisfies Preference)
    }

    savePreferences(prefs)
    return {
      content: JSON.stringify(prefs.find(p => p.key === args.key)),
      brief:   `偏好「${args.key}」已更新`,
    }
  },
  {
    displayName: '记录用户偏好',
    domain:      'knowledge',
  },
)
