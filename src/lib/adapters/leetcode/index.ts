import type { LeetcodeConfig, CultivationConfig } from '@/lib/config'
import { ManualLeetcodeAdapter }    from './manual'
import { UnofficialLeetcodeAdapter } from './unofficial'
import { LeetcodeCNAdapter }        from './leetcode-cn'

export * from './types'

export function createLeetcodeAdapter(config: LeetcodeConfig, cult: CultivationConfig) {
  switch (config.provider) {
    case 'cn':         return new LeetcodeCNAdapter(config, cult)
    case 'unofficial': return new UnofficialLeetcodeAdapter(config, cult)
    case 'manual':
    default:           return new ManualLeetcodeAdapter(config, cult)
  }
}
