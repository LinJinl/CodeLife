/**
 * Notion Blog Adapter
 *
 * 设置步骤：
 *   1. https://www.notion.so/my-integrations → 新建 Internal Integration
 *   2. 复制 token → .env.local: NOTION_TOKEN=secret_xxx
 *   3. 打开你的 Notion 数据库 → 右上角「...」→ Add Connection → 选刚创建的 Integration
 *   4. 复制数据库 ID（URL: notion.so/xxx/{这里}?v=...）→ .env.local: NOTION_DATABASE_ID=xxx
 *
 * Notion 数据库推荐列结构（Property 名可在 codelife.config.ts 的 blog.notion.fieldMap 里映射）：
 *   Name        title          文章标题（必须）
 *   Slug        rich_text      URL slug，留空则自动从标题生成
 *   Category    select         分类
 *   Tags        multi_select   标签
 *   Published   checkbox       是否公开（未勾选则不显示）
 *   Date        date           发布日期
 *   Excerpt     rich_text      摘要（可选）
 *
 * 字数缓存（content/blog_wc_cache.json）：
 *   { [pageId]: { wordCount, lastEdited } }
 *   首次遇到某页面或 last_edited_time 变更时才拉正文重算字数，其余情况直接读缓存。
 */

import fs   from 'fs'
import path from 'path'
import { Client } from '@notionhq/client'
import { NotionToMarkdown } from 'notion-to-md'
import type { PageObjectResponse } from '@notionhq/client/build/src/api-endpoints'
import type { BlogAdapter, BlogPost } from './types'
import type { BlogConfig, CultivationConfig } from '@/lib/config'

// ── 字数持久缓存 ───────────────────────────────────────────────

const WC_CACHE_FILE = path.resolve(process.cwd(), 'content/blog_wc_cache.json')

interface WcEntry { wordCount: number; lastEdited: string }
type WcCache = Record<string, WcEntry>

function loadWcCache(): WcCache {
  try { return JSON.parse(fs.readFileSync(WC_CACHE_FILE, 'utf-8')) } catch { return {} }
}

function saveWcCache(cache: WcCache) {
  fs.mkdirSync(path.dirname(WC_CACHE_FILE), { recursive: true })
  fs.writeFileSync(WC_CACHE_FILE, JSON.stringify(cache, null, 2))
}

// ── 工具函数 ───────────────────────────────────────────────────

function countWords(text: string): number {
  const cjk   = (text.match(/[\u4e00-\u9fa5]/g) ?? []).length
  const words = (text.match(/[a-zA-Z]+/g) ?? []).length
  return cjk + words
}

function calcPoints(wc: number, cult: CultivationConfig) {
  if (wc >= 2000) return { points: cult.blog.longPost,  label: '大悟' }
  if (wc >= 500)  return { points: cult.blog.shortPost, label: '顿悟' }
  return { points: 0, label: '' }
}

function slugify(text: string): string {
  const result = text
    .toLowerCase()
    .replace(/[\u4e00-\u9fa5]+/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return result
}

type RichTextItem = { plain_text: string }

function getText(prop: { type: string; rich_text?: RichTextItem[]; title?: RichTextItem[] }): string {
  if (prop.type === 'title')     return (prop.title     ?? []).map(t => t.plain_text).join('')
  if (prop.type === 'rich_text') return (prop.rich_text ?? []).map(t => t.plain_text).join('')
  return ''
}

export class NotionBlogAdapter implements BlogAdapter {
  private notion: Client
  private n2m:    NotionToMarkdown
  private cfg:    NonNullable<BlogConfig['notion']>
  private cult:   CultivationConfig

  constructor(config: BlogConfig, cult: CultivationConfig) {
    if (!config.notion) throw new Error('[CodeLife] blog.notion config is required')
    this.cfg   = config.notion
    this.cult  = cult
    this.notion = new Client({ auth: this.cfg.token })
    this.n2m    = new NotionToMarkdown({ notionClient: this.notion })
  }

  /** 查询数据库并返回元数据列表（不拉正文，速度快） */
  private async queryPages() {
    const fm = this.cfg.fieldMap ?? {}
    const titleField     = fm.title       ?? 'Name'
    const slugField      = fm.slug        ?? 'Slug'
    const categoryField  = fm.category    ?? 'Category'
    const publishedField = fm.published   ?? 'Published'
    const dateField      = fm.publishedAt ?? 'Date'

    const db = await this.notion.databases.retrieve({ database_id: this.cfg.databaseId })
    const publishedProp = db.properties[publishedField] as { type: string } | undefined
    const publishedType = publishedProp?.type ?? 'checkbox'

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const filter: Record<string, any> = { property: publishedField }
    if (publishedType === 'checkbox') {
      filter.checkbox = { equals: true }
    } else if (publishedType === 'select' || publishedType === 'status') {
      filter[publishedType] = { equals: 'Published' }
    }

    const response = await this.notion.databases.query({
      database_id: this.cfg.databaseId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      filter: filter as any,
      sorts: [{ property: dateField, direction: 'descending' }],
    })

    return { pages: response.results as PageObjectResponse[], titleField, slugField, categoryField, dateField }
  }

  /** 把单个 page 元数据 + 字数 转成 BlogPost */
  private pageToPost(
    page: PageObjectResponse,
    titleField: string, slugField: string, categoryField: string, dateField: string,
    wordCount: number,
  ): BlogPost {
    const props = page.properties

    const title = props[titleField]
      ? getText(props[titleField] as Parameters<typeof getText>[0])
      : 'Untitled'

    const slugRaw  = props[slugField] ? getText(props[slugField] as Parameters<typeof getText>[0]) : ''
    const slugClean = slugRaw.replace(/^[#\s]+$/, '')
    const slug = slugClean || slugify(title) || page.id

    const category = (() => {
      const p = props[categoryField]
      if (!p) return '未分类'
      if ('select' in p && p.select) return p.select.name ?? '未分类'
      return '未分类'
    })()

    const tags = (() => {
      const p = props['Tags']
      if (!p || !('multi_select' in p)) return []
      return p.multi_select.map((t: { name: string }) => t.name)
    })()

    const publishedAt = (() => {
      const p = props[dateField]
      if (!p || !('date' in p) || !p.date) return new Date()
      return new Date(p.date.start)
    })()

    const { points, label } = calcPoints(wordCount, this.cult)

    return {
      id:             page.id,
      slug,
      title,
      content:        '',
      excerpt:        '',
      category,
      tags,
      wordCount,
      readingMinutes: Math.max(1, Math.round(wordCount / 300)),
      publishedAt,
      pointsEarned:   points,
      pointsLabel:    label,
    }
  }

  async getPosts(): Promise<BlogPost[]> {
    const { pages, titleField, slugField, categoryField, dateField } = await this.queryPages()

    const cache   = loadWcCache()
    const missing: PageObjectResponse[] = []

    for (const page of pages) {
      const entry = cache[page.id]
      if (!entry || entry.lastEdited !== page.last_edited_time) {
        missing.push(page)
      }
    }

    // 并行拉取缺失/变更页面的正文并计算字数
    if (missing.length > 0) {
      await Promise.all(missing.map(async page => {
        try {
          const mdBlocks = await this.n2m.pageToMarkdown(page.id)
          const content  = this.n2m.toMarkdownString(mdBlocks).parent
          cache[page.id] = { wordCount: countWords(content), lastEdited: page.last_edited_time }
        } catch {
          cache[page.id] = { wordCount: 0, lastEdited: page.last_edited_time }
        }
      }))
      saveWcCache(cache)
    }

    return pages.map(page =>
      this.pageToPost(page, titleField, slugField, categoryField, dateField, cache[page.id]?.wordCount ?? 0)
    )
  }

  async getPost(slug: string): Promise<BlogPost | null> {
    const { pages, titleField, slugField, categoryField, dateField } = await this.queryPages()
    const page = pages.find(p => {
      const meta = this.pageToPost(p, titleField, slugField, categoryField, dateField, 0)
      return meta.slug === slug
    })
    if (!page) return null

    const mdBlocks = await this.n2m.pageToMarkdown(page.id)
    const content  = this.n2m.toMarkdownString(mdBlocks).parent
    const wc       = countWords(content)
    const { points, label } = calcPoints(wc, this.cult)

    // 顺便更新字数缓存
    const cache = loadWcCache()
    cache[page.id] = { wordCount: wc, lastEdited: page.last_edited_time }
    saveWcCache(cache)

    const base = this.pageToPost(page, titleField, slugField, categoryField, dateField, wc)
    return {
      ...base,
      content,
      excerpt:        content.slice(0, 160).replace(/\n/g, ' ') + '…',
      wordCount:      wc,
      readingMinutes: Math.max(1, Math.round(wc / 300)),
      pointsEarned:   points,
      pointsLabel:    label,
    }
  }
}
