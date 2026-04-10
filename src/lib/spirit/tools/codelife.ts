/**
 * CodeLife 数据工具：让器灵能直接查阅博客、刷题、GitHub 数据、对话历史
 */

import { registerTool }        from '../registry'
import config                  from '../../../../codelife.config'
import { createBlogAdapter }   from '../../adapters/blog'
import { createLeetcodeAdapter } from '../../adapters/leetcode'
import {
  getConversation, getRecentConversations,
  getConvEmbeddings, saveConvEmbeddings,
  type ConvEmbeddingEntry,
} from '../memory'

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

// ── 语义搜索辅助函数 ──────────────────────────────────────────

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] ** 2; nb += b[i] ** 2 }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0
}

/**
 * 增量构建 embedding 缓存：
 *   - 读已有缓存，找出 (date, msgIndex) 还没有向量的条目
 *   - 批量调用 embedding API，写回缓存
 *   - 返回完整缓存
 */
async function buildEmbeddingIndex(days: number): Promise<ConvEmbeddingEntry[]> {
  const { OpenAIEmbeddings } = await import('@langchain/openai')
  const embedder = new OpenAIEmbeddings({
    apiKey:    config.spirit?.apiKey,
    // text-embedding-3-small：$0.02/1M tokens，足够个人站
    modelName: 'text-embedding-3-small',
    // 若用第三方兼容 API 则传 baseURL
    ...(config.spirit?.baseURL ? { configuration: { baseURL: config.spirit.baseURL } } : {}),
  })

  const lookback = Math.min(Number(days), 60)
  const convs    = getRecentConversations(lookback)
  const cache    = getConvEmbeddings()

  // 建已缓存条目的 set：key = "date::msgIndex"
  const cached = new Set(cache.map(e => `${e.date}::${e.msgIndex}`))

  // 找出需要新增 embedding 的消息
  const pending: Omit<ConvEmbeddingEntry, 'vec'>[] = []
  for (const conv of convs) {
    conv.messages.forEach((msg, idx) => {
      if (!msg.content.trim()) return
      if (!cached.has(`${conv.date}::${idx}`)) {
        pending.push({
          date:      conv.date,
          msgIndex:  idx,
          role:      msg.role,
          content:   msg.content,
          timestamp: msg.timestamp ?? '',
        })
      }
    })
  }

  if (pending.length > 0) {
    // 批量 embed（LangChain 自动分批，避免超 token 限制）
    const vecs = await embedder.embedDocuments(pending.map(p => p.content))
    const newEntries: ConvEmbeddingEntry[] = pending.map((p, i) => ({ ...p, vec: vecs[i] }))
    const updated = [...cache, ...newEntries]
    saveConvEmbeddings(updated)
    return updated
  }

  return cache
}

registerTool({
  name:        'semantic_search_conversations',
  description: '用语义相似度在历史对话中检索相关内容，比关键词搜索更智能，能找到意思相近但措辞不同的内容。用于"我之前提到过…""我们讨论过关于…的问题"之类的模糊回忆。',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type:        'string',
        description: '想找什么内容的描述，越具体越好',
      },
      days: {
        type:        'number',
        description: '搜索最近多少天，默认 30，最大 60',
      },
      topK: {
        type:        'number',
        description: '返回最相关的几条，默认 5，最大 10',
      },
    },
    required: ['query'],
  },
}, async ({ query, days = 30, topK = 5 }) => {
  try {
    const { OpenAIEmbeddings } = await import('@langchain/openai')
    const embedder = new OpenAIEmbeddings({
      apiKey:    config.spirit?.apiKey,
      modelName: 'text-embedding-3-small',
      ...(config.spirit?.baseURL ? { configuration: { baseURL: config.spirit.baseURL } } : {}),
    })

    // 1. 构建/更新索引
    const entries = await buildEmbeddingIndex(days)
    if (entries.length === 0) {
      return { content: '暂无可检索的对话历史', brief: '无索引' }
    }

    // 2. 对 query 做 embedding
    const queryVec = await embedder.embedQuery(query as string)

    // 3. 按相似度排序，取 top-k
    const k = Math.min(Number(topK), 10)
    const scored = entries
      .map(e => ({ ...e, score: cosine(queryVec, e.vec) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k)

    if (scored.length === 0 || scored[0].score < 0.3) {
      return { content: `未找到与「${query}」语义相关的历史对话`, brief: '无匹配' }
    }

    const text = scored.map(e => {
      const role    = e.role === 'user' ? '修士' : '器灵'
      const snippet = e.content.length > 400 ? e.content.slice(0, 400) + '…' : e.content
      return `[${e.date} ${e.timestamp}] 相似度 ${(e.score * 100).toFixed(0)}%\n${role}：${snippet}`
    }).join('\n\n---\n\n')

    return {
      content: text,
      brief:   `找到 ${scored.length} 条相关记录（最高相似度 ${(scored[0].score * 100).toFixed(0)}%）`,
    }
  } catch (err) {
    // embedding API 不可用时降级到关键词搜索
    const keyword = (query as string).toLowerCase()
    const convs   = getRecentConversations(Math.min(Number(days), 60))
    const hits    = convs.flatMap(c => c.messages
      .filter(m => m.content.toLowerCase().includes(keyword))
      .map(m => `[${c.date}] ${m.role === 'user' ? '修士' : '器灵'}：${m.content.slice(0, 300)}`)
    ).slice(0, Number(topK))
    const msg = hits.length > 0
      ? `（embedding 不可用，降级为关键词匹配）\n\n${hits.join('\n\n---\n\n')}`
      : `embedding 不可用，关键词搜索也无匹配：${err instanceof Error ? err.message : String(err)}`
    return { content: msg, brief: `降级搜索：${hits.length} 条` }
  }
}, { displayName: '语义检索对话' })
