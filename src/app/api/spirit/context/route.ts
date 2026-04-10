/**
 * GET /api/spirit/context?path=/blog/my-slug
 * 根据当前页面路径返回结构化上下文文本，供器灵注入对话
 */

import { NextRequest } from 'next/server'
import { getBlogPost, getGithubStats, getGithubRepos, getLeetcodeStats, getLeetcodeProblems } from '@/lib/data'
import { loadLibraryIndex } from '@/lib/spirit/tools/library'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const path = req.nextUrl.searchParams.get('path') ?? '/'

  try {
    const text = await buildContext(path)
    return Response.json({ path, text })
  } catch (err) {
    return Response.json({ path, text: '', error: String(err) }, { status: 500 })
  }
}

async function buildContext(path: string): Promise<string> {
  // ── 博客文章详情 /blog/[slug] ─────────────────────────────
  const blogMatch = path.match(/^\/blog\/(.+)$/)
  if (blogMatch) {
    const slug = blogMatch[1]
    const post = await getBlogPost(slug)
    if (!post) return '未找到该文章。'
    const lines = [
      `【当前阅读的文章】`,
      `标题：${post.title}`,
      `分类：${post.category}`,
      `发布：${post.publishedAt}`,
      `字数：${post.wordCount}`,
      post.tags.length ? `标签：${post.tags.join('、')}` : '',
      ``,
      `正文：`,
      post.content ?? post.excerpt ?? '（正文内容不可用）',
    ]
    return lines.filter(l => l !== undefined).join('\n')
  }

  // ── 博客列表 /blog ────────────────────────────────────────
  if (path === '/blog' || path.startsWith('/blog?')) {
    const { getBlogPosts } = await import('@/lib/data')
    const posts = await getBlogPosts()
    const lines = [
      `【心法卷轴 — 全部文章列表】`,
      `共 ${posts.length} 篇`,
      ``,
      ...posts.slice(0, 20).map(p =>
        `- 《${p.title}》[${p.category}] ${new Date(p.publishedAt).toLocaleDateString('zh-CN')} ${p.wordCount}字`
      ),
    ]
    return lines.join('\n')
  }

  // ── 藏经阁 /resources ────────────────────────────────────
  if (path.startsWith('/resources')) {
    const entries = loadLibraryIndex()
    const lines = [
      `【藏经阁 — 已收藏典籍】`,
      `共 ${entries.length} 篇`,
      ``,
      ...entries.map(e =>
        `- 《${e.title}》[${e.category}] 标签：${e.tags.join('、')}\n  摘要：${e.summary}`
      ),
    ]
    return lines.join('\n')
  }

  // ── GitHub /github ────────────────────────────────────────
  if (path === '/github') {
    const [stats, repos] = await Promise.all([getGithubStats(), getGithubRepos()])
    if (!stats) return '暂无 GitHub 数据'
    const lines = [
      `【铸剑记录 — GitHub 数据】`,
      `总 commit：${stats.totalCommits}　连续打卡：${stats.currentStreak} 天`,
      ``,
      `主要仓库：`,
      ...repos.slice(0, 10).map(r =>
        `- ${r.name}：${r.description ?? '无描述'} [${r.language ?? '未知'}] ★${r.stars}`
      ),
    ]
    return lines.join('\n')
  }

  // ── LeetCode /leetcode ────────────────────────────────────
  if (path === '/leetcode') {
    const [stats, problems] = await Promise.all([getLeetcodeStats(), getLeetcodeProblems()])
    if (!stats) return '暂无 LeetCode 数据'
    const lines = [
      `【铸剑记录 — LeetCode 数据】`,
      `已解决：${stats.totalSolved} 题　简单：${stats.easy}　中等：${stats.medium}　困难：${stats.hard}`,
      ``,
      `近期题目：`,
      ...problems.slice(0, 15).map(p =>
        `- ${p.title} [${p.difficulty}${p.category ? '·' + p.category : ''}]`
      ),
    ]
    return lines.join('\n')
  }

  // ── 主页 / ────────────────────────────────────────────────
  if (path === '/') {
    const { getDashboardData } = await import('@/lib/data')
    const data = await getDashboardData()
    const lines = [
      `【修士当前状态】`,
      `境界：${data.realm.name}${data.realm.stage ?? ''}`,
      `总修为：${data.totalPoints}`,
      `著述：${data.blogCount} 篇　铸剑：${data.lcSolved} 次　声望：${data.ghCommits} commit`,
      `连续打卡：${data.streak} 天`,
    ]
    return lines.join('\n')
  }

  return `当前页面（${path}）暂无可提取的结构化内容。`
}
