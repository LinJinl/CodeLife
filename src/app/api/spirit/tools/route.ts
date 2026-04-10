/**
 * GET /api/spirit/tools
 * 返回当前注册的所有工具和 MCP 适配器列表
 */

import { getToolRegistry, getMCPAdapters } from '@/lib/spirit/registry'
import '@/lib/spirit/tools/index'  // 触发工具注册

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  return Response.json({
    tools:       getToolRegistry(),
    mcpAdapters: getMCPAdapters(),
  })
}
