import fs from 'fs'
import path from 'path'
import matter from 'gray-matter'
import type { BlogAdapter, BlogPost } from './types'
import type { BlogConfig, CultivationConfig } from '@/lib/config'

function calcPoints(wordCount: number, cult: CultivationConfig) {
  if (wordCount >= 2000) return { points: cult.blog.longPost, label: '大悟' }
  if (wordCount >= 500)  return { points: cult.blog.shortPost, label: '顿悟' }
  return { points: 0, label: '' }
}

function countWords(text: string): number {
  // CJK 字符 + 英文单词
  const cjk = (text.match(/[\u4e00-\u9fa5]/g) || []).length
  const words = (text.match(/[a-zA-Z]+/g) || []).length
  return cjk + words
}

export class LocalMDXAdapter implements BlogAdapter {
  private dir: string
  private cult: CultivationConfig

  constructor(config: BlogConfig, cult: CultivationConfig) {
    this.dir = path.resolve(process.cwd(), config.localDir ?? './content/posts')
    this.cult = cult
  }

  async getPosts(): Promise<BlogPost[]> {
    if (!fs.existsSync(this.dir)) return []

    const files = fs.readdirSync(this.dir)
      .filter(f => f.endsWith('.mdx') || f.endsWith('.md'))

    const posts = files.map(file => {
      const raw = fs.readFileSync(path.join(this.dir, file), 'utf-8')
      const { data, content } = matter(raw)

      const slug    = (data.slug as string) || file.replace(/\.(mdx?|md)$/, '')
      const wc      = countWords(content)
      const { points, label } = calcPoints(wc, this.cult)

      const post: BlogPost = {
        id:             slug,
        slug,
        title:          data.title ?? slug,
        content,
        excerpt:        data.excerpt ?? content.slice(0, 160).replace(/\n/g, ' ') + '…',
        category:       data.category ?? '未分类',
        tags:           data.tags ?? [],
        wordCount:      wc,
        readingMinutes: Math.max(1, Math.round(wc / 300)),
        publishedAt:    new Date(data.date ?? data.publishedAt ?? Date.now()),
        pointsEarned:   points,
        pointsLabel:    label,
      }
      return post
    })

    return posts
      .filter(p => p.wordCount > 0)
      .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
  }

  async getPost(slug: string): Promise<BlogPost | null> {
    const posts = await this.getPosts()
    return posts.find(p => p.slug === slug) ?? null
  }
}
