/**
 * 混合检索引擎：BM25（MiniSearch）+ 向量检索（OpenAI Embedding）→ RRF 融合
 *
 * 用法：
 *   const results = await hybridSearch(docs, query, { topK: 5, embedder, vecCache })
 *
 * 适用于任意文档集合，调用方负责 embedding 缓存的持久化。
 */

import MiniSearch from 'minisearch'
import type { Embeddings } from '@langchain/core/embeddings'

// ── 类型 ──────────────────────────────────────────────────────

export interface HybridDoc {
  id:   string
  text: string          // 供 BM25 和 embedding 使用的完整文本
}

export interface HybridResult {
  id:       string
  rrfScore: number
  bm25Rank: number | null   // null = BM25 未召回
  vecRank:  number | null   // null = 向量检索未召回
}

export interface HybridSearchOpts {
  topK?:       number          // 最终返回数量，默认 5
  bm25Top?:    number          // BM25 召回数，默认 topK * 4
  vecTop?:     number          // 向量召回数，默认 topK * 4
  embedder?:   Embeddings      // 不传则跳过向量检索，退化为纯 BM25
  /** 按 id 查已有缓存向量，返回 undefined 表示需要重新计算 */
  getCachedVec?: (id: string) => number[] | undefined
  /** 新计算出的向量回调，用于持久化 */
  onNewVecs?:  (vecs: { id: string; vec: number[] }[]) => void
}

// ── RRF ───────────────────────────────────────────────────────

const RRF_K = 60

function rrfScore(ranks: (number | null)[]): number {
  return ranks.reduce<number>((s, r) => r !== null ? s + 1 / (RRF_K + r) : s, 0)
}

// ── Cosine 相似度 ─────────────────────────────────────────────

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0
}

// ── BM25（MiniSearch）─────────────────────────────────────────

/**
 * 中英混排 tokenizer：
 *   英文 / 数字 → 按单词分割（MiniSearch 默认行为）
 *   中文 → 字符级 bigram，保证多字词也能被召回
 */
function tokenize(text: string): string[] {
  const tokens: string[] = []
  // 先提取所有英文/数字词
  const latin = text.match(/[a-zA-Z0-9_\-./]+/g) ?? []
  tokens.push(...latin.map(t => t.toLowerCase()))
  // 中文字符做 bigram
  const hanzi = text.replace(/[^\u4e00-\u9fff]/g, '')
  for (let i = 0; i < hanzi.length - 1; i++) {
    tokens.push(hanzi[i] + hanzi[i + 1])
  }
  // 单个汉字也加入（兜底短词）
  for (const ch of hanzi) tokens.push(ch)
  return tokens
}

function bm25Search(docs: HybridDoc[], query: string, topN: number): { id: string; rank: number }[] {
  if (docs.length === 0) return []

  const ms = new MiniSearch<HybridDoc>({
    fields:         ['text'],
    idField:        'id',
    tokenize,
    processTerm:    t => t.toLowerCase(),
    searchOptions:  { boost: { text: 1 }, fuzzy: 0.2, prefix: true },
  })
  ms.addAll(docs)

  const queryTokens = tokenize(query)
  const queryStr    = queryTokens.join(' ') || query

  const hits = ms.search(queryStr, { combineWith: 'OR' })
  return hits.slice(0, topN).map((h, i) => ({ id: h.id, rank: i }))
}

// ── 向量检索 ──────────────────────────────────────────────────

async function vectorSearch(
  docs:         HybridDoc[],
  query:        string,
  topN:         number,
  embedder:     Embeddings,
  getCachedVec: (id: string) => number[] | undefined,
  onNewVecs:    (vecs: { id: string; vec: number[] }[]) => void,
): Promise<{ id: string; rank: number; score: number }[]> {
  if (docs.length === 0) return []

  // 找出需要计算 embedding 的文档
  const missing = docs.filter(d => !getCachedVec(d.id))
  if (missing.length > 0) {
    const vecs = await embedder.embedDocuments(missing.map(d => d.text))
    const newEntries = missing.map((d, i) => ({ id: d.id, vec: vecs[i] }))
    onNewVecs(newEntries)
    // 写入本地缓存供后续查询使用
    for (const e of newEntries) {
      // getCachedVec 可能是闭包，不会自动感知新值；onNewVecs 负责持久化后调用方刷新
    }
    // 临时合并到本次查询
    const tempMap = new Map(newEntries.map(e => [e.id, e.vec]))
    const queryVec = await embedder.embedQuery(query)
    return docs
      .map(d => {
        const vec = getCachedVec(d.id) ?? tempMap.get(d.id)
        return { id: d.id, score: vec ? cosine(queryVec, vec) : 0 }
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, topN)
      .map((h, i) => ({ ...h, rank: i }))
  }

  const queryVec = await embedder.embedQuery(query)
  return docs
    .map(d => ({ id: d.id, score: cosine(queryVec, getCachedVec(d.id)!) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
    .map((h, i) => ({ ...h, rank: i }))
}

// ── 主入口 ────────────────────────────────────────────────────

export async function hybridSearch(
  docs:  HybridDoc[],
  query: string,
  opts:  HybridSearchOpts = {},
): Promise<HybridResult[]> {
  const {
    topK       = 5,
    bm25Top    = topK * 4,
    vecTop     = topK * 4,
    embedder,
    getCachedVec = () => undefined,
    onNewVecs    = () => {},
  } = opts

  // ── BM25 召回 ────────────────────────────────────────────
  const bm25Hits = bm25Search(docs, query, bm25Top)
  const bm25Map  = new Map(bm25Hits.map(h => [h.id, h.rank]))

  // ── 向量召回（有 embedder 才跑）────────────────────────
  let vecMap = new Map<string, number>()
  if (embedder) {
    try {
      const vecHits = await vectorSearch(docs, query, vecTop, embedder, getCachedVec, onNewVecs)
      vecMap = new Map(vecHits.map(h => [h.id, h.rank]))
    } catch (err) {
      console.warn('[hybrid-search] 向量检索失败，降级为纯 BM25:', err)
    }
  }

  // ── RRF 融合 ─────────────────────────────────────────────
  // 候选集 = BM25 + 向量 的并集
  const candidates = new Set([...bm25Map.keys(), ...vecMap.keys()])

  const fused = Array.from(candidates).map(id => ({
    id,
    bm25Rank: bm25Map.has(id) ? bm25Map.get(id)! : null,
    vecRank:  vecMap.has(id)  ? vecMap.get(id)!  : null,
    rrfScore: rrfScore([
      bm25Map.has(id) ? bm25Map.get(id)! : null,
      vecMap.has(id)  ? vecMap.get(id)!  : null,
    ]),
  }))

  return fused.sort((a, b) => b.rrfScore - a.rrfScore).slice(0, topK)
}
