/**
 * 联网搜索工具（Tavily API）
 * 申请免费 Key：https://tavily.com
 * 配置：.env.local → TAVILY_API_KEY=tvly-xxx
 */

import { registerTool } from '../registry'

const TAVILY_URL = 'https://api.tavily.com/search'

interface TavilyResult {
  title: string
  url: string
  content?: string
  raw_content?: string
  score?: number
}

interface TavilyResponse {
  answer?: string
  results?: TavilyResult[]
}

interface RankedResult extends TavilyResult {
  host: string
  sourceType: string
  qualityScore: number
  query: string
  excerpt: string
}

function apiKeyMissing() {
  return {
    content: '联网搜索未配置：请在 .env.local 设置 TAVILY_API_KEY（申请地址：https://tavily.com）',
    brief:   '搜索未配置',
  }
}

function hostnameOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '') }
  catch { return '' }
}

function classifySource(url: string, title: string): { type: string; score: number } {
  const host = hostnameOf(url)
  const u = url.toLowerCase()
  const t = title.toLowerCase()

  if (/github\.com|gitlab\.com/.test(host)) return { type: 'source_repo', score: 0.93 }
  if (/arxiv\.org|doi\.org|acm\.org|ieee\.org|springer\.com|nature\.com|science\.org/.test(host)) {
    return { type: 'paper', score: 0.92 }
  }
  if (/ietf\.org|w3\.org|tc39\.es|whatwg\.org|kubernetes\.io/.test(host)) return { type: 'standard_or_project_docs', score: 0.91 }
  if (/docs\.|developer\.|learn\.microsoft\.com|cloud\.google\.com|aws\.amazon\.com|vercel\.com|nextjs\.org|react\.dev|nodejs\.org|python\.org|typescriptlang\.org|openai\.com/.test(host) || /docs|documentation|reference|api/.test(t)) {
    return { type: 'official_docs', score: 0.9 }
  }
  if (/npmjs\.com|pypi\.org|crates\.io|pkg\.go\.dev/.test(host)) return { type: 'package_registry', score: 0.82 }
  if (/stackoverflow\.com|stackexchange\.com/.test(host)) return { type: 'qa', score: 0.68 }
  if (/medium\.com|dev\.to|hashnode\.com|substack\.com/.test(host)) return { type: 'personal_blog', score: 0.55 }
  if (/csdn\.net|cnblogs\.com|51cto\.com|juejin\.cn|segmentfault\.com|zhihu\.com/.test(host)) return { type: 'secondary_cn', score: 0.45 }
  if (/top|best|ultimate|complete guide|教程|排行榜|推荐/.test(u + ' ' + t)) return { type: 'seo_article', score: 0.32 }
  return { type: 'web_page', score: 0.6 }
}

function textExcerpt(r: TavilyResult, max = 1200): string {
  const text = (r.raw_content || r.content || '')
    .replace(/\s+/g, ' ')
    .trim()
  return text.slice(0, max)
}

function buildQueryVariants(question: string): string[] {
  const q = question.trim()
  const variants = [q]
  const tech = /api|sdk|框架|库|代码|typescript|javascript|python|react|next|langgraph|mcp|openai|模型|数据库|部署|性能|bug|错误|文档|源码/i.test(q)
  if (tech) {
    variants.push(`${q} official docs`)
    variants.push(`${q} GitHub`)
    variants.push(`${q} release notes changelog`)
  } else {
    variants.push(`${q} official`)
    variants.push(`${q} analysis`)
  }
  return [...new Set(variants)].slice(0, 4)
}

async function tavilySearch({
  query,
  maxResults = 5,
  depth = 'basic',
  includeRaw = false,
  includeDomains,
  excludeDomains,
}: {
  query: string
  maxResults?: number
  depth?: 'basic' | 'advanced'
  includeRaw?: boolean
  includeDomains?: string[]
  excludeDomains?: string[]
}): Promise<TavilyResponse> {
  const apiKey = process.env.TAVILY_API_KEY
  if (!apiKey) throw new Error('TAVILY_API_KEY missing')

  const body: Record<string, unknown> = {
    api_key:        apiKey,
    query,
    search_depth:   depth,
    max_results:    Math.min(maxResults, 10),
    include_answer: true,
  }
  if (includeRaw) body.include_raw_content = true
  if (includeDomains?.length) body.include_domains = includeDomains
  if (excludeDomains?.length) body.exclude_domains = excludeDomains

  const res = await fetch(TAVILY_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
    signal:  AbortSignal.timeout(depth === 'advanced' ? 25_000 : 15_000),
  })

  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText)
    throw new Error(`搜索失败 ${res.status}：${err}`)
  }

  return await res.json() as TavilyResponse
}

function rankResults(results: (TavilyResult & { query: string })[]): RankedResult[] {
  const seen = new Map<string, RankedResult>()

  for (const r of results) {
    if (!r.url) continue
    const normalizedUrl = r.url.split('#')[0].replace(/\/$/, '')
    const host = hostnameOf(normalizedUrl)
    const source = classifySource(normalizedUrl, r.title)
    const tavilyScore = typeof r.score === 'number' ? Math.max(0, Math.min(r.score, 1)) : 0.5
    const excerpt = textExcerpt(r)
    const contentBonus = excerpt.length > 600 ? 0.08 : excerpt.length > 250 ? 0.04 : 0
    const qualityScore = Number((source.score * 0.7 + tavilyScore * 0.22 + contentBonus).toFixed(3))

    const ranked: RankedResult = {
      ...r,
      url: normalizedUrl,
      host,
      sourceType: source.type,
      qualityScore,
      excerpt,
    }

    const prev = seen.get(normalizedUrl)
    if (!prev || ranked.qualityScore > prev.qualityScore) seen.set(normalizedUrl, ranked)
  }

  return Array.from(seen.values())
    .sort((a, b) => b.qualityScore - a.qualityScore)
}

registerTool({
  name:        'web_search',
  description: '快速联网搜索。适合简单事实查询；技术调研、资料搜集、需要高质量来源时优先使用 research_web。',
  parameters: {
    type: 'object',
    properties: {
      query:           { type: 'string', description: '搜索关键词（中英文均可）' },
      max_results:     { type: 'number', description: '返回结果数，默认 5，最多 10' },
      search_depth:    { type: 'string', enum: ['basic', 'advanced'], description: '搜索深度，默认 basic；需要质量时用 advanced' },
      include_domains: { type: 'array', items: { type: 'string' }, description: '仅搜索这些域名（可选）' },
      exclude_domains: { type: 'array', items: { type: 'string' }, description: '排除这些域名（可选）' },
    },
    required: ['query'],
  },
}, async ({ query, max_results = 5, search_depth = 'basic', include_domains, exclude_domains }) => {
  if (!process.env.TAVILY_API_KEY) return apiKeyMissing()

  let data: TavilyResponse
  try {
    data = await tavilySearch({
      query: String(query),
      maxResults: Number(max_results) || 5,
      depth: search_depth === 'advanced' ? 'advanced' : 'basic',
      includeDomains: include_domains as string[] | undefined,
      excludeDomains: exclude_domains as string[] | undefined,
    })
  } catch (err) {
    return { content: err instanceof Error ? err.message : String(err), brief: '搜索失败' }
  }

  const results = data.results ?? []
  if (results.length === 0) {
    return { content: '未找到相关结果。', brief: '无结果' }
  }

  const formatted = results.map((r, i) =>
    `[${i + 1}] ${r.title}\n${r.url}\n${(r.content ?? '').slice(0, 300)}`
  ).join('\n\n')

  const content = data.answer
    ? `摘要：${data.answer}\n\n来源：\n${formatted}`
    : formatted

  const topTitles = results.slice(0, 3).map(r => r.title).join(' / ')
  return {
    content,
    brief: `找到 ${results.length} 条：${topTitles}`,
  }
}, { displayName: '联网搜索', domain: 'web', agents: ['search_agent'] })

registerTool({
  name:        'research_web',
  description: `深度联网调研。会多 query 搜索、去重、按来源质量排序，并返回带证据摘录的 evidence pack。
适用：技术资料、文档选型、最新 API/产品信息、需要可靠来源的汇总。优先于 web_search 使用。`,
  parameters: {
    type: 'object',
    properties: {
      question:        { type: 'string', description: '用户真正要解决的问题，越具体越好' },
      queries:         { type: 'array', items: { type: 'string' }, description: '可选：手工指定 2-5 个搜索 query；不填则自动生成' },
      max_sources:     { type: 'number', description: '最终证据来源数，默认 5，最多 8' },
      include_domains: { type: 'array', items: { type: 'string' }, description: '优先/限定搜索的域名（如 nextjs.org, github.com）' },
      exclude_domains: { type: 'array', items: { type: 'string' }, description: '排除低质量或不想看的域名' },
    },
    required: ['question'],
  },
}, async ({ question, queries, max_sources = 5, include_domains, exclude_domains }) => {
  if (!process.env.TAVILY_API_KEY) return apiKeyMissing()

  const qList = Array.isArray(queries) && queries.length > 0
    ? (queries as string[]).filter(Boolean).slice(0, 5)
    : buildQueryVariants(String(question))

  const defaultExcludes = [
    'csdn.net', '51cto.com', 'cloud.tencent.com/developer/article',
    'geeksforgeeks.org', 'w3schools.com',
  ]
  const excludes = [...new Set([...(exclude_domains as string[] | undefined ?? []), ...defaultExcludes])]

  try {
    const batches = await Promise.all(qList.map(async q => {
      const data = await tavilySearch({
        query: q,
        maxResults: 6,
        depth: 'advanced',
        includeRaw: true,
        includeDomains: include_domains as string[] | undefined,
        excludeDomains: excludes,
      })
      return (data.results ?? []).map(r => ({ ...r, query: q }))
    }))

    const ranked = rankResults(batches.flat())
    const selected = ranked.slice(0, Math.min(Number(max_sources) || 5, 8))
    if (selected.length === 0) return { content: '未找到可用的高质量来源。', brief: '无高质量来源' }

    const evidence = selected.map((r, i) => ({
      id: i + 1,
      title: r.title,
      url: r.url,
      host: r.host,
      sourceType: r.sourceType,
      qualityScore: r.qualityScore,
      foundByQuery: r.query,
      excerpt: r.excerpt,
    }))

    const sourceLines = evidence.map(e =>
      `[${e.id}] ${e.title}\n${e.url}\n类型：${e.sourceType}　质量：${e.qualityScore}　query：${e.foundByQuery}\n摘录：${e.excerpt}`
    ).join('\n\n---\n\n')

    const topTitles = evidence.slice(0, 3).map(e => e.title).join(' / ')
    return {
      content:
        `问题：${question}\n` +
        `搜索策略：${qList.join(' | ')}\n` +
        `证据来源按质量排序。优先相信 official_docs / standard_or_project_docs / source_repo / paper；谨慎对待 secondary/seo 来源。\n\n` +
        `来源：\n${sourceLines}`,
      brief: `深度检索 ${evidence.length} 个来源：${topTitles}`,
    }
  } catch (err) {
    return {
      content: err instanceof Error ? err.message : String(err),
      brief:   '深度检索失败',
    }
  }
}, { displayName: '深度检索', domain: 'web', agents: ['search_agent'] })
