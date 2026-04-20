/**
 * 誓约管理工具（CRUD + 进度摘要）
 * list_vows    — 列出所有誓约（创建前必须先调用，检测重复）
 * create_vow   — 创建并持久化一个可追踪的誓约
 * update_vow   — 修改誓约任意字段（标题/描述/子目标/截止日/状态）
 * delete_vow   — 删除誓约
 * vow_summary  — 获取活跃誓约的详细进度摘要
 */

import { registerTool }               from '../registry'
import {
  upsertVow, getVows, replaceVows, getActiveVows,
  calcVowStreak, getCumulativePoints, getWeekStart,
} from '../memory'
import type { Vow, VowMetric, VowSubGoal } from '../memory'
import { dateInTZ } from '../time'

// ── 公用 metric 说明 ──────────────────────────────────────────

const METRIC_LABEL: Record<VowMetric, string> = {
  blog_daily:     '每日同步时自动检测博客/文档是否有新增',
  leetcode_daily: '每日同步时自动检测刷题记录是否有新增',
  github_daily:   '每日同步时自动检测 GitHub 是否有新提交',
  any_daily:      '每日同步时自动检测是否有任意活动',
  manual:         '需手动标记完成',
  count_total:    '累计完成次数达到目标（activityType 指定类型）',
  count_weekly:   '每周完成次数达到目标（activityType 指定类型）',
  streak_N:       '连续 N 天不间断（target 指定 N，activityType 指定类型）',
  reach_points:   '修为累计达到目标值',
}

const DAILY_METRICS: VowMetric[] = ['blog_daily', 'leetcode_daily', 'github_daily', 'any_daily']

// ── 进度描述工具函数 ──────────────────────────────────────────

function describeGoalProgress(g: VowSubGoal): string {
  const today = dateInTZ()
  switch (g.metric) {
    case 'blog_daily':
    case 'leetcode_daily':
    case 'github_daily':
    case 'any_daily': {
      const streak  = calcVowStreak(g.completedDates)
      const todayOk = g.completedDates.includes(today)
      return `连续 ${streak} 天　今日：${todayOk ? '✓' : '○'}　累计 ${g.completedDates.length} 日`
    }
    case 'count_total': {
      const cur = g.currentCount ?? 0
      const tgt = g.target ?? '?'
      return `累计 ${cur} / ${tgt}${g.done ? '（已完成）' : ''}`
    }
    case 'count_weekly': {
      const ws    = getWeekStart()
      const cur   = g.weeklyLog?.[ws] ?? 0
      const tgt   = g.target ?? '?'
      return `本周 ${cur} / ${tgt}`
    }
    case 'streak_N': {
      const streak = calcVowStreak(g.completedDates)
      const tgt    = g.target ?? '?'
      return `连续 ${streak} / ${tgt} 天${g.done ? '（已完成）' : ''}`
    }
    case 'reach_points': {
      const cur = getCumulativePoints()
      const tgt = g.target ?? '?'
      return `${cur} / ${tgt} 修为${g.done ? '（已达成）' : ''}`
    }
    case 'manual':
      return g.done ? '已手动完成' : '待手动标记'
  }
}

// ── list_vows ─────────────────────────────────────────────────

registerTool({
  name:        'list_vows',
  description: `列出誓约列表，默认只列 active 状态。
【重要】创建新誓约前必须先调用此工具，检查是否存在语义相似的誓约：
  - 若找到高度相似的誓约，提示用户使用 update_vow 修改现有誓约，而不是新建；
  - 若子目标与现有誓约有重叠，建议合并。`,
  parameters: {
    type: 'object',
    properties: {
      status: {
        type:        'string',
        enum:        ['active', 'fulfilled', 'broken', 'expired', 'paused', 'all'],
        description: '按状态过滤，默认 active',
      },
    },
    required: [],
  },
}, async ({ status = 'active' }) => {
  const all  = getVows()
  const list = (status as string) === 'all' ? all : all.filter(v => v.status === (status as string))
  if (list.length === 0) {
    return { content: '当前无匹配誓约。', brief: '无誓约' }
  }
  const lines = list.map(v => {
    const daysLeft = Math.ceil((new Date(v.deadline).getTime() - Date.now()) / 86400000)
    const goals = v.subGoals.map(g =>
      `  · ${g.description}（${METRIC_LABEL[g.metric]}）\n    → ${describeGoalProgress(g)}`
    ).join('\n')
    const grace = (v.graceCount ?? 0) > 0 ? `　宽限：${v.graceUsed ?? 0}/${v.graceCount}` : ''
    return `[${v.id}] 「${v.title}」截止 ${v.deadline}（${v.status}，剩 ${daysLeft} 天${grace}）${v.motivation ? '\n  动机：' + v.motivation : ''}\n${goals}`
  }).join('\n\n')
  return {
    content: `共 ${list.length} 条：\n\n${lines}`,
    brief:   `${list.length} 条誓约`,
  }
}, { displayName: '列出誓约', domain: 'vow' })

// ── create_vow ────────────────────────────────────────────────

registerTool({
  name:        'create_vow',
  description: `创建一个可追踪的誓约并保存到系统。
⚠️ 调用前必须先调用 list_vows，确认不存在语义相似的誓约。

metric 类型说明：
  blog_daily / leetcode_daily / github_daily / any_daily — 每日自动检测，无需额外参数
  manual           — 手动标记完成
  count_total      — 累计完成次数；需填 target（目标次数）和 activityType（blog/leetcode/github/any）
  count_weekly     — 每周完成次数；需填 target 和 activityType
  streak_N         — 连续 N 天；需填 target（天数）和 activityType
  reach_points     — 修为达到阈值；需填 target（修为值）

创建完成后向用户展示誓约摘要，确认内容无误。`,
  parameters: {
    type: 'object',
    properties: {
      title: {
        type:        'string',
        description: '誓约简短标题，10字以内，如"每日著述"',
      },
      normalized: {
        type:        'string',
        description: '标准化的完整描述，如"每天产出一篇文档，不限内容"',
      },
      deadline: {
        type:        'string',
        description: '截止日期 YYYY-MM-DD',
      },
      motivation: {
        type:        'string',
        description: '立誓动机（可选）',
      },
      tags: {
        type:  'array',
        items: { type: 'string' },
        description: '分类标签（可选），如 ["刷题", "连续打卡"]',
      },
      graceCount: {
        type:        'number',
        description: '允许失败次数（daily 型用，如 2 表示最多可缺席 2 天），默认 0',
      },
      subGoals: {
        type:  'array',
        items: {
          type: 'object',
          properties: {
            description: { type: 'string', description: '子目标描述' },
            metric: {
              type: 'string',
              enum: ['blog_daily', 'leetcode_daily', 'github_daily', 'any_daily', 'manual',
                     'count_total', 'count_weekly', 'streak_N', 'reach_points'],
              description: '完成度检测方式',
            },
            target: {
              type: 'number',
              description: 'count_total/count_weekly/streak_N/reach_points 必填，其他不需要',
            },
            activityType: {
              type: 'string',
              enum: ['blog', 'leetcode', 'github', 'any'],
              description: 'count_total/count_weekly/streak_N 用，指定要追踪哪类活动',
            },
          },
          required: ['description', 'metric'],
        },
        description: '子目标列表，通常 1-3 个',
      },
    },
    required: ['title', 'normalized', 'deadline', 'subGoals'],
  },
}, async ({ title, normalized, deadline, motivation, tags, graceCount, subGoals }) => {
  const vow: Vow = {
    id:         `vow_${Date.now()}`,
    createdAt:  dateInTZ(),
    deadline:   deadline as string,
    raw:        normalized as string,
    normalized: normalized as string,
    title:      title as string,
    motivation: motivation as string | undefined,
    tags:       (tags as string[] | undefined) ?? [],
    graceCount: (graceCount as number | undefined) ?? 0,
    graceUsed:  0,
    subGoals:   (subGoals as { description: string; metric: string; target?: number; activityType?: string }[]).map(g => ({
      description:     g.description,
      metric:          g.metric as VowMetric,
      target:          g.target,
      activityType:    g.activityType as VowSubGoal['activityType'],
      currentCount:    0,
      weeklyLog:       {},
      done:            false,
      completedDates:  [],
    })),
    status: 'active',
  }
  upsertVow(vow)
  const daysLeft  = Math.ceil((new Date(vow.deadline).getTime() - Date.now()) / 86400000)
  const goalLines = vow.subGoals.map(g =>
    `- ${g.description}（${METRIC_LABEL[g.metric]}${g.target ? `，目标：${g.target}` : ''}）`
  ).join('\n')

  return {
    content: `誓约「${vow.title}」已创建（ID: ${vow.id}）。\n截止 ${vow.deadline}，剩余 ${daysLeft} 天。\n\n子目标：\n${goalLines}`,
    brief:   `「${vow.title}」已立，截止 ${vow.deadline}（剩余 ${daysLeft} 天）`,
  }
}, {
  displayName:      '立下誓约',
  domain:           'vow',
  requiresApproval: true,
  approvalSummary:  (args) => `创建誓约「${String(args.title ?? '')}」截止 ${String(args.deadline ?? '')}`,
})

// ── update_vow ────────────────────────────────────────────────

registerTool({
  name:        'update_vow',
  description: `修改现有誓约的任意字段。可用于：
  - 合并重复誓约（把新子目标追加到现有誓约的 subGoals 里）
  - 修改标题、描述、截止日、动机、标签
  - 修改宽限次数
  - 完整替换子目标列表
  - 更新状态（fulfilled/broken/expired/paused/active）
所有字段均为可选，只传需要修改的字段。`,
  parameters: {
    type: 'object',
    properties: {
      vowId:      { type: 'string',  description: '誓约 ID（必填）' },
      title:      { type: 'string',  description: '新标题' },
      normalized: { type: 'string',  description: '新完整描述' },
      deadline:   { type: 'string',  description: '新截止日期 YYYY-MM-DD' },
      motivation: { type: 'string',  description: '立誓动机' },
      tags: {
        type:  'array',
        items: { type: 'string' },
        description: '分类标签',
      },
      graceCount: { type: 'number',  description: '允许失败次数' },
      graceUsed:  { type: 'number',  description: '已用宽限次数（手动调整用）' },
      subGoals: {
        type:  'array',
        items: {
          type: 'object',
          properties: {
            description:  { type: 'string' },
            metric: {
              type: 'string',
              enum: ['blog_daily', 'leetcode_daily', 'github_daily', 'any_daily', 'manual',
                     'count_total', 'count_weekly', 'streak_N', 'reach_points'],
            },
            target:       { type: 'number' },
            activityType: { type: 'string', enum: ['blog', 'leetcode', 'github', 'any'] },
          },
          required: ['description', 'metric'],
        },
        description: '完整替换子目标列表（原有进度数据按 description 匹配保留）',
      },
      status: {
        type: 'string',
        enum: ['active', 'fulfilled', 'broken', 'expired', 'paused'],
        description: '誓约整体状态',
      },
      verdict: { type: 'string', description: '最终评语（fulfilled/broken 时使用）' },
    },
    required: ['vowId'],
  },
}, async ({ vowId, title, normalized, deadline, motivation, tags, graceCount, graceUsed, subGoals, status, verdict }) => {
  const vows = getVows()
  const idx  = vows.findIndex(v => v.id === (vowId as string))
  if (idx < 0) return { content: '誓约不存在，请先调用 list_vows 确认 ID。', brief: '未找到' }

  const vow = { ...vows[idx], subGoals: [...vows[idx].subGoals] }
  if (title      !== undefined) vow.title      = title as string
  if (normalized !== undefined) vow.normalized = normalized as string
  if (deadline   !== undefined) vow.deadline   = deadline as string
  if (motivation !== undefined) vow.motivation = motivation as string
  if (tags       !== undefined) vow.tags       = tags as string[]
  if (graceCount !== undefined) vow.graceCount = graceCount as number
  if (graceUsed  !== undefined) vow.graceUsed  = graceUsed as number
  if (status     !== undefined) vow.status     = status as Vow['status']
  if (verdict    !== undefined) vow.verdict    = verdict as string

  if (subGoals) {
    const oldMap = new Map(vow.subGoals.map(g => [g.description, g]))
    vow.subGoals = (subGoals as { description: string; metric: string; target?: number; activityType?: string }[]).map(g => {
      const existing = oldMap.get(g.description)
      return {
        description:     g.description,
        metric:          g.metric as VowMetric,
        target:          g.target ?? existing?.target,
        activityType:    (g.activityType ?? existing?.activityType) as VowSubGoal['activityType'],
        currentCount:    existing?.currentCount    ?? 0,
        weeklyLog:       existing?.weeklyLog       ?? {},
        lastCountedDate: existing?.lastCountedDate,
        done:            existing?.done            ?? false,
        completedDates:  existing?.completedDates  ?? [],
      }
    })
  }

  vows[idx] = vow
  replaceVows(vows)
  const goalLines = vow.subGoals.map(g =>
    `- ${g.description}（${METRIC_LABEL[g.metric]}）\n  → ${describeGoalProgress(g)}`
  ).join('\n')
  return {
    content: `誓约「${vow.title}」已更新（ID: ${vow.id}）。\n截止 ${vow.deadline}，状态 ${vow.status}。\n\n子目标：\n${goalLines}`,
    brief:   `「${vow.title}」已更新`,
  }
}, { displayName: '修改誓约', domain: 'vow' })

// ── delete_vow ────────────────────────────────────────────────

registerTool({
  name:        'delete_vow',
  description: '永久删除一条誓约。删除前先向用户确认。',
  parameters: {
    type: 'object',
    properties: {
      vowId: { type: 'string', description: '誓约 ID' },
    },
    required: ['vowId'],
  },
}, async ({ vowId }) => {
  const vows    = getVows()
  const idx     = vows.findIndex(v => v.id === (vowId as string))
  if (idx < 0)  return { content: '誓约不存在', brief: '未找到' }
  const [removed] = vows.splice(idx, 1)
  replaceVows(vows)
  return {
    content: `誓约「${removed.title}」（ID: ${removed.id}）已删除。`,
    brief:   `「${removed.title}」已删除`,
  }
}, {
  displayName:      '删除誓约',
  domain:           'vow',
  requiresApproval: true,
  approvalSummary:  (args) => `删除誓约（ID: ${String(args.vowId ?? '')}）`,
})

// ── vow_summary ───────────────────────────────────────────────

registerTool({
  name:        'vow_summary',
  description: `获取所有活跃誓约的详细进度摘要。
包含每个子目标的当前计数、今日完成状态、连续天数、距目标差距等。
调用时机：
- 用户问"誓约进度怎么样""距离目标还差多少"
- 需要给出具体数据支撑的誓约分析`,
  parameters: { type: 'object', properties: {}, required: [] },
}, async () => {
  const vows = getActiveVows()
  if (vows.length === 0) return { content: '当前无活跃誓约。', brief: '无活跃誓约' }

  const today = dateInTZ()
  const lines = vows.map(v => {
    const daysLeft  = Math.ceil((new Date(v.deadline).getTime() - Date.now()) / 86400000)
    const grace     = (v.graceCount ?? 0) > 0 ? `　宽限：${v.graceUsed ?? 0}/${v.graceCount}` : ''
    const goalLines = v.subGoals.map(g => {
      const progress = describeGoalProgress(g)
      const isDailyMet = DAILY_METRICS.includes(g.metric) && g.completedDates.includes(today)
      const tag = isDailyMet ? '✓' : (DAILY_METRICS.includes(g.metric) ? '○' : '')
      return `  · ${g.description} ${tag}\n    ${progress}`
    }).join('\n')
    return `「${v.title}」截止 ${v.deadline}（剩 ${daysLeft} 天${grace}）\n${goalLines}`
  }).join('\n\n')

  return {
    content: `活跃誓约 ${vows.length} 条：\n\n${lines}`,
    brief:   `${vows.length} 条活跃誓约进度`,
  }
}, { displayName: '查看誓约进度', domain: 'vow' })
