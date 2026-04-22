/**
 * GET  /api/spirit/mcp  — 列出当前已加载的 MCP servers 和工具
 * POST /api/spirit/mcp  — 动态添加 MCP server（需 allowDynamicInstall: true）
 *
 * POST body (install npm package via npx):
 *   { action: 'install', package: '@modelcontextprotocol/server-filesystem', args?: string[] }
 *
 * POST body (add custom server):
 *   { action: 'add', server: MCPServerConfig }
 */

import { NextRequest } from 'next/server'
import config from '../../../../../codelife.config'
import { getLoadedMCPAdapters, getRuntimeServers, addMCPServerRuntime } from '@/lib/spirit/mcp-loader'
import { ensureConfiguredMCPServersLoaded } from '@/lib/spirit/mcp-runtime'
import { getToolRegistry } from '@/lib/spirit/registry'
import { invalidateToolCache } from '@/lib/spirit/langgraph/tools'
import { invalidateAgentCache } from '@/lib/spirit/langgraph/agents'
import { invalidateGraphCache } from '@/lib/spirit/langgraph/graph'
// 触发内置工具注册（side-effect import）
import '@/lib/spirit/tools'
import type { MCPServerConfig } from '@/lib/config'

export const runtime = 'nodejs'

function redactServer(server: MCPServerConfig): MCPServerConfig {
  if (!server.headers) return server
  return {
    ...server,
    headers: Object.fromEntries(Object.keys(server.headers).map(key => [key, '[redacted]'])),
  }
}

export async function GET() {
  const preload = await ensureConfiguredMCPServersLoaded()
  const adapters   = getLoadedMCPAdapters()
  const runtime    = getRuntimeServers()
  const allTools   = getToolRegistry()   // 返回全部工具（builtin + mcp）
  const configured = config.spirit?.mcpServers ?? []

  return Response.json({
    allowDynamicInstall: config.spirit?.allowDynamicInstall ?? false,
    configured: configured.map(redactServer),
    runtimeAdded: runtime.map(redactServer),
    preload,
    adapters,
    tools: allTools,
  })
}

export async function POST(req: NextRequest) {
  const spirit = config.spirit
  if (!spirit?.enabled)             return Response.json({ error: '器灵未开启' }, { status: 403 })
  if (!spirit.allowDynamicInstall)  return Response.json({ error: '动态安装未开启（allowDynamicInstall: false）' }, { status: 403 })

  const body = await req.json() as
    | { action: 'install'; package: string; args?: string[] }
    | { action: 'add'; server: MCPServerConfig }

  if (body.action === 'install') {
    // npx 模式：无需本地 npm install，直接 spawn npx -y <package> <args>
    const pkg  = body.package.trim()
    const args = body.args ?? []

    if (!pkg) return Response.json({ error: 'package 不能为空' }, { status: 400 })

    // 推断 namespace 和展示名
    const displayName = pkg.replace(/^@[^/]+\//, '').replace('server-', '')
    const serverCfg: MCPServerConfig = {
      name:      displayName,
      transport: 'stdio',
      command:   'npx',
      args:      ['-y', pkg, ...args],
    }

    const result = await addMCPServerRuntime(serverCfg)
    if (!result.ok) return Response.json({ error: result.error }, { status: 500 })

    // 新工具注册完成，失效所有缓存（工具列表 → Agent → Graph 都要重建）
    invalidateToolCache()
    invalidateAgentCache()
    invalidateGraphCache()

    return Response.json({
      ok:        true,
      server:    serverCfg,
      toolCount: result.toolCount,
      message:   `已加载 ${displayName}，共 ${result.toolCount} 个工具`,
    })
  }

  if (body.action === 'add') {
    const result = await addMCPServerRuntime(body.server)
    if (!result.ok) return Response.json({ error: result.error }, { status: 500 })
    invalidateToolCache()
    invalidateAgentCache()
    invalidateGraphCache()
    return Response.json({ ok: true, toolCount: result.toolCount })
  }

  return Response.json({ error: '未知 action' }, { status: 400 })
}
