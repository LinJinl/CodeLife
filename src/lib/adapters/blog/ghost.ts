/**
 * Ghost CMS Blog Adapter
 *
 * 使用前提：
 *   1. 在 Ghost Admin → Settings → Integrations → Add Custom Integration
 *   2. 复制 Content API Key → .env.local → GHOST_CONTENT_API_KEY
 *   3. 设置 .env.local → GHOST_URL=https://your-ghost-site.com
 *
 * 依赖：npm install @tryghost/content-api
 */

import type { BlogAdapter, BlogPost, PostContent } from './types'
import type { BlogConfig, CultivationConfig } from '@/lib/config'

function countWords(text: string): number {
  const cjk = (text.match(/[\u4e00-\u9fa5]/g) || []).length
  const words = (text.match(/[a-zA-Z]+/g) || []).length
  return cjk + words
}

export class GhostBlogAdapter implements BlogAdapter {
  constructor(
    private config: BlogConfig,
    private cult: CultivationConfig,
  ) {
    if (!config.ghost) throw new Error('[CodeLife] blog.ghost config is required')
  }

  async getPosts(): Promise<BlogPost[]> {
    // 按需安装：npm install @tryghost/content-api
    // 实现思路：
    //   const GhostContentAPI = require('@tryghost/content-api')
    //   const api = new GhostContentAPI({
    //     url:     this.config.ghost.url,
    //     key:     this.config.ghost.apiKey,
    //     version: this.config.ghost.version ?? 'v5.0',
    //   })
    //   const posts = await api.posts.browse({ limit: 'all', include: 'tags,authors' })
    //   return posts.map(p => ({ ... }))

    throw new Error(
      '[CodeLife] Ghost adapter: 请先运行 npm install @tryghost/content-api，' +
      '然后参考注释实现 getPosts()'
    )
  }

  async getPostContentById(_pageId: string): Promise<PostContent> {
    // Ghost adapter 未实现，与 getPosts() 共享同一 "未安装依赖" 错误
    throw new Error(
      '[CodeLife] Ghost adapter: 请先运行 npm install @tryghost/content-api，' +
      '然后参考注释实现 getPostContentById()'
    )
  }
}
