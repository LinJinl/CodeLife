import type { LeetcodeConfig, CultivationConfig } from '@/lib/config'
import { ManualLeetcodeAdapter } from './manual'
import { UnofficialLeetcodeAdapter } from './unofficial'

export * from './types'

export function createLeetcodeAdapter(config: LeetcodeConfig, cult: CultivationConfig) {
  switch (config.provider) {
    case 'unofficial': return new UnofficialLeetcodeAdapter(config, cult)
    case 'manual':
    default:           return new ManualLeetcodeAdapter(config, cult)
  }
}
