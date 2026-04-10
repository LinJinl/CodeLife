/**
 * Tier 2 记忆读取工具（Issue 1）
 *
 * 历史数据从 system prompt 中移除，改为 AI 按需主动拉取：
 *   get_daily_logs       — 最近 N 天修炼日志详情
 *   get_weekly_patterns  — 近期周规律叙事 + 隐患标记
 *   get_skill_cards      — 从历史对话提炼的技术洞察卡片
 */

import { registerTool }       from '../registry'
import {
  getRecentDailyLogs,
  getWeeklyPatterns,
  getSkills,
}                             from '../memory'

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

  const lines = logs.map(log => {
    if (log.activities.length === 0) return `${log.date}：无修炼`
    const parts = log.activities.map(a => {
      const label  = { blog: '著述', leetcode: '铸剑', github: '声望' }[a.type] ?? a.type
      const detail = a.titles?.length ? `（${a.titles.join('、')}）` : ''
      return `${label}×${a.count}${detail} +${a.points}修为`
    })
    return `${log.date}：${parts.join('　')}　第${log.streakDay}日　总 +${log.totalPoints}`
  })
  return {
    content: lines.join('\n'),
    brief:   `近 ${logs.length} 天日志`,
  }
}, { displayName: '读取修炼日志' })

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

  const lines = patterns.map(p => {
    const flags = p.flags.length ? `\n  隐患：${p.flags.join('、')}` : ''
    return `[${p.weekStart}周] ${p.narrative}${flags}`
  })
  return {
    content: `BRIEF::近 ${patterns.length} 周规律\n${lines.join('\n\n')}`,
    brief:   `近 ${patterns.length} 周规律`,
  }
}, { displayName: '读取周规律' })

// ── get_skill_cards ───────────────────────────────────────────

registerTool({
  name: 'get_skill_cards',
  description: `获取从历史对话中提炼的技术洞察卡片。

使用时机：
- 用户问"我之前学了什么""有哪些洞察""之前总结过什么"
- 需要了解用户积累的知识点`,
  parameters: { type: 'object', properties: {}, required: [] },
}, async () => {
  const skills = getSkills()
  if (skills.length === 0) return { content: '暂无技能卡', brief: '无技能卡' }

  const recent = skills.slice(-30)  // 最近 30 张
  const lines  = recent.map(s =>
    `【${s.title}】${s.insight}（来源：${s.sourceDate}）`
  )
  return {
    content: `BRIEF::共 ${skills.length} 张技能卡\n${lines.join('\n\n')}`,
    brief:   `共 ${skills.length} 张技能卡`,
  }
}, { displayName: '读取技能卡' })
