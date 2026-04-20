/**
 * 用户偏好工具
 * list_preferences  — 查看当前偏好画像
 * save_preference   — 手动记录/修正偏好（AI 直接写）
 */

import { registerTool }         from '../registry'
import { getPreferences, savePreferences, type Preference, type PreferenceCategory } from '../memory'
import { dateInTZ } from '../time'

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
    description: '记录或更新一条用户偏好。' +
                 '【更新已有偏好时】必须先调用 list_preferences 拿到目标条目的 id，再把 id 传入本工具——' +
                 '这样才能精确覆盖而不是新建。id 匹配优先于 key 匹配；都不匹配才新建。',
    parameters: {
      type:       'object',
      required:   ['key', 'category', 'description', 'confidence'],
      properties: {
        id: {
          type:        'string',
          description: '已有偏好的 id（如 pref_20260414_001）。更新时传入，新建时不填。',
        },
        key: {
          type:        'string',
          description: 'snake_case 标识，如 "prefers_code_first"。更新时与原条目保持一致。',
        },
        category: {
          type:        'string',
          description: '类别：learning / technical / communication / work',
          enum:        ['learning', 'technical', 'communication', 'work'],
        },
        description: {
          type:        'string',
          description: '具体可验证的习惯描述，如"更倾向先看代码再看文档"',
        },
        confidence: {
          type:        'number',
          description: '置信度 0-1。首次观察 0.4~0.55；反复确认 0.7+；极强烈且多次验证才 0.85+',
        },
        counter_evidence: {
          type:        'string',
          description: '如果有矛盾行为，简短描述反例',
        },
        volatility: {
          type:        'string',
          enum:        ['stable', 'moderate', 'volatile'],
          description: '偏好稳定性。临时/当前任务有效用 volatile，不进入常驻记忆。',
        },
        source: {
          type:        'string',
          enum:        ['explicit', 'observed', 'manual', 'extractor'],
          description: '来源：用户明确表达 explicit；观察推断 observed；人工编辑 manual；离线提炼 extractor。',
        },
      },
    },
  },
  async (args) => {
    const prefs = getPreferences()
    const today = dateInTZ()
    const now   = new Date().toISOString()

    // id 匹配优先，其次 key 匹配
    let existingIdx = args.id ? prefs.findIndex(p => p.id === (args.id as string)) : -1
    if (existingIdx === -1) existingIdx = prefs.findIndex(p => p.key === args.key)
    if (existingIdx >= 0) {
      const ex = prefs[existingIdx]
      ex.description     = args.description as string
      ex.confidence      = Math.min(1, Math.max(0, args.confidence as number))
      ex.category        = args.category as PreferenceCategory
      ex.evidence        = [...new Set([...ex.evidence, today])]
      ex.counterEvidence = (args.counter_evidence as string | undefined) ?? ex.counterEvidence
      ex.volatility      = (args.volatility as Preference['volatility'] | undefined) ?? ex.volatility ?? 'moderate'
      ex.source          = (args.source as Preference['source'] | undefined) ?? ex.source ?? 'observed'
      ex.confirmed       = ex.confirmed || args.source === 'explicit'
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
        volatility:      (args.volatility as Preference['volatility'] | undefined) ?? 'moderate',
        source:          (args.source as Preference['source'] | undefined) ?? 'observed',
        confirmed:       args.source === 'explicit',
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
