import { getBlogPostsCache } from './memory'
import { clampSummary } from './memory-pack'

export type KnowledgeNodeType =
  | 'capability_domain'
  | 'capability'
  | 'blog'

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
  type: 'contains' | 'evidenced_by' | 'related'
  label: string
  confidence: number
}

export interface KnowledgeGraph {
  generatedAt: string
  nodes: KnowledgeNode[]
  edges: KnowledgeEdge[]
}

interface CapabilityDef {
  id: string
  domainId: string
  title: string
  summary: string
  keywords: string[]
}

interface CapabilityDomainDef {
  id: string
  title: string
  summary: string
  keywords: string[]
}

const DOMAINS: CapabilityDomainDef[] = [
  {
    id: 'agent',
    title: 'Agent',
    summary: '智能体架构、工具调用、规划执行、记忆与上下文治理。',
    keywords: ['agent', '智能体', '助手', 'tool', '工具', 'planner', '规划', 'langgraph', 'mcp', 'function calling', '上下文', 'memory', '记忆'],
  },
  {
    id: 'rag',
    title: 'RAG',
    summary: '检索增强生成、向量召回、切块、重排、知识库与引用治理。',
    keywords: ['rag', 'retrieval', '检索', 'embedding', '向量', '召回', 'rerank', '重排', 'chunk', '知识库', '引用'],
  },
  {
    id: 'llm',
    title: 'LLM 基础',
    summary: 'Transformer、注意力机制、预训练模型、推理与提示工程基础。',
    keywords: ['llm', '大模型', 'language model', 'transformer', 'attention', '注意力', 'q、k、v', 'encoder', 'decoder', 'prompt'],
  },
  {
    id: 'ai-engineering',
    title: 'AI 工程化',
    summary: '模型应用落地中的流式输出、观测、评估、缓存、部署与 API 集成。',
    keywords: ['engineering', '工程化', 'eval', '评估', 'tracing', '观测', 'stream', '流式', 'cache', '缓存', 'api', 'openai'],
  },
  {
    id: 'product-frontend',
    title: '产品与前端',
    summary: 'Next.js、React、交互、可视化、个人网站和助手界面体验。',
    keywords: ['next', 'next.js', 'react', '前端', 'ui', 'ux', '交互', '可视化', '图谱', 'canvas', '网站'],
  },
  {
    id: 'backend-data',
    title: '后端与数据',
    summary: 'API、RPC、数据同步、存储、Webhook 与本地服务集成。',
    keywords: ['backend', '后端', 'api', 'rpc', 'database', '数据库', 'redis', 'webhook', '同步', 'server'],
  },
]

const CAPABILITIES: CapabilityDef[] = [
  {
    id: 'agent-tool-use',
    domainId: 'agent',
    title: '工具调用与权限',
    summary: '让助手选择、调用和解释工具结果，并处理写操作确认。',
    keywords: ['tool', '工具', 'function calling', 'mcp', '权限', 'approval', '调用'],
  },
  {
    id: 'agent-planning',
    domainId: 'agent',
    title: '任务规划与执行流',
    summary: '把用户问题拆成直接、顺序或并行任务，并跟踪执行状态。',
    keywords: ['planner', '规划', 'plan', 'task', '任务', 'parallel', 'sequential', 'langgraph', 'workflow'],
  },
  {
    id: 'agent-memory-context',
    domainId: 'agent',
    title: '记忆与上下文治理',
    summary: '决定哪些历史、长期记忆和页面上下文应该进入本轮 Prompt。',
    keywords: ['memory', '记忆', 'context', '上下文', 'prompt', '审计', 'history', '摘要'],
  },
  {
    id: 'rag-retrieval',
    domainId: 'rag',
    title: '检索与召回',
    summary: '用关键词、向量或混合检索从资料库中找出候选内容。',
    keywords: ['retrieval', '检索', 'search', '搜索', '召回', 'hybrid', 'bm25', 'query'],
  },
  {
    id: 'rag-embedding',
    domainId: 'rag',
    title: '向量化与相似度',
    summary: '把文档和对话转成 embedding，用相似度组织知识。',
    keywords: ['embedding', '向量', 'similarity', '相似度', 'vector', '余弦', '语义'],
  },
  {
    id: 'rag-chunking',
    domainId: 'rag',
    title: '切块、重排与引用',
    summary: '控制知识片段粒度、排序质量和回答中的来源可追溯性。',
    keywords: ['chunk', '切块', 'rerank', '重排', '引用', 'source', 'citation', '片段'],
  },
  {
    id: 'llm-transformer',
    domainId: 'llm',
    title: 'Transformer 与注意力',
    summary: '理解自注意力、QKV、编码器/解码器和模型结构。',
    keywords: ['transformer', 'attention', '注意力', 'qkv', 'q、k、v', 'encoder', 'decoder', '架构'],
  },
  {
    id: 'llm-pretraining',
    domainId: 'llm',
    title: '预训练语言模型',
    summary: '理解不同预训练范式、模型目标和基础能力来源。',
    keywords: ['pre-trained', 'pretraining', '预训练', 'language model', 'encoder-only', 'bert', '模型'],
  },
  {
    id: 'llm-prompting',
    domainId: 'llm',
    title: 'Prompt 与推理行为',
    summary: '观察模型如何理解任务、组织推理并生成答案。',
    keywords: ['prompt', '提示词', 'reasoning', '推理', 'thought', '思维', 'trace', 'tracing'],
  },
  {
    id: 'ai-observability',
    domainId: 'ai-engineering',
    title: '可观测与调试',
    summary: '记录调用过程、上下文、工具结果和错误，降低黑盒感。',
    keywords: ['tracing', 'trace', '观测', 'debug', '调试', 'audit', '审计', '日志'],
  },
  {
    id: 'ai-streaming',
    domainId: 'ai-engineering',
    title: '流式交互',
    summary: '处理模型流式输出、状态展示、滚动和前端渲染性能。',
    keywords: ['stream', 'streaming', '流式', 'sse', '响应', '输出', '渲染'],
  },
  {
    id: 'ai-api-integration',
    domainId: 'ai-engineering',
    title: '模型 API 集成',
    summary: '接入 OpenAI、工具 schema、服务端路由和模型调用链。',
    keywords: ['openai', 'api', 'schema', 'route', 'server', '模型调用', '接口'],
  },
  {
    id: 'frontend-next-react',
    domainId: 'product-frontend',
    title: 'Next.js 与 React',
    summary: '构建个人站、应用页面、客户端组件和服务端数据读取。',
    keywords: ['next', 'next.js', 'react', 'component', '组件', 'page', 'app router', '页面'],
  },
  {
    id: 'frontend-ux-visualization',
    domainId: 'product-frontend',
    title: '交互与可视化',
    summary: '把抽象系统做成可理解、可点击、可探索的界面。',
    keywords: ['ui', 'ux', '交互', '可视化', '图谱', 'graph', 'canvas', '体验'],
  },
  {
    id: 'backend-api-rpc',
    domainId: 'backend-data',
    title: 'API 与 RPC 设计',
    summary: '设计服务间通信、接口边界和请求响应语义。',
    keywords: ['api', 'rpc', '接口', '服务', 'request', 'response', '协议'],
  },
  {
    id: 'backend-sync-storage',
    domainId: 'backend-data',
    title: '数据同步与本地存储',
    summary: '把外部内容同步到本地缓存、索引和可读数据文件。',
    keywords: ['sync', '同步', 'cache', '缓存', 'storage', '存储', 'json', 'webhook', 'local'],
  },
]

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ')
}

function postText(post: ReturnType<typeof getBlogPostsCache>[number]): string {
  return normalize([
    post.title,
    post.excerpt,
    post.category,
    ...(post.tags ?? []),
    post.content,
  ].filter(Boolean).join(' '))
}

function scoreKeywords(text: string, keywords: string[]): number {
  return keywords.reduce((score, keyword) => {
    const key = normalize(keyword)
    if (!key) return score
    if (text.includes(key)) return score + (key.length >= 5 ? 2 : 1)
    return score
  }, 0)
}

function blogSummary(post: ReturnType<typeof getBlogPostsCache>[number]) {
  const fallback = post.content || `${post.category}${post.tags.length ? ` / ${post.tags.join('、')}` : ''}`
  return clampSummary(post.excerpt || fallback || '暂无摘要', 180)
}

export function buildKnowledgeGraph(): KnowledgeGraph {
  const nodes: KnowledgeNode[] = []
  const edges: KnowledgeEdge[] = []
  const posts = getBlogPostsCache()
  const postBySlug = new Map(posts.map(post => [post.slug, post]))
  const usedBlogSlugs = new Set<string>()

  for (const domain of DOMAINS) {
    nodes.push({
      id: `domain:${domain.id}`,
      type: 'capability_domain',
      title: domain.title,
      summary: domain.summary,
      tags: domain.keywords.slice(0, 6),
      source: 'capability-map',
      weight: 10,
    })
  }

  for (const capability of CAPABILITIES) {
    const matched = posts
      .map(post => {
        const text = postText(post)
        const capabilityScore = scoreKeywords(text, capability.keywords)
        const domain = DOMAINS.find(item => item.id === capability.domainId)
        const domainScore = domain ? scoreKeywords(text, domain.keywords) : 0
        return { post, score: capabilityScore * 2 + domainScore }
      })
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score || (b.post.publishedAt ?? '').localeCompare(a.post.publishedAt ?? ''))
      .slice(0, 8)

    nodes.push({
      id: `capability:${capability.id}`,
      type: 'capability',
      title: capability.title,
      summary: capability.summary,
      tags: capability.keywords.slice(0, 6),
      source: `capability-map#${capability.id}`,
      weight: 4 + Math.min(6, matched.length),
    })

    edges.push({
      id: `domain:${capability.domainId}->capability:${capability.id}`,
      from: `domain:${capability.domainId}`,
      to: `capability:${capability.id}`,
      type: 'contains',
      label: '能力方向',
      confidence: 1,
    })

    for (const { post, score } of matched) {
      usedBlogSlugs.add(post.slug)
      edges.push({
        id: `capability:${capability.id}->blog:${post.slug}`,
        from: `capability:${capability.id}`,
        to: `blog:${post.slug}`,
        type: 'evidenced_by',
        label: '关联博文',
        confidence: Math.min(0.95, 0.45 + score * 0.08),
      })
    }
  }

  for (const slug of usedBlogSlugs) {
    const post = postBySlug.get(slug)
    if (!post) continue
    nodes.push({
      id: `blog:${post.slug}`,
      type: 'blog',
      title: post.title,
      summary: blogSummary(post),
      date: post.publishedAt?.slice(0, 10),
      tags: [...(post.tags ?? []), post.category].filter(Boolean),
      source: `/blog/${post.slug}`,
      weight: Math.max(2, Math.min(8, Math.round((post.wordCount ?? 1000) / 600))),
    })
  }

  return {
    generatedAt: new Date().toISOString(),
    nodes,
    edges: edges.sort((a, b) => b.confidence - a.confidence),
  }
}

export function filterKnowledgeGraph(graph: KnowledgeGraph, input: {
  type?: KnowledgeNodeType
  q?: string
  limit?: number
}): KnowledgeGraph {
  const query = input.q?.trim().toLowerCase()
  const limit = Math.max(1, Math.min(input.limit ?? 160, 300))
  const matchedIds = new Set<string>()
  const directlyMatched = graph.nodes
    .filter(node => !input.type || node.type === input.type)
    .filter(node => !query || `${node.title} ${node.summary} ${node.tags.join(' ')}`.toLowerCase().includes(query))
    .slice(0, limit)

  for (const node of directlyMatched) matchedIds.add(node.id)

  if (input.type === 'capability_domain') {
    for (const edge of graph.edges.filter(edge => matchedIds.has(edge.from))) matchedIds.add(edge.to)
  } else if (input.type === 'capability') {
    for (const edge of graph.edges.filter(edge => matchedIds.has(edge.from) || matchedIds.has(edge.to))) {
      matchedIds.add(edge.from)
      matchedIds.add(edge.to)
    }
  }

  const nodes = graph.nodes.filter(node => matchedIds.has(node.id))
  const ids = new Set(nodes.map(node => node.id))
  return {
    ...graph,
    nodes,
    edges: graph.edges.filter(edge => ids.has(edge.from) && ids.has(edge.to)),
  }
}
