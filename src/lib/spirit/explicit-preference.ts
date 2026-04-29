import { createHash } from 'crypto'
import {
  getPreferences,
  savePreferences,
  type Preference,
  type PreferenceCategory,
} from './memory'
import { dateInTZ } from './time'

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function makeKey(category: PreferenceCategory, description: string): string {
  const hash = createHash('sha1').update(description).digest('hex').slice(0, 10)
  return `explicit_${category}_${hash}`
}

function inferCategory(text: string): PreferenceCategory {
  if (/代码|TypeScript|JavaScript|React|Next|函数式|class|类型|架构|技术|实现/.test(text)) return 'technical'
  if (/学习|文档|例子|案例|教程|理解|复习|练习/.test(text)) return 'learning'
  if (/时间|早上|晚上|深夜|节奏|工作|任务|计划|截止|日程/.test(text)) return 'work'
  return 'communication'
}

function isExplicitPreference(text: string): boolean {
  if (/取消|不要执行该命令|确认请求失败|已确认|批准令牌/.test(text)) return false
  const hasLongTermSignal = /记住|以后|今后|之后都|下次.*(都|开始)|长期|我的偏好|我偏好|我喜欢|我不喜欢|以后.*回答|以后.*回复|以后.*别|以后.*不要|今后.*不要|今后.*回答/.test(text)
  const hasPreferenceObject = /回答|回复|表达|说话|风格|语气|格式|分段|废话|结论|解释|代码|技术|学习|文档|例子|工作|时间|偏好|喜欢|不喜欢/.test(text)
  return hasLongTermSignal && hasPreferenceObject
}

function preferenceDescription(content: string): string {
  const cleaned = content
    .replace(/^(请|麻烦|帮我)?(记住|以后|今后|之后|下次)\s*[，,:：]?\s*/u, '')
    .replace(/^我的偏好(是|：|:)?\s*/u, '')
    .trim()
  const body = cleaned || content
  return body.length > 120
    ? `用户明确长期偏好：${body.slice(0, 117)}...`
    : `用户明确长期偏好：${body}`
}

export interface ExplicitPreferenceResult {
  saved: boolean
  key?: string
  description?: string
}

export function saveExplicitPreferenceFromText(text: string): ExplicitPreferenceResult {
  const content = normalize(text)
  if (!content || !isExplicitPreference(content)) return { saved: false }

  const category = inferCategory(content)
  const description = preferenceDescription(content)
  const key = makeKey(category, description)
  const prefs = getPreferences()
  const today = dateInTZ()
  const now = new Date().toISOString()
  const existingIdx = prefs.findIndex(pref => pref.key === key)

  if (existingIdx >= 0) {
    const pref = prefs[existingIdx]
    pref.description = description
    pref.category = category
    pref.confidence = Math.max(pref.confidence, 0.8)
    pref.evidence = [...new Set([...pref.evidence, today])]
    pref.volatility = pref.volatility ?? 'moderate'
    pref.source = 'explicit'
    pref.confirmed = true
    pref.lastSeen = today
    pref.updatedAt = now
  } else {
    const newId = `pref_${today.replace(/-/g, '')}_${String(prefs.length + 1).padStart(3, '0')}`
    prefs.push({
      id: newId,
      category,
      key,
      description,
      confidence: 0.8,
      evidence: [today],
      volatility: 'moderate',
      source: 'explicit',
      confirmed: true,
      lastSeen: today,
      updatedAt: now,
    } satisfies Preference)
  }

  savePreferences(prefs)
  return { saved: true, key, description }
}
