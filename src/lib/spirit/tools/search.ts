/**
 * 联网搜索工具（Tavily API）
 * 申请免费 Key：https://tavily.com
 * 配置：.env.local → TAVILY_API_KEY=tvly-xxx
 */

import { registerTool } from '../registry'

const TAVILY_URL = 'https://api.tavily.com/search'

registerTool({
  name:        'web_search',
  description: '联网搜索最新信息。当需要查询时事、技术文档、不在藏经阁内的知识时使用。返回摘要和来源链接。',
  parameters: {
    type: 'object',
    properties: {
      query:       { type: 'string', description: '搜索关键词（中英文均可）' },
      max_results: { type: 'number', description: '返回结果数，默认 5，最多 10' },
    },
    required: ['query'],
  },
}, async ({ query, max_results = 5 }) => {
  const apiKey = process.env.TAVILY_API_KEY
  if (!apiKey) {
    return {
      content: '联网搜索未配置：请在 .env.local 设置 TAVILY_API_KEY（申请地址：https://tavily.com）',
      brief:   '搜索未配置',
    }
  }

  const res = await fetch(TAVILY_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key:        apiKey,
      query:          query as string,
      search_depth:   'basic',
      max_results:    Math.min((max_results as number) ?? 5, 10),
      include_answer: true,
    }),
    signal: AbortSignal.timeout(15_000),
  })

  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText)
    return { content: `搜索失败：${err}`, brief: `搜索失败 ${res.status}` }
  }

  const data = await res.json() as {
    answer?:  string
    results?: { title: string; url: string; content: string; score: number }[]
  }

  const results = data.results ?? []
  if (results.length === 0) {
    return { content: '未找到相关结果。', brief: '无结果' }
  }

  const formatted = results.map((r, i) =>
    `[${i + 1}] ${r.title}\n${r.url}\n${r.content.slice(0, 300)}`
  ).join('\n\n')

  const content = data.answer
    ? `摘要：${data.answer}\n\n来源：\n${formatted}`
    : formatted

  return {
    content,
    brief: `找到 ${results.length} 条结果`,
  }
}, { displayName: '联网搜索' })
