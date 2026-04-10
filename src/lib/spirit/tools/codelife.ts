/**
 * CodeLife 数据工具：让器灵能直接查阅博客、刷题、GitHub 数据、对话历史
 */

import { registerTool }        from '../registry'
import config                  from '../../../../codelife.config'
import { createBlogAdapter }   from '../../adapters/blog'
import { createLeetcodeAdapter } from '../../adapters/leetcode'
import { getConversation, getRecentConversations } from '../memory'

registerTool({
  name:        'read_user_blogs',
  description: '读取用户已发布的博客文章列表，含标题、分类、字数、发布日期。用于分析写作习惯、回答"我写过什么"之类的问题。',
  parameters: {
    type: 'object',
    properties: {
      limit:    { type: 'number', description: '返回数量，默认 20' },
      category: { type: 'string', description: '按分类过滤（可选）' },
    },
    required: [],
  },
}, async ({ limit = 20, category }) => {
  const adapter = createBlogAdapter(config.blog, config.cultivation)
  const posts   = await adapter.getPosts()
  const filtered = category
    ? posts.filter(p => p.category === (category as string))
    : posts
  const result = filtered.slice(0, limit as number).map(p => ({
    title:       p.title,
    category:    p.category,
    tags:        p.tags,
    wordCount:   p.wordCount,
    publishedAt: typeof p.publishedAt === 'string' ? p.publishedAt : (p.publishedAt as Date).toISOString(),
    pointsEarned: p.pointsEarned,
  }))
  return {
    content: JSON.stringify(result),
    brief:   `共 ${posts.length} 篇，返回 ${result.length} 篇`,
  }
}, { displayName: '读取博客记录' })

registerTool({
  name:        'read_leetcode_records',
  description: '读取用户的 LeetCode 刷题记录，含题目、难度、解题日期。用于分析刷题习惯、推荐下一题、回答"我刷了哪些题"。',
  parameters: {
    type: 'object',
    properties: {
      difficulty: { type: 'string', enum: ['easy', 'medium', 'hard'], description: '难度过滤（可选）' },
      limit:      { type: 'number', description: '返回数量，默认 30' },
    },
    required: [],
  },
}, async ({ difficulty, limit = 30 }) => {
  if (!config.leetcode.enabled) return { content: 'LeetCode 未启用', brief: '未启用' }
  const adapter  = createLeetcodeAdapter(config.leetcode, config.cultivation)
  const problems = await adapter.getProblems()
  const filtered = difficulty
    ? problems.filter(p => p.difficulty === (difficulty as string))
    : problems
  const result = filtered.slice(0, limit as number).map(p => ({
    title:      p.title,
    difficulty: p.difficulty,
    solvedAt:   typeof p.solvedAt === 'string' ? p.solvedAt : (p.solvedAt as Date).toISOString(),
    language:   p.language,
  }))
  return {
    content: JSON.stringify(result),
    brief:   `共 ${problems.length} 题，返回 ${result.length} 题`,
  }
}, { displayName: '读取刷题记录' })

registerTool({
  name:        'read_cultivation_stats',
  description: '读取用户的修为总览：境界、各模块积分、连续打卡天数。用于回答"我的修为进度"之类的问题。',
  parameters: { type: 'object', properties: {}, required: [] },
}, async () => {
  const { getRealmStatus } = await import('../../cultivation/realm')
  const { getRecentDailyLogs, getPersona, getActiveVows } = await import('../memory')

  const persona  = getPersona()
  const logs     = getRecentDailyLogs(30)
  const vows     = getActiveVows()
  const total    = logs.reduce((s, l) => s + l.totalPoints, 0)
  const realm    = getRealmStatus(total, config.realms)

  return {
    content: JSON.stringify({ realm, totalPoints: total, persona, activeVows: vows, recentDays: logs.length }),
    brief:   `${realm.name} ${realm.stage}，近30日 ${total} 修为`,
  }
}, { displayName: '读取修为数据' })

registerTool({
  name:        'search_conversations',
  description: '查询历史对话记录。可以按日期查某天的完整对话，也可以用关键词在近期对话中全文搜索。用于回答"我们上次说了什么""上周我提到过什么问题"之类的问题。',
  parameters: {
    type: 'object',
    properties: {
      date:  {
        type:        'string',
        description: '查询指定日期的对话（YYYY-MM-DD），与 query 互斥；若两者都填则优先按日期查',
      },
      query: {
        type:        'string',
        description: '关键词，在近期对话中全文搜索（不区分大小写）',
      },
      days: {
        type:        'number',
        description: '搜索最近多少天的记录，默认 14，最大 60',
      },
    },
    required: [],
  },
}, async ({ date, query, days = 14 }) => {
  // ── 按日期精确查 ──────────────────────────────────────────
  if (date) {
    const conv = getConversation(date as string)
    if (conv.messages.length === 0) {
      return { content: `${date} 无对话记录`, brief: '无记录' }
    }
    const text = conv.messages.map(m =>
      `[${m.timestamp ?? ''}] ${m.role === 'user' ? '修士' : '器灵'}：${m.content}`
    ).join('\n\n')
    return {
      content: text,
      brief:   `${date} 共 ${conv.messages.length} 条`,
    }
  }

  // ── 关键词全文搜索 ────────────────────────────────────────
  if (query) {
    const keyword   = (query as string).toLowerCase()
    const lookback  = Math.min(Number(days), 60)
    const convs     = getRecentConversations(lookback)
    const hits: { date: string; role: string; content: string; timestamp: string }[] = []

    for (const conv of convs) {
      for (const msg of conv.messages) {
        if (msg.content.toLowerCase().includes(keyword)) {
          hits.push({
            date:      conv.date,
            role:      msg.role === 'user' ? '修士' : '器灵',
            content:   msg.content.length > 400 ? msg.content.slice(0, 400) + '…' : msg.content,
            timestamp: msg.timestamp ?? '',
          })
        }
      }
    }

    if (hits.length === 0) {
      return { content: `近 ${lookback} 天内未找到包含「${query}」的对话`, brief: '无匹配' }
    }

    const text = hits.map(h => `[${h.date} ${h.timestamp}] ${h.role}：${h.content}`).join('\n\n---\n\n')
    return {
      content: text,
      brief:   `命中 ${hits.length} 条（近 ${lookback} 天）`,
    }
  }

  // ── 两者都不填：返回有记录的日期列表 ─────────────────────
  const lookback = Math.min(Number(days), 60)
  const convs    = getRecentConversations(lookback)
  const summary  = convs.map(c => `${c.date}：${c.messages.length} 条消息`).join('\n')
  return {
    content: summary || `近 ${lookback} 天无对话记录`,
    brief:   `共 ${convs.length} 天有记录`,
  }
}, { displayName: '查询对话历史' })
