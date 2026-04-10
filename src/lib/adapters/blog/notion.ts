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
 * Webhook 自动更新：
 *   Notion 官方 Webhook（Beta）需要申请。
 *   现阶段推荐：在 codelife.config.ts 中设置较短的 revalidate，或手动调用 /api/sync?source=blog
 */

import { Client } from '@notionhq/client'
import { NotionToMarkdown } from 'notion-to-md'
import type { PageObjectResponse } from '@notionhq/client/build/src/api-endpoints'
import type { BlogAdapter, BlogPost } from './types'
import type { BlogConfig, CultivationConfig } from '@/lib/config'

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
    .replace(/[\u4e00-\u9fa5]+/g, '')   // 纯中文标题不生成无意义的 slug
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return result  // 若为空则上层用 page.id 兜底
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

  /** 把单个 page 元数据转成不含正文的 BlogPost */
  private pageToMeta(
    page: PageObjectResponse,
    titleField: string, slugField: string, categoryField: string, dateField: string,
  ): BlogPost {
    const props = page.properties

    const title = props[titleField]
      ? getText(props[titleField] as Parameters<typeof getText>[0])
      : 'Untitled'

    const slugRaw = props[slugField]
      ? getText(props[slugField] as Parameters<typeof getText>[0])
      : ''
    const slugClean = slugRaw.replace(/^[#\s]+$/, '')   // 过滤掉 # 或纯空白占位符
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

    // 列表页用估算字数（基于标题），等 getPost() 拿到正文后再精算
    const estimatedWc = countWords(title) * 10
    const { points, label } = calcPoints(estimatedWc, this.cult)

    return {
      id:             page.id,
      slug,
      title,
      content:        '',      // 列表页不需要正文
      excerpt:        '',
      category,
      tags,
      wordCount:      0,
      readingMinutes: 1,
      publishedAt,
      pointsEarned:   points,
      pointsLabel:    label,
    }
  }

  async getPosts(): Promise<BlogPost[]> {
    const { pages, titleField, slugField, categoryField, dateField } = await this.queryPages()
    // 并行拉所有文章正文（比串行快 N 倍）
    return Promise.all(pages.map(async page => {
      const meta = this.pageToMeta(page, titleField, slugField, categoryField, dateField)
      const mdBlocks = await this.n2m.pageToMarkdown(page.id)
      const content  = this.n2m.toMarkdownString(mdBlocks).parent
      const wc       = countWords(content)
      const { points, label } = calcPoints(wc, this.cult)
      return {
        ...meta,
        content,
        excerpt:        content.slice(0, 160).replace(/\n/g, ' ') + '…',
        wordCount:      wc,
        readingMinutes: Math.max(1, Math.round(wc / 300)),
        pointsEarned:   points,
        pointsLabel:    label,
      }
    }))
  }

  async getPost(slug: string): Promise<BlogPost | null> {
    const { pages, titleField, slugField, categoryField, dateField } = await this.queryPages()
    const page = pages.find(p => {
      const meta = this.pageToMeta(p, titleField, slugField, categoryField, dateField)
      return meta.slug === slug
    })
    if (!page) return null

    const meta = this.pageToMeta(page, titleField, slugField, categoryField, dateField)

    // 只有单篇详情页才拉正文
    const mdBlocks = await this.n2m.pageToMarkdown(page.id)
    const content  = this.n2m.toMarkdownString(mdBlocks).parent
    const wc       = countWords(content)
    const { points, label } = calcPoints(wc, this.cult)

    return {
      ...meta,
      content,
      excerpt:        content.slice(0, 160).replace(/\n/g, ' ') + '…',
      wordCount:      wc,
      readingMinutes: Math.max(1, Math.round(wc / 300)),
      pointsEarned:   points,
      pointsLabel:    label,
    }
  }
}
