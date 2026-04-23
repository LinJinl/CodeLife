/**
 * Tier 2 记忆读取工具（Issue 1）
 *
 * 历史数据从 system prompt 中移除，改为 AI 按需主动拉取：
 *   get_daily_logs       — 最近 N 天修炼日志详情
 *   get_weekly_patterns  — 近期周规律叙事 + 隐患标记
 *   get_skill_cards      — 从历史对话提炼的可复用能力卡
 */

import { registerTool }       from '../registry'
import {
  getRecentDailyLogs,
  getWeeklyPatterns,
  getSkills,
}                             from '../memory'
import { clampSummary, formatMemoryPack, type MemoryPackItem } from '../memory-pack'
import { formatSkillForMemory } from '../skill-format'
import fs from 'fs'
import path from 'path'

// ── get_daily_logs ────────────────────────────────────────────

registerTool({
  name: 'get_daily_logs',
  description: `获取最近 N 天的修炼日志（博客著述 / LeetCode 铸剑 / GitHub 声望活动详情）。

使用时机：
- 用户询问具体某天或某段时间的修炼情况
- 需要数据支撑才能给出分析或建议
- 系统提示中只有今日摘要，详细历史数据通过此工具按需获取`,
  parameters: {
    type: 'object',
    properties: {
      days: { type: 'number', description: '查询天数（默认 7，最多 30）' },
    },
    required: [],
  },
}, async ({ days = 7 }) => {
  const logs = getRecentDailyLogs(Math.min((days as number) || 7, 30))
  if (logs.length === 0) return { content: '暂无记录', brief: '无日志' }

  const items: MemoryPackItem[] = logs.map(log => {
    if (log.activities.length === 0) {
      return {
        type: 'daily_log',
        id: `daily_log:${log.date}`,
        date: log.date,
        summary: `无修炼；连续第 ${log.streakDay} 日；总 +${log.totalPoints}`,
        confidence: 1,
      }
    }
    const parts = log.activities.map(a => {
      const label  = { blog: '著述', leetcode: '铸剑', github: '声望' }[a.type] ?? a.type
      const detail = a.titles?.length ? `（${a.titles.join('、')}）` : ''
      return `${label}×${a.count}${detail} +${a.points}修为`
    })
    return {
      type: 'daily_log',
      id: `daily_log:${log.date}`,
      date: log.date,
      summary: `${parts.join('；')}；连续第 ${log.streakDay} 日；总 +${log.totalPoints}`,
      confidence: 1,
    }
  })
  return {
    content: formatMemoryPack(items, '修炼日志'),
    brief:   `近 ${logs.length} 天日志`,
  }
}, { displayName: '读取修炼日志', domain: 'memory' })

// ── get_weekly_patterns ───────────────────────────────────────

registerTool({
  name: 'get_weekly_patterns',
  description: `获取近 N 周的规律分析（AI 生成的叙事摘要 + 隐患标记）。

使用时机：
- 用户问"我最近的规律""有什么问题""状态怎么样"等宏观问题
- 需要了解中长期趋势而非具体某天数据`,
  parameters: {
    type: 'object',
    properties: {
      weeks: { type: 'number', description: '查询周数（默认 4）' },
    },
    required: [],
  },
}, async ({ weeks = 4 }) => {
  const patterns = getWeeklyPatterns((weeks as number) || 4)
  if (patterns.length === 0) return { content: '暂无周期记录', brief: '无规律' }

  const items: MemoryPackItem[] = patterns.map(p => ({
    type: 'weekly_pattern',
    id: `weekly_pattern:${p.weekStart}`,
    date: p.weekStart,
    title: `${p.weekStart} 周规律`,
    summary: `${p.narrative}${p.flags.length ? ` 隐患：${p.flags.join('、')}` : ''}`,
    confidence: 0.8,
  }))
  return {
    content: formatMemoryPack(items, '周规律'),
    brief:   `近 ${patterns.length} 周规律`,
  }
}, { displayName: '读取周规律', domain: 'memory' })

// ── get_skill_cards ───────────────────────────────────────────

registerTool({
  name: 'get_skill_cards',
  description: `获取从历史对话中提炼的可复用能力卡。

使用时机：
- 用户问"我之前学了什么""有哪些洞察""之前总结过什么"
- 需要了解用户积累的知识点`,
  parameters: { type: 'object', properties: {}, required: [] },
}, async () => {
  const skills = getSkills()
  if (skills.length === 0) return { content: '暂无技能卡', brief: '无技能卡' }

  const recent = skills.slice(-30)  // 最近 30 张
  const items: MemoryPackItem[] = recent.map(s => ({
    type: 'skill',
    id: s.id,
    date: s.sourceDate,
    title: s.title,
    summary: formatSkillForMemory(s),
    source: s.sourceDate,
    confidence: 0.75,
  }))
  return {
    content: formatMemoryPack(items, '技能卡'),
    brief:   `共 ${skills.length} 张技能卡`,
  }
}, { displayName: '读取技能卡', domain: 'memory' })

// ── search_notes ─────────────────────────────────────────────

const NOTES_DIR = path.resolve(process.cwd(), 'content/spirit/notes')

registerTool({
  name:        'search_notes',
  description: '检索随手记 write_note 写入的历史笔记。用于用户问“之前帮我记了什么”“查一下笔记里关于 X 的内容”。',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '检索关键词，可选；不填则返回最近笔记' },
      limit: { type: 'number', description: '返回条数，默认 8' },
    },
  },
}, async ({ query, limit = 8 }) => {
  if (!fs.existsSync(NOTES_DIR)) return { content: '暂无笔记', brief: '无笔记' }
  const files = fs.readdirSync(NOTES_DIR)
    .filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
    .sort()
    .reverse()

  const entries: { date: string; text: string }[] = []
  for (const file of files) {
    const date = file.replace('.md', '')
    const text = fs.readFileSync(path.join(NOTES_DIR, file), 'utf-8')
    for (const block of text.split(/\n(?=## )/).filter(Boolean)) {
      entries.push({ date, text: block.trim() })
    }
  }

  const q = typeof query === 'string' ? query.trim().toLowerCase() : ''
  const filtered = q
    ? entries.filter(e => e.text.toLowerCase().includes(q))
    : entries
  const result = filtered.slice(0, Math.min(Number(limit), 20))

  if (result.length === 0) return { content: `未找到与「${query}」相关的笔记`, brief: '无匹配' }
  const items: MemoryPackItem[] = result.map((e, idx) => ({
    type: 'note',
    id: `note:${e.date}:${idx}`,
    date: e.date,
    summary: clampSummary(e.text, 520),
    source: `content/spirit/notes/${e.date}.md`,
    confidence: 0.9,
  }))
  return {
    content: formatMemoryPack(items, '随手记'),
    brief:   `找到 ${result.length} 条笔记`,
  }
}, { displayName: '检索笔记', domain: 'memory' })
