import {
  getActiveVows,
  getBlogPostsCache,
  getPreferences,
  getRecentDailyLogs,
  getRecentSummaries,
  getSkills,
  getWeeklyPatterns,
} from './memory'
import { listContextRuns } from './context-audit'
import { clampSummary } from './memory-pack'

export type KnowledgeNodeType =
  | 'blog'
  | 'skill'
  | 'preference'
  | 'conversation_summary'
  | 'daily_log'
  | 'weekly_pattern'
  | 'vow'
  | 'context_run'

export interface KnowledgeNode {
  id: string
  type: KnowledgeNodeType
  title: string
  summary: string
  date?: string
  tags: string[]
  source: string
  weight: number
}

export interface KnowledgeEdge {
  id: string
  from: string
  to: string
  type: 'derived_from' | 'mentions' | 'supports' | 'related' | 'used_in_context' | 'same_topic' | 'updates'
  label: string
  confidence: number
}

export interface KnowledgeGraph {
  generatedAt: string
  nodes: KnowledgeNode[]
  edges: KnowledgeEdge[]
}

function words(text: string): Set<string> {
  return new Set(text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(token => token.length >= 2))
}

function overlap(a: string[], b: string[]) {
  const left = new Set(a.map(item => item.toLowerCase()))
  return b.some(item => left.has(item.toLowerCase()))
}

function dailyLogSummary(log: ReturnType<typeof getRecentDailyLogs>[number]) {
  if (log.activities.length === 0) return `无修炼；连续第 ${log.streakDay} 日；总 +${log.totalPoints}`
  const parts = log.activities.map(activity => {
    const label = { blog: '著述', leetcode: '铸剑', github: '声望' }[activity.type] ?? activity.type
    const detail = activity.titles?.length ? `（${activity.titles.join('、')}）` : ''
    return `${label}×${activity.count}${detail} +${activity.points}`
  })
  return `${parts.join('；')}；连续第 ${log.streakDay} 日；总 +${log.totalPoints}`
}

export function buildKnowledgeGraph(): KnowledgeGraph {
  const nodes: KnowledgeNode[] = []
  const edges: KnowledgeEdge[] = []

  for (const post of getBlogPostsCache()) {
    nodes.push({
      id: `blog:${post.slug}`,
      type: 'blog',
      title: post.title,
      summary: clampSummary(post.excerpt || post.content || '无摘要', 260),
      date: post.publishedAt.slice(0, 10),
      tags: [...(post.tags ?? []), post.category].filter(Boolean),
      source: `/blog/${post.slug}`,
      weight: Math.max(1, Math.min(10, Math.round((post.wordCount ?? 1000) / 500))),
    })
  }

  for (const skill of getSkills()) {
    nodes.push({
      id: `skill:${skill.id}`,
      type: 'skill',
      title: skill.title,
      summary: clampSummary(skill.insight || skill.body || '无摘要', 260),
      date: skill.sourceDate,
      tags: skill.tags,
      source: `content/spirit/skills/index.json#${skill.id}`,
      weight: 4 + Math.min(skill.useCount ?? 0, 6),
    })
  }

  for (const pref of getPreferences()) {
    nodes.push({
      id: `preference:${pref.id}`,
      type: 'preference',
      title: pref.key,
      summary: pref.description,
      date: pref.lastSeen,
      tags: [pref.category, pref.source ?? 'observed'],
      source: `content/spirit/preferences.json#${pref.id}`,
      weight: Math.max(1, Math.round(pref.confidence * 10)),
    })
  }

  for (const summary of getRecentSummaries(90)) {
    nodes.push({
      id: `summary:${summary.date}`,
      type: 'conversation_summary',
      title: summary.topics.length ? summary.topics.join('、') : `${summary.date} 对话摘要`,
      summary: summary.summary,
      date: summary.date,
      tags: summary.topics,
      source: `content/spirit/summaries/${summary.date}.json`,
      weight: 3,
    })
  }

  for (const log of getRecentDailyLogs(90)) {
    nodes.push({
      id: `daily_log:${log.date}`,
      type: 'daily_log',
      title: `${log.date} 修炼日志`,
      summary: dailyLogSummary(log),
      date: log.date,
      tags: log.activities.map(activity => activity.type),
      source: `content/spirit/logs/${log.date}.json`,
      weight: Math.max(1, Math.min(10, log.totalPoints)),
    })
  }

  for (const pattern of getWeeklyPatterns(12)) {
    nodes.push({
      id: `weekly_pattern:${pattern.weekStart}`,
      type: 'weekly_pattern',
      title: `${pattern.weekStart} 周规律`,
      summary: `${pattern.narrative}${pattern.flags.length ? ` 隐患：${pattern.flags.join('、')}` : ''}`,
      date: pattern.weekStart,
      tags: pattern.flags,
      source: `content/spirit/patterns/${pattern.weekStart}.json`,
      weight: 5,
    })
  }

  for (const vow of getActiveVows()) {
    nodes.push({
      id: `vow:${vow.id}`,
      type: 'vow',
      title: vow.title,
      summary: vow.subGoals.map(goal => `${goal.description}：${goal.done ? '已完成' : '未完成'}`).join('；') || vow.normalized,
      date: vow.deadline,
      tags: vow.tags ?? [],
      source: `content/spirit/vows.json#${vow.id}`,
      weight: 7,
    })
  }

  for (const run of listContextRuns(100)) {
    nodes.push({
      id: `context_run:${run.id}`,
      type: 'context_run',
      title: clampSummary(run.userMessage, 36),
      summary: clampSummary(run.finalAnswerPreview || '无回答预览', 220),
      date: run.date,
      tags: run.domains,
      source: `/spirit/knowledge?id=${run.id}`,
      weight: 2 + Math.min(run.prefetchedCount + run.toolCount, 8),
    })
  }

  const byId = new Map(nodes.map(node => [node.id, node]))
  const nodeList = Array.from(byId.values())
  for (const left of nodeList) {
    for (const right of nodeList) {
      if (left.id >= right.id) continue
      let confidence = 0
      let label = ''
      if (left.date && right.date && left.date === right.date) {
        confidence = 0.7
        label = '同日'
      } else if (overlap(left.tags, right.tags)) {
        confidence = 0.62
        label = '同标签'
      } else {
        const a = words(`${left.title} ${left.summary}`)
        const b = words(`${right.title} ${right.summary}`)
        const shared = Array.from(a).filter(token => b.has(token)).length
        if (shared >= 3) {
          confidence = Math.min(0.55 + shared * 0.03, 0.85)
          label = '语义近邻'
        }
      }
      if (confidence > 0) {
        edges.push({
          id: `${left.id}->${right.id}`,
          from: left.id,
          to: right.id,
          type: label === '同日' ? 'related' : 'same_topic',
          label,
          confidence,
        })
      }
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    nodes: nodeList.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || b.weight - a.weight),
    edges: edges.sort((a, b) => b.confidence - a.confidence).slice(0, 300),
  }
}

export function filterKnowledgeGraph(graph: KnowledgeGraph, input: {
  type?: KnowledgeNodeType
  q?: string
  limit?: number
}): KnowledgeGraph {
  const query = input.q?.trim().toLowerCase()
  const limit = Math.max(1, Math.min(input.limit ?? 120, 300))
  const nodes = graph.nodes
    .filter(node => !input.type || node.type === input.type)
    .filter(node => !query || `${node.title} ${node.summary} ${node.tags.join(' ')}`.toLowerCase().includes(query))
    .slice(0, limit)
  const ids = new Set(nodes.map(node => node.id))
  return {
    ...graph,
    nodes,
    edges: graph.edges.filter(edge => ids.has(edge.from) && ids.has(edge.to)),
  }
}
