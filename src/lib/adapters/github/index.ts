import type { GithubConfig, CultivationConfig } from '@/lib/config'
import { GithubGraphQLAdapter } from './graphql'

export * from './types'

export function createGithubAdapter(config: GithubConfig, cult: CultivationConfig) {
  return new GithubGraphQLAdapter(config, cult)
}
