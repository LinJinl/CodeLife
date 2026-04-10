/**
 * 统一数据入口 — 所有页面的 Server Component 都从这里取数据
 *
 * 缓存策略（Next.js 16 旧模型 / 不启用 cacheComponents）：
 *   - 用 unstable_cache 包装每个数据源，绑定 cache tag
 *   - Webhook 触发时用 revalidateTag('blog'|'github'|'leetcode') 按需失效
 *   - 页面级 export const revalidate 作为兜底的时间驱动刷新
 */

import { unstable_cache } from 'next/cache'
import config from '../../codelife.config'
import { createBlogAdapter }     from './adapters/blog'
import { createGithubAdapter }   from './adapters/github'
import { createLeetcodeAdapter } from './adapters/leetcode'
import { getRealmStatus }        from './cultivation/realm'

// ── Adapter 实例（模块级单例，不重复初始化） ──────────────────
const blog = createBlogAdapter(config.blog, config.cultivation)

const github = (config.github.enabled && config.github.token)
  ? createGithubAdapter(config.github, config.cultivation)
  : null

const leetcode = config.leetcode.enabled
  ? createLeetcodeAdapter(config.leetcode, config.cultivation)
  : null

// ── Cache TTL（秒）从 config 读取 ─────────────────────────────
const GITHUB_TTL   = config.github.revalidate   ?? 3600
const LEETCODE_TTL = config.leetcode.revalidate  ?? 86400
const BLOG_TTL     = 3600

// ── 带 tag 的缓存包装 ──────────────────────────────────────────
// 注意：.catch() 必须放在 unstable_cache「外面」，
// 否则错误会被缓存成 null/[]，导致后续请求永远拿到空数据。
// unstable_cache 内部 reject 时不会缓存结果，外部 catch 则兜底不让页面崩溃。

const cachedBlogPosts = unstable_cache(
  () => blog.getPosts(),
  ['blog-posts', config.blog.provider],
  { tags: ['blog'], revalidate: BLOG_TTL },
)

const cachedGithubStats = unstable_cache(
  () => github?.getStats() ?? Promise.resolve(null),
  ['github-stats'],
  { tags: ['github'], revalidate: GITHUB_TTL },
)

const cachedGithubRepos = unstable_cache(
  () => github?.getRepos() ?? Promise.resolve([]),
  ['github-repos'],
  { tags: ['github'], revalidate: GITHUB_TTL },
)

const cachedGithubCommits = unstable_cache(
  () => github?.getRecentCommits(30) ?? Promise.resolve([]),
  ['github-commits'],
  { tags: ['github'], revalidate: GITHUB_TTL },
)

const cachedLeetcodeStats = unstable_cache(
  () => leetcode?.getStats() ?? Promise.resolve(null),
  ['leetcode-stats'],
  { tags: ['leetcode'], revalidate: LEETCODE_TTL },
)

const cachedLeetcodeProblems = unstable_cache(
  () => leetcode?.getProblems() ?? Promise.resolve([]),
  ['leetcode-problems'],
  { tags: ['leetcode'], revalidate: LEETCODE_TTL },
)

// ── 公开数据函数 ───────────────────────────────────────────────
export async function getBlogPosts() { return cachedBlogPosts().catch(() => []) }

// 单篇详情：meta 来自已缓存的列表（无额外 Notion 请求），正文按 pageId 单独缓存
// 注意：不加 .catch()，让 Notion 报错直接抛出而非缓存为 null
const cachedPostContent = unstable_cache(
  (pageId: string) => blog.getPostContentById(pageId),
  ['blog-post-content'],
  { tags: ['blog'], revalidate: BLOG_TTL },
)

export async function getBlogPost(slug: string) {
  const posts = await cachedBlogPosts()
  const meta  = posts.find(p => p.slug === slug)
  if (!meta) return null
  try {
    const detail = await cachedPostContent(meta.id)
    return { ...meta, ...detail }
  } catch {
    return null
  }
}

export async function getGithubStats()   { return cachedGithubStats().catch(() => null) }
export async function getGithubRepos()   { return cachedGithubRepos().catch(() => []) }
export async function getGithubCommits() { return cachedGithubCommits().catch(() => []) }

export async function getLeetcodeStats()    { return cachedLeetcodeStats().catch(() => null) }
export async function getLeetcodeProblems() { return cachedLeetcodeProblems().catch(() => []) }

export async function getDashboardData() {
  const [posts, lc, gh] = await Promise.all([
    cachedBlogPosts(),
    cachedLeetcodeStats(),
    cachedGithubStats(),
  ])

  const blogPoints  = posts.reduce((s, p) => s + p.pointsEarned, 0)
  const lcPoints    = lc?.totalPoints  ?? 0
  const ghPoints    = gh?.totalPoints  ?? 0
  const totalPoints = blogPoints + lcPoints + ghPoints

  const realm = getRealmStatus(totalPoints, config.realms)

  // unstable_cache 会把 Date 序列化为 ISO 字符串，统一用 dateStr 传递
  const recentActivity = posts
    .slice(0, 10)
    .map(p => ({
      type:    'blog' as const,
      dateStr: typeof p.publishedAt === 'string'
        ? p.publishedAt
        : (p.publishedAt as Date).toISOString(),
      title:  p.title,
      slug:   p.slug,
      points: p.pointsEarned,
      label:  p.pointsLabel,
    }))

  return {
    realm,
    totalPoints,
    blogPoints,
    lcPoints,
    ghPoints,
    blogCount:  posts.length,
    lcSolved:   lc?.totalSolved  ?? 0,
    ghCommits:  gh?.totalCommits ?? 0,
    streak:     gh?.currentStreak ?? 0,
    recentActivity,
    config:     config.site,
  }
}

export { config }
