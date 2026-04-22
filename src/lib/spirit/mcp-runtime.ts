import config from '../../../codelife.config'
import { invalidateAgentCache } from './langgraph/agents'
import { invalidateGraphCache } from './langgraph/graph'
import { invalidateToolCache } from './langgraph/tools'
import { loadMCPServers } from './mcp-loader'

type MCPPreloadResult = { name: string; ok: boolean; error?: string; toolCount?: number }

let preloadPromise: Promise<MCPPreloadResult[]> | null = null

export async function ensureConfiguredMCPServersLoaded(): Promise<MCPPreloadResult[]> {
  const servers = config.spirit?.mcpServers ?? []
  if (servers.length === 0) return []

  if (!preloadPromise) {
    preloadPromise = loadMCPServers(servers).then(results => {
      invalidateToolCache()
      invalidateAgentCache()
      invalidateGraphCache()

      if (results.some(result => !result.ok)) {
        preloadPromise = null
      }
      return results
    })
  }

  return preloadPromise
}
