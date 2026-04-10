/**
 * 藏经阁工具：收藏、检索、列举文档
 */

import fs   from 'fs'
import path from 'path'
import OpenAI from 'openai'
import { registerTool } from '../registry'
import config from '../../../../codelife.config'

export interface LibraryEntry {
  id:       string
  url?:     string
  title:    string
  summary:  string
  tags:     string[]
  category: string
  savedAt:  string
}

const LIBRARY_DIR = path.resolve(process.cwd(), 'content/spirit/library')
const INDEX_FILE  = path.join(LIBRARY_DIR, 'index.json')

function ensureDir() {
  if (!fs.existsSync(LIBRARY_DIR)) fs.mkdirSync(LIBRARY_DIR, { recursive: true })
}

export function loadLibraryIndex(): LibraryEntry[] {
  try { return JSON.parse(fs.readFileSync(INDEX_FILE, 'utf-8')) } catch { return [] }
}

function saveIndex(entries: LibraryEntry[]) {
  ensureDir()
  fs.writeFileSync(INDEX_FILE, JSON.stringify(entries, null, 2))
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

async function analyzeContent(
  title:   string,
  content: string,
): Promise<Pick<LibraryEntry, 'summary' | 'tags' | 'category'>> {
  const spirit = config.spirit
  if (!spirit?.apiKey) {
    return { summary: content.slice(0, 100), tags: [], category: '未分类' }
  }
  const client = new OpenAI({ apiKey: spirit.apiKey, baseURL: spirit.baseURL })
  const res = await client.chat.completions.create({
    model:       spirit.model ?? 'gpt-4o-mini',
    temperature: 0.2,
    messages: [{
      role:    'user',
      content: `分析以下文章，必须用中文，只返回 JSON，不要任何解释：
{"summary":"一句话中文摘要（不超过80字）","tags":["中文标签1","中文标签2","中文标签3"],"category":"算法/系统设计/工程实践/前端/后端/数学/其他 中选一个"}

标题：${title}
内容：${content.slice(0, 3000)}`,
    }],
  })
  try {
    const text = res.choices[0]?.message?.content ?? '{}'
    const json = JSON.parse(text.replace(/```json\n?|\n?```/g, '').trim())
    return {
      summary:  typeof json.summary  === 'string' ? json.summary  : content.slice(0, 80),
      tags:     Array.isArray(json.tags)           ? json.tags.slice(0, 5) : [],
      category: typeof json.category === 'string' ? json.category : '未分类',
    }
  } catch {
    return { summary: content.slice(0, 80), tags: [], category: '未分类' }
  }
}

// ── 注册 ──────────────────────────────────────────────────────

registerTool({
  name:        'collect_document',
  description: '将文章内容收藏到藏经阁，自动分析生成摘要和标签。用户提供文章标题和内容（或已由 fetch_url 获取），可附带原文链接。',
  parameters: {
    type: 'object',
    properties: {
      title:   { type: 'string', description: '文章标题' },
      content: { type: 'string', description: '文章全文或摘录' },
      url:     { type: 'string', description: '原文链接（可选）' },
    },
    required: ['title', 'content'],
  },
}, async ({ title, content, url }) => {
  const analysis = await analyzeContent(title as string, content as string)
  const entry: LibraryEntry = {
    id:      generateId(),
    url:     url as string | undefined,
    title:   title as string,
    savedAt: new Date().toISOString(),
    ...analysis,
  }
  const index = loadLibraryIndex()
  index.unshift(entry)
  saveIndex(index)
  return {
    content: JSON.stringify({ ok: true, entry }),
    brief:   `已收藏「${entry.title}」，标签：${entry.tags.join('、') || '无'}`,
  }
}, { displayName: '收藏至藏经阁' })

registerTool({
  name:        'search_library',
  description: '在已收藏的文档中检索，支持关键词和标签过滤',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '检索关键词' },
      tag:   { type: 'string', description: '按标签过滤（可选）' },
    },
    required: ['query'],
  },
}, async ({ query, tag }) => {
  const q       = (query as string).toLowerCase()
  const results = loadLibraryIndex().filter(e => {
    const hit = e.title.toLowerCase().includes(q)
      || e.summary.toLowerCase().includes(q)
      || e.tags.some(t => t.toLowerCase().includes(q))
    return hit && (!tag || e.tags.includes(tag as string))
  }).slice(0, 6)

  if (results.length === 0) return { content: '藏经阁中未找到相关文档。', brief: '无匹配结果' }
  return {
    content: JSON.stringify(results),
    brief:   `找到 ${results.length} 篇相关文档`,
  }
}, { displayName: '检索藏经阁' })

registerTool({
  name:        'list_library',
  description: '列出藏经阁已收藏文档，可按分类筛选',
  parameters: {
    type: 'object',
    properties: {
      category: { type: 'string', description: '分类过滤（可选）' },
      limit:    { type: 'number', description: '返回数量，默认 10' },
    },
    required: [],
  },
}, async ({ category, limit = 10 }) => {
  const all      = loadLibraryIndex()
  const filtered = category ? all.filter(e => e.category === category as string) : all
  const result   = filtered.slice(0, limit as number)
  return {
    content: JSON.stringify(result),
    brief:   `共 ${all.length} 篇，返回 ${result.length} 篇`,
  }
}, { displayName: '列出藏经阁' })
