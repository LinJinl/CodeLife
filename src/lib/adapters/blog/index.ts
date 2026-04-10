import type { BlogAdapter } from './types'
import type { BlogConfig, CultivationConfig } from '@/lib/config'
import { LocalMDXAdapter } from './local-mdx'
import { NotionBlogAdapter } from './notion'
import { GhostBlogAdapter } from './ghost'

export * from './types'

export function createBlogAdapter(
  config: BlogConfig,
  cult: CultivationConfig,
): BlogAdapter {
  switch (config.provider) {
    case 'notion': return new NotionBlogAdapter(config, cult)
    case 'ghost':  return new GhostBlogAdapter(config, cult)
    case 'local':
    default:       return new LocalMDXAdapter(config, cult)
  }
}
