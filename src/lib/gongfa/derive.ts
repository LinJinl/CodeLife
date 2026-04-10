/**
 * 从博客文章 + 刷题记录 推导出功法知识图谱
 *
 * 节点规则：
 *  - 博客 category  → category 节点（点击跳转 /blog?category=xxx）
 *  - 博客 tags      → tag 节点（点击跳转 /blog?tag=xxx）
 *  - 同一篇文章的 category ↔ tag、tag ↔ tag → 边（共现）
 *  - 刷题 category（动态规划/滑动窗口/…） → algo 节点（细粒度分类）
 *  - 刷题语言 → language 节点，与对应 algo 节点相连
 *  - 权重 = log₂(rawCount + 1) → 归一化到 0–100
 */

import type { SkillGraph, SkillNode, SkillEdge, SkillGroup, SkillSource } from './types'

interface NodeAccum {
  id:      string
  name:    string
  group:   SkillGroup
  count:   number
  sources: SkillSource[]
  url?:    string
}

type EdgeKey = string

export function deriveSkillGraph(
  posts: {
    title:       string
    category:    string
    tags:        string[]
    wordCount:   number
    publishedAt: string | Date
  }[],
  problems: {
    title:      string
    difficulty: 'easy' | 'medium' | 'hard'
    category:   string   // 算法分类（动态规划、滑动窗口等）
    solvedAt:   string | Date
    language:   string
  }[],
): SkillGraph {

  const nodeMap    = new Map<string, NodeAccum>()
  const edgeCounts = new Map<EdgeKey, number>()

  function nodeId(name: string) {
    return name.toLowerCase().replace(/\s+/g, '_')
  }

  function ensure(name: string, group: SkillGroup, url?: string) {
    const id = nodeId(name)
    if (!nodeMap.has(id)) {
      nodeMap.set(id, { id, name, group, count: 0, sources: [], url })
    }
    return id
  }

  function addSource(id: string, src: SkillSource) {
    const n = nodeMap.get(id)!
    n.count++
    if (n.sources.length < 20) n.sources.push(src)
  }

  function addEdge(a: string, b: string) {
    if (a === b) return
    const key: EdgeKey = a < b ? `${a}__${b}` : `${b}__${a}`
    edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1)
  }

  // ── 博客文章 ────────────────────────────────────────────────

  for (const post of posts) {
    const date = (typeof post.publishedAt === 'string'
      ? post.publishedAt
      : (post.publishedAt as Date).toISOString()
    ).slice(0, 10)

    const catId = ensure(
      post.category,
      'category',
      `/blog?category=${encodeURIComponent(post.category)}`,
    )
    addSource(catId, { type: 'blog', title: post.title, date, detail: `${post.wordCount} 字` })

    const tagIds: string[] = []
    for (const tag of post.tags) {
      const tid = ensure(tag, 'tag', `/blog?tag=${encodeURIComponent(tag)}`)
      addSource(tid, { type: 'blog', title: post.title, date })
      tagIds.push(tid)
    }

    for (const tid of tagIds) addEdge(catId, tid)
    for (let i = 0; i < tagIds.length; i++) {
      for (let j = i + 1; j < tagIds.length; j++) {
        addEdge(tagIds[i], tagIds[j])
      }
    }
  }

  // ── LeetCode ────────────────────────────────────────────────
  // 用 category（细粒度分类）作为 algo 节点名；未填分类则退回到难度标签

  const diffFallback: Record<string, string> = {
    easy:   '入门算法',
    medium: '进阶算法',
    hard:   '困难算法',
  }

  for (const p of problems) {
    const date = (typeof p.solvedAt === 'string'
      ? p.solvedAt
      : (p.solvedAt as Date).toISOString()
    ).slice(0, 10)

    const algoName = p.category?.trim() || diffFallback[p.difficulty] || '算法'
    const algoId   = ensure(algoName, 'algo')   // algo 节点不跳转
    addSource(algoId, { type: 'leetcode', title: p.title, date, detail: p.difficulty })

    if (p.language) {
      const langId = ensure(p.language, 'language')
      addSource(langId, { type: 'leetcode', title: p.title, date })
      addEdge(algoId, langId)
    }
  }

  // ── 归一化权重 ────────────────────────────────────────────────

  const rawCounts = [...nodeMap.values()].map(n => n.count)
  const maxLog    = Math.log2(Math.max(...rawCounts, 1) + 1)

  const nodes: SkillNode[] = [...nodeMap.values()].map(n => ({
    id:       n.id,
    name:     n.name,
    group:    n.group,
    weight:   maxLog > 0 ? Math.round((Math.log2(n.count + 1) / maxLog) * 100) : 0,
    rawCount: n.count,
    sources:  n.sources,
    url:      n.url,
  }))

  // 过滤只有 1 条来源且没有任何边的孤立叶子（噪声）
  const connectedIds = new Set<string>()
  for (const key of edgeCounts.keys()) {
    const [a, b] = key.split('__')
    connectedIds.add(a); connectedIds.add(b)
  }
  const filteredNodes = nodes.filter(n => n.rawCount > 1 || connectedIds.has(n.id))
  const filteredIds   = new Set(filteredNodes.map(n => n.id))

  const edges: SkillEdge[] = []
  for (const [key, w] of edgeCounts) {
    const [a, b] = key.split('__')
    if (filteredIds.has(a) && filteredIds.has(b)) {
      edges.push({ source: a, target: b, weight: w })
    }
  }

  return { nodes: filteredNodes, edges }
}
