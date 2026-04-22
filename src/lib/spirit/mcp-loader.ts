/**
 * MCP 动态加载器
 *
 * 支持两种 transport：
 *   - http  : 连接已运行的 HTTP MCP server（StreamableHTTP / SSE）
 *   - stdio : 按需 spawn 子进程（npx / 本地可执行文件）
 *
 * 每个 server 只初始化一次（进程级单例），重复调用 loadMCPServer 幂等。
 */

import type { MCPServerConfig } from '@/lib/config'
import { registerMCPAdapter, getMCPAdapters, setNamespaceAgents } from './registry'
import type { MCPAdapter } from './registry'

// 已加载的 namespace 集合（避免重复注册）
const loadedNamespaces = new Set<string>()
const loadingNamespaces = new Map<string, Promise<{ ok: boolean; error?: string; toolCount?: number }>>()

// 运行时动态添加的服务器记录（重启后丢失，仅在进程内持久）
const runtimeServers: MCPServerConfig[] = []

/** 把服务器名转为合法命名空间：去空格、小写、特殊字符换下划线 */
function toNamespace(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '')
}

/** 创建 stdio MCP 适配器 */
async function createStdioAdapter(cfg: MCPServerConfig): Promise<MCPAdapter> {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js')

  const ns = cfg.namespace ?? toNamespace(cfg.name)
  const transport = new StdioClientTransport({
    command: cfg.command!,
    args:    cfg.args ?? [],
    env:     cfg.env ? { ...process.env, ...cfg.env } as Record<string, string> : undefined,
  })
  const client = new Client({ name: 'codelife-spirit', version: '1.0.0' }, { capabilities: {} })
  await client.connect(transport)

  const toolsResp = await client.listTools()

  return {
    namespace: ns,
    name:      cfg.name,
    async listTools() {
      return toolsResp.tools.map(t => ({
        definition: {
          name:        t.name,
          description: t.description ?? t.name,
          parameters:  (t.inputSchema ?? { type: 'object', properties: {} }) as Record<string, unknown>,
        },
        displayName: t.name,
      }))
    },
    async callTool(name, args) {
      const result = await client.callTool({ name, arguments: args })
      // MCP callTool 结果是 content 数组
      const contents = (result.content ?? []) as { type: string; text?: string }[]
      return contents.map(c => c.text ?? JSON.stringify(c)).join('\n')
    },
  }
}

/** 创建 HTTP MCP 适配器 */
async function createHttpAdapter(cfg: MCPServerConfig): Promise<MCPAdapter> {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
  const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js')

  const ns = cfg.namespace ?? toNamespace(cfg.name)
  const transport = new StreamableHTTPClientTransport(new URL(cfg.url!), {
    ...(cfg.headers ? { requestInit: { headers: cfg.headers } } : {}),
  })
  const client = new Client({ name: 'codelife-spirit', version: '1.0.0' }, { capabilities: {} })
  await client.connect(transport)

  const toolsResp = await client.listTools()

  return {
    namespace: ns,
    name:      cfg.name,
    async listTools() {
      return toolsResp.tools.map(t => ({
        definition: {
          name:        t.name,
          description: t.description ?? t.name,
          parameters:  (t.inputSchema ?? { type: 'object', properties: {} }) as Record<string, unknown>,
        },
        displayName: t.name,
      }))
    },
    async callTool(name, args) {
      const result = await client.callTool({ name, arguments: args })
      const contents = (result.content ?? []) as { type: string; text?: string }[]
      return contents.map(c => c.text ?? JSON.stringify(c)).join('\n')
    },
  }
}

/** 加载单个 MCP server 并注册工具（幂等） */
export async function loadMCPServer(cfg: MCPServerConfig): Promise<{ ok: boolean; error?: string; toolCount?: number }> {
  const ns = cfg.namespace ?? toNamespace(cfg.name)
  if (loadedNamespaces.has(ns)) return { ok: true }
  const inflight = loadingNamespaces.get(ns)
  if (inflight) return inflight

  const loading = (async () => {
    try {
      let adapter: MCPAdapter
      if (cfg.transport === 'http') {
        if (!cfg.url) throw new Error(`HTTP transport 缺少 url 字段`)
        adapter = await createHttpAdapter(cfg)
      } else {
        if (!cfg.command) throw new Error(`stdio transport 缺少 command 字段`)
        adapter = await createStdioAdapter(cfg)
      }

      const tools = await adapter.listTools()
      await registerMCPAdapter(adapter)
      // 写入 namespace → agents 权限映射
      setNamespaceAgents(ns, cfg.agents)
      loadedNamespaces.add(ns)
      return { ok: true, toolCount: tools.length }
    } catch (err) {
      console.error(`[MCP] 加载 ${cfg.name} 失败:`, err)
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    } finally {
      loadingNamespaces.delete(ns)
    }
  })()

  loadingNamespaces.set(ns, loading)
  return loading
}

/** 从配置批量加载 MCP servers（应用启动时调用，失败单个不影响整体） */
export async function loadMCPServers(servers: MCPServerConfig[]): Promise<{ name: string; ok: boolean; error?: string; toolCount?: number }[]> {
  const results = await Promise.allSettled(servers.map(s => loadMCPServer(s)))
  return results.map((result, index) => {
    const name = servers[index]?.name ?? `server_${index}`
    if (result.status === 'fulfilled') return { name, ...result.value }
    return { name, ok: false, error: result.reason instanceof Error ? result.reason.message : String(result.reason) }
  })
}

/** 动态添加 MCP server（运行时，进程内持久） */
export async function addMCPServerRuntime(cfg: MCPServerConfig): Promise<{ ok: boolean; error?: string; toolCount?: number }> {
  runtimeServers.push(cfg)
  return loadMCPServer(cfg)
}

/** 获取运行时动态加载的服务器列表 */
export function getRuntimeServers(): MCPServerConfig[] {
  return [...runtimeServers]
}

/** 获取所有已加载的 MCP 适配器（含运行时添加的） */
export function getLoadedMCPAdapters() {
  return getMCPAdapters()
}
