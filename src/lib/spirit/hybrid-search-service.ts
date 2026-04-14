/**
 * HybridSearchService — 封装 embedding 缓存读写样板
 *
 * 消除了 codelife.ts / library.ts 中各自重复的 makeEmbedder() 定义
 * 和 getCachedVec / onNewVecs 回调装配代码。
 *
 * 用法：
 *   const svc = new HybridSearchService(getLibEmbeddings, saveLibEmbeddings)
 *   const results = await svc.search(docs, query, topK)
 */

import config from '../../../codelife.config'
import { hybridSearch, type HybridDoc, type HybridResult } from './hybrid-search'

/** 单例 embedder 构造函数（供需要直接 embed 的地方复用，如 collect_document） */
export function makeEmbedder() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { OpenAIEmbeddings } = require('@langchain/openai')
  return new OpenAIEmbeddings({
    apiKey:    config.spirit?.apiKey,
    modelName: 'text-embedding-3-small',
    ...(config.spirit?.baseURL ? { configuration: { baseURL: config.spirit.baseURL } } : {}),
  })
}

export class HybridSearchService {
  constructor(
    private getEmbeddings: () => { id: string; vec: number[] }[],
    private saveEmbeddings: (entries: { id: string; vec: number[] }[]) => void,
  ) {}

  async search(docs: HybridDoc[], query: string, topK: number): Promise<HybridResult[]> {
    const cache    = this.getEmbeddings()
    const cacheMap = new Map(cache.map(e => [e.id, e.vec]))

    return hybridSearch(docs, query, {
      topK,
      embedder:     makeEmbedder(),
      getCachedVec: id => cacheMap.get(id),
      onNewVecs:    newVecs => {
        for (const { id, vec } of newVecs) cacheMap.set(id, vec)
        this.saveEmbeddings(
          Array.from(cacheMap.entries()).map(([id, vec]) => ({ id, vec })),
        )
      },
    })
  }
}
