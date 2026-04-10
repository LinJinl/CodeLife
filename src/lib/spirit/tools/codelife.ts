/**
 * CodeLife 数据工具：让器灵能直接查阅博客、刷题、GitHub 数据
 */

import { registerTool }        from '../registry'
import config                  from '../../../../codelife.config'
import { createBlogAdapter }   from '../../adapters/blog'
import { createLeetcodeAdapter } from '../../adapters/leetcode'

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
