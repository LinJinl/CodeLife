import { createHash } from 'crypto'
import config from '../../../codelife.config'
import { createBlogAdapter } from '../adapters/blog'
import type { BlogPost } from '../adapters/blog/types'
import {
  getBlogPostsCache,
  saveBlogPostsCache,
  type CachedBlogPost,
} from './memory'

export function blogPublishedAt(post: { publishedAt: string | Date }): string {
  return typeof post.publishedAt === 'string' ? post.publishedAt : post.publishedAt.toISOString()
}

export function blogDocId(post: { slug: string; title: string; publishedAt: string | Date }): string {
  const hash = createHash('sha1')
    .update(`${post.slug}\n${post.title}\n${blogPublishedAt(post)}`)
    .digest('hex')
    .slice(0, 12)
  return `blog:${post.slug}:${hash}`
}

function normalizeContent(text: string): string {
  return text
    .replace(/<[^>]+>/g, ' ')
    .replace(/[`*_>#~-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function fromPost(post: BlogPost, content: string): CachedBlogPost {
  return {
    slug:         post.slug,
    title:        post.title,
    excerpt:      post.excerpt ?? '',
    content,
    category:     post.category,
    tags:         post.tags ?? [],
    wordCount:    post.wordCount,
    publishedAt:  blogPublishedAt(post),
    pointsEarned: post.pointsEarned,
  }
}

export interface BlogCacheRefreshResult {
  posts: CachedBlogPost[]
  total: number
  withContent: number
  fetchedContent: number
  failedContent: number
}

export async function refreshBlogPostsCache(options: {
  includeContent?: boolean
  forceContent?: boolean
  concurrency?: number
} = {}): Promise<BlogCacheRefreshResult> {
  const adapter = createBlogAdapter(config.blog, config.cultivation)
  const livePosts = await adapter.getPosts()
  const existing = getBlogPostsCache()
  const existingMap = new Map(existing.map(post => [blogDocId(post), post]))
  const nextMap = new Map<string, CachedBlogPost>()

  for (const post of livePosts) {
    const key = blogDocId(post)
    const cached = existingMap.get(key)
    const content = cached?.content || normalizeContent(post.content || post.excerpt || '')
    nextMap.set(key, fromPost(post, content))
  }

  let fetchedContent = 0
  let failedContent = 0

  if (options.includeContent) {
    const needContent = livePosts.filter(post => {
      const cached = nextMap.get(blogDocId(post))
      return options.forceContent || !cached?.content
    })
    const concurrency = Math.max(1, Math.min(options.concurrency ?? 3, 6))

    for (let i = 0; i < needContent.length; i += concurrency) {
      const batch = needContent.slice(i, i + concurrency)
      await Promise.all(batch.map(async post => {
        try {
          const detail = await adapter.getPostContentById(post.id)
          const content = normalizeContent(detail.content || detail.excerpt || post.excerpt || '')
          nextMap.set(blogDocId(post), fromPost(post, content))
          fetchedContent++
        } catch {
          failedContent++
        }
      }))
    }
  }

  const posts = Array.from(nextMap.values()).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
  saveBlogPostsCache(posts)

  return {
    posts,
    total: posts.length,
    withContent: posts.filter(post => post.content.trim().length > 0).length,
    fetchedContent,
    failedContent,
  }
}
