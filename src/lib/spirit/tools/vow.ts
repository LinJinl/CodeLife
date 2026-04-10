/**
 * 誓约管理工具（CRUD）
 * list_vows    — 列出所有誓约（创建前必须先调用，检测重复）
 * create_vow   — 创建并持久化一个可追踪的誓约
 * update_vow   — 修改誓约任意字段（标题/描述/子目标/截止日/状态）
 * delete_vow   — 删除誓约
 */

import { registerTool }               from '../registry'
import { upsertVow, getVows, saveVows } from '../memory'
import type { Vow, VowMetric } from '../memory'

// ── 公用 metric 说明 ──────────────────────────────────────────

const METRIC_LABEL: Record<string, string> = {
  blog_daily:     '每日同步时自动检测博客/文档是否有新增',
  leetcode_daily: '每日同步时自动检测刷题记录是否有新增',
  github_daily:   '每日同步时自动检测 GitHub 是否有新提交',
  any_daily:      '每日同步时自动检测是否有任意活动',
  manual:         '需手动标记完成',
}

// ── list_vows ─────────────────────────────────────────────────

registerTool({
  name:        'list_vows',
  description: `列出所有誓约。
【重要】创建新誓约前必须先调用此工具，检查是否存在语义相似的誓约：
  - 若找到高度相似的誓约，提示用户使用 update_vow 修改现有誓约，而不是新建；
  - 若子目标与现有誓约有重叠，建议合并，询问用户确认后再执行。`,
  parameters: {
    type: 'object',
    properties: {
      status: {
        type:        'string',
        enum:        ['active', 'fulfilled', 'broken', 'expired', 'all'],
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
    const goals = v.subGoals.map(g =>
      `  · ${g.description}（${METRIC_LABEL[g.metric] ?? g.metric}，已完成 ${g.completedDates.length} 日）`
    ).join('\n')
    return `[${v.id}] 「${v.title}」截止 ${v.deadline}（${v.status}）\n${goals}`
  }).join('\n\n')
  return {
    content: `共 ${list.length} 条：\n\n${lines}`,
    brief:   `${list.length} 条誓约`,
  }
}, { displayName: '列出誓约' })

// ── create_vow ────────────────────────────────────────────────

registerTool({
  name:        'create_vow',
  description: `创建一个可追踪的誓约并保存到系统。
⚠️ 调用前必须先调用 list_vows，确认不存在语义相似的誓约。
metric 必须选择系统能自动检测的类型：
  blog_daily     — 每日产出博客/文档（系统自动检测）
  leetcode_daily — 每日刷题（系统自动检测）
  github_daily   — 每日提交代码（系统自动检测）
  any_daily      — 每日任意活动（系统自动检测）
  manual         — 需手动标记完成

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
      subGoals: {
        type:  'array',
        items: {
          type: 'object',
          properties: {
            description: { type: 'string', description: '子目标描述' },
            metric: {
              type: 'string',
              enum: ['blog_daily', 'leetcode_daily', 'github_daily', 'any_daily', 'manual'],
              description: '完成度检测方式',
            },
          },
          required: ['description', 'metric'],
        },
        description: '子目标列表，通常 1-3 个',
      },
    },
    required: ['title', 'normalized', 'deadline', 'subGoals'],
  },
}, async ({ title, normalized, deadline, subGoals }) => {
  const vow: Vow = {
    id:         `vow_${Date.now()}`,
    createdAt:  new Date().toISOString().slice(0, 10),
    deadline:   deadline as string,
    raw:        normalized as string,
    normalized: normalized as string,
    title:      title as string,
    subGoals:   (subGoals as { description: string; metric: string }[]).map(g => ({
      description:    g.description,
      metric:         g.metric as VowMetric,
      done:           false,
      completedDates: [],
    })),
    status: 'active',
  }
  upsertVow(vow)
  const daysLeft = Math.ceil((new Date(vow.deadline).getTime() - Date.now()) / 86400000)
  const goalLines = vow.subGoals.map(g =>
    `- ${g.description}（完成判定：${METRIC_LABEL[g.metric] ?? g.metric}，无需手动操作）`
  ).join('\n')

  return {
    content: `誓约「${vow.title}」已创建（ID: ${vow.id}）。\n截止 ${vow.deadline}，剩余 ${daysLeft} 天。\n\n子目标：\n${goalLines}\n\n系统每次触发同步时会自动比对当日数据，用户无需调用任何工具来标记完成。`,
    brief:   `「${vow.title}」已立，截止 ${vow.deadline}（剩余 ${daysLeft} 天）`,
  }
}, {
  displayName:      '立下誓约',
  requiresApproval: true,
  approvalSummary:  (args) => `创建誓约「${String(args.title ?? '')}」截止 ${String(args.deadline ?? '')}`,
})

// ── update_vow ────────────────────────────────────────────────

registerTool({
  name:        'update_vow',
  description: `修改现有誓约的任意字段。可用于：
  - 合并重复誓约（把新子目标追加到现有誓约的 subGoals 里）
  - 修改标题、描述、截止日
  - 完整替换子目标列表
  - 更新状态（fulfilled/broken/expired）
所有字段均为可选，只传需要修改的字段。`,
  parameters: {
    type: 'object',
    properties: {
      vowId:      { type: 'string', description: '誓约 ID（必填）' },
      title:      { type: 'string', description: '新标题' },
      normalized: { type: 'string', description: '新完整描述' },
      deadline:   { type: 'string', description: '新截止日期 YYYY-MM-DD' },
      subGoals: {
        type:  'array',
        items: {
          type: 'object',
          properties: {
            description: { type: 'string' },
            metric: {
              type: 'string',
              enum: ['blog_daily', 'leetcode_daily', 'github_daily', 'any_daily', 'manual'],
            },
          },
          required: ['description', 'metric'],
        },
        description: '完整替换子目标列表（原有 completedDates 数据保留，按 description 匹配）',
      },
      status: {
        type: 'string',
        enum: ['active', 'fulfilled', 'broken', 'expired'],
        description: '誓约整体状态',
      },
      verdict: { type: 'string', description: '最终评语（fulfilled/broken 时使用）' },
    },
    required: ['vowId'],
  },
}, async ({ vowId, title, normalized, deadline, subGoals, status, verdict }) => {
  const vows = getVows()
  const idx  = vows.findIndex(v => v.id === (vowId as string))
  if (idx < 0) return { content: '誓约不存在，请先调用 list_vows 确认 ID。', brief: '未找到' }

  const vow = { ...vows[idx], subGoals: [...vows[idx].subGoals] }
  if (title)      vow.title      = title as string
  if (normalized) vow.normalized = normalized as string
  if (deadline)   vow.deadline   = deadline as string
  if (status)     vow.status     = status as Vow['status']
  if (verdict)    vow.verdict    = verdict as string

  if (subGoals) {
    // 按 description 匹配，保留已有的 completedDates
    const oldMap = new Map(vow.subGoals.map(g => [g.description, g]))
    vow.subGoals = (subGoals as { description: string; metric: string }[]).map(g => {
      const existing = oldMap.get(g.description)
      return {
        description:    g.description,
        metric:         g.metric as VowMetric,
        done:           existing?.done ?? false,
        completedDates: existing?.completedDates ?? [],
      }
    })
  }

  vows[idx] = vow
  saveVows(vows)
  const goalLines = vow.subGoals.map(g =>
    `- ${g.description}（${METRIC_LABEL[g.metric] ?? g.metric}，已完成 ${g.completedDates.length} 日）`
  ).join('\n')
  return {
    content: `誓约「${vow.title}」已更新（ID: ${vow.id}）。\n截止 ${vow.deadline}，状态 ${vow.status}。\n\n子目标：\n${goalLines}`,
    brief:   `「${vow.title}」已更新`,
  }
}, { displayName: '修改誓约' })

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
  saveVows(vows)
  return {
    content: `誓约「${removed.title}」（ID: ${removed.id}）已删除。`,
    brief:   `「${removed.title}」已删除`,
  }
}, {
  displayName:      '删除誓约',
  requiresApproval: true,
  approvalSummary:  (args) => `删除誓约（ID: ${String(args.vowId ?? '')}）`,
})
