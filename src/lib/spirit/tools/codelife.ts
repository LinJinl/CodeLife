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
  getBlogEmbeddings, saveBlogEmbeddings,
  getBlogPostsCache, type CachedBlogPost,
} from '../memory'
import { hybridSearch, type HybridDoc } from '../hybrid-search'

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
  let posts: CachedBlogPost[] = getBlogPostsCache()
  if (posts.length === 0) {
    try {
      const adapter   = createBlogAdapter(config.blog, config.cultivation)
      const livePosts = await adapter.getPosts()
      posts = livePosts.map(p => ({
        slug: p.slug, title: p.title, excerpt: p.excerpt ?? '', content: '',
        category: p.category, tags: p.tags ?? [], wordCount: p.wordCount,
        publishedAt: typeof p.publishedAt === 'string' ? p.publishedAt : (p.publishedAt as Date).toISOString(),
        pointsEarned: p.pointsEarned,
      }))
      const { saveBlogPostsCache: save } = await import('../memory')
      save(posts)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { content: `博客数据源读取失败：${msg}`, brief: '数据源错误' }
    }
  }
  const filtered = category ? posts.filter(p => p.category === (category as string)) : posts
  const result   = filtered.slice(0, limit as number)
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
  let problems
  try {
    const adapter = createLeetcodeAdapter(config.leetcode, config.cultivation)
    problems = await adapter.getProblems()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { content: `LeetCode 数据源读取失败：${msg}`, brief: '数据源错误' }
  }
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
  name:        'search_blog_posts',
  description: '在用户自己撰写的博客文章中混合检索（BM25 + 语义向量 RRF 融合）。用于"我写过关于…""我的文章里有没有…""搜索我的文档/笔记/博客中关于…的内容"。注意：这是搜索用户本人写的内容，不是外部收藏。',
  parameters: {
    type: 'object',
    properties: {
      query:    { type: 'string', description: '检索描述，自然语言' },
      category: { type: 'string', description: '先按分类过滤，再检索（可选）' },
      topK:     { type: 'number', description: '返回数量，默认 5' },
    },
    required: ['query'],
  },
}, async ({ query, category, topK = 5 }) => {
  // 优先读本地缓存（syncToday 写入），避免每次搜索都调远程 API
  let posts: CachedBlogPost[] = getBlogPostsCache()

  if (posts.length === 0) {
    // 缓存不存在时 fallback：实时拉一次并写缓存
    try {
      const adapter    = createBlogAdapter(config.blog, config.cultivation)
      const livePosts  = await adapter.getPosts()
      posts = livePosts.map(p => ({
        slug:        p.slug,
        title:       p.title,
        excerpt:     p.excerpt ?? '',
        content:     '',
        category:    p.category,
        tags:        p.tags ?? [],
        wordCount:   p.wordCount,
        publishedAt: typeof p.publishedAt === 'string' ? p.publishedAt : (p.publishedAt as Date).toISOString(),
        pointsEarned: p.pointsEarned,
      }))
      const { saveBlogPostsCache } = await import('../memory')
      saveBlogPostsCache(posts)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { content: `博客数据源读取失败（本地无缓存）：${msg}，请先执行一次数据同步（POST /api/spirit/sync）`, brief: '数据源错误' }
    }
  }

  if (category) posts = posts.filter(p => p.category === (category as string))
  if (posts.length === 0) return { content: '博客中没有文章，或分类下无内容', brief: '无结果' }

  // BM25 用全文，embedding 截断到 6000 字避免超 token
  const docs: HybridDoc[] = posts.map(p => ({
    id:   p.slug,
    text: `${p.title}\n${p.content || p.excerpt}`.slice(0, 6000),
  }))

  const cache    = getBlogEmbeddings()
  const cacheMap = new Map(cache.map(e => [e.id, e.vec]))

  const results = await hybridSearch(docs, query as string, {
    topK:         Math.min(Number(topK), 10),
    embedder:     makeEmbedder(),
    getCachedVec: id => cacheMap.get(id),
    onNewVecs:    newVecs => {
      for (const { id, vec } of newVecs) cacheMap.set(id, vec)
      saveBlogEmbeddings(Array.from(cacheMap.entries()).map(([id, vec]) => ({ id, vec })))
    },
  })

  if (results.length === 0) return { content: '没有找到相关博文', brief: '无结果' }

  const postMap = new Map(posts.map(p => [p.slug, p]))
  const matched = results.map(r => {
    const p       = postMap.get(r.id)!
    // 从正文中截取与 query 最相关的片段（取前 600 字，足够模型引用）
    const snippet = (p.content || p.excerpt || '').slice(0, 600)
    return {
      title:       p.title,
      slug:        p.slug,
      category:    p.category,
      publishedAt: p.publishedAt.slice(0, 10),
      snippet,
      wordCount:   p.wordCount,
    }
  })

  return {
    content: JSON.stringify(matched),
    brief:   `找到 ${matched.length} 篇相关博文`,
  }
}, { displayName: '检索博客文章' })

// ── embedding 构建辅助 ────────────────────────────────────────

function makeEmbedder() {
  const { OpenAIEmbeddings } = require('@langchain/openai')
  return new OpenAIEmbeddings({
    apiKey:    config.spirit?.apiKey,
    modelName: 'text-embedding-3-small',
    ...(config.spirit?.baseURL ? { configuration: { baseURL: config.spirit.baseURL } } : {}),
  })
}

// ── 对话检索（hybrid：BM25 + 向量 → RRF）────────────────────

registerTool({
  name:        'search_conversations',
  description: '检索历史对话记录。按日期精确查，或用自然语言描述做混合检索（BM25 + 语义向量 RRF 融合）。用于"我们上次说了什么""之前提到过 XXX 的问题"之类的场景。',
  parameters: {
    type: 'object',
    properties: {
      date:  { type: 'string', description: '精确查某天的完整对话（YYYY-MM-DD），填了此项则忽略 query' },
      query: { type: 'string', description: '自然语言描述，混合检索近期对话内容' },
      days:  { type: 'number', description: '搜索最近多少天，默认 30，最大 60' },
      topK:  { type: 'number', description: '返回最相关的几条，默认 5' },
    },
    required: [],
  },
}, async ({ date, query, days = 30, topK = 5 }) => {
  // ── 按日期精确查 ─────────────────────────────────────────
  if (date) {
    const conv = getConversation(date as string)
    if (conv.messages.length === 0) return { content: `${date} 无对话记录`, brief: '无记录' }
    const text = conv.messages.map(m =>
      `[${m.timestamp ?? ''}] ${m.role === 'user' ? '修士' : '器灵'}：${m.content}`
    ).join('\n\n')
    return { content: text, brief: `${date} 共 ${conv.messages.length} 条` }
  }

  // ── 无 query：列出有记录的日期 ───────────────────────────
  if (!query) {
    const convs   = getRecentConversations(Math.min(Number(days), 60))
    const summary = convs.map(c => `${c.date}：${c.messages.length} 条消息`).join('\n')
    return { content: summary || '无对话记录', brief: `共 ${convs.length} 天有记录` }
  }

  // ── 混合检索 ─────────────────────────────────────────────
  const lookback = Math.min(Number(days), 60)
  const k        = Math.min(Number(topK), 10)
  const convs    = getRecentConversations(lookback)

  // 把每条消息展开为 HybridDoc
  type MsgMeta = { date: string; msgIndex: number; role: string; content: string; timestamp: string }
  const docs: (HybridDoc & { meta: MsgMeta })[] = []
  for (const conv of convs) {
    conv.messages.forEach((msg, idx) => {
      if (!msg.content.trim()) return
      docs.push({
        id:   `${conv.date}::${idx}`,
        text: msg.content,
        meta: { date: conv.date, msgIndex: idx, role: msg.role, content: msg.content, timestamp: msg.timestamp ?? '' },
      })
    })
  }
  if (docs.length === 0) return { content: '无可检索的对话记录', brief: '无索引' }

  // 读 embedding 缓存
  const cache    = getConvEmbeddings()
  const cacheMap = new Map(cache.map(e => [`${e.date}::${e.msgIndex}`, e.vec]))

  const results = await hybridSearch(docs, query as string, {
    topK:        k,
    embedder:    makeEmbedder(),
    getCachedVec: id => cacheMap.get(id),
    onNewVecs:   newVecs => {
      for (const { id, vec } of newVecs) {
        cacheMap.set(id, vec)
        const [d, i] = id.split('::')
        const docMeta = docs.find(doc => doc.id === id)?.meta
        if (docMeta) {
          cache.push({ date: d, msgIndex: Number(i), role: docMeta.role as 'user'|'assistant', content: docMeta.content, timestamp: docMeta.timestamp, vec })
        }
      }
      saveConvEmbeddings(cache)
    },
  })

  if (results.length === 0) return { content: `未找到与「${query}」相关的历史对话`, brief: '无匹配' }

  const docMap = new Map(docs.map(d => [d.id, d.meta]))
  const text   = results.map(r => {
    const m       = docMap.get(r.id)!
    const role    = m.role === 'user' ? '修士' : '器灵'
    const snippet = m.content.length > 400 ? m.content.slice(0, 400) + '…' : m.content
    const tags    = [r.bm25Rank !== null ? 'BM25' : '', r.vecRank !== null ? '向量' : ''].filter(Boolean).join('+')
    return `[${m.date} ${m.timestamp}] (${tags} RRF=${r.rrfScore.toFixed(3)})\n${role}：${snippet}`
  }).join('\n\n---\n\n')

  return {
    content: text,
    brief:   `找到 ${results.length} 条（近 ${lookback} 天，混合检索）`,
  }
}, { displayName: '检索对话历史' })
