/**
 * 工具注册表
 *
 * 内置工具：启动时静态注册
 * MCP 工具：运行时通过 MCPAdapter 动态注入，工具名自动加命名空间前缀
 *
 * 扩展方式：
 *   registerTool(def, handler, opts)    — 注册单个工具
 *   registerMCPAdapter(adapter)         — 接入一个 MCP 服务
 */

// ── 类型 ──────────────────────────────────────────────────────

export interface ToolDefinition {
  name:        string
  description: string
  parameters:  Record<string, unknown>   // JSON Schema object
}

export interface ToolResult {
  /** 回注给模型的原始内容 */
  content: string
  /** 显示在 UI 里的一句话摘要（可选，给 tool_done 用） */
  brief?: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ToolHandler = (args: Record<string, any>) => Promise<ToolResult>

interface RegisteredTool {
  definition:      ToolDefinition
  handler:         ToolHandler
  displayName:     string   // UI 进度显示用，如"抓取页面内容"
  category:        'builtin' | 'mcp' | 'custom'
  requiresApproval?: boolean
  approvalSummary?:  (args: Record<string, unknown>) => string
}

/** MCP 适配器接口 — 任何外部工具服务实现此接口即可接入 */
export interface MCPAdapter {
  /** 命名空间，用于工具名前缀，如 "memory" → 工具名 "memory__search" */
  namespace: string
  /** 展示名，调试用 */
  name: string
  listTools(): Promise<{ definition: ToolDefinition; displayName: string }[]>
  callTool(name: string, args: Record<string, unknown>): Promise<string>
}

// ── 注册表（模块级单例） ──────────────────────────────────────

const toolMap    = new Map<string, RegisteredTool>()
const mcpAdapters = new Map<string, MCPAdapter>()

/**
 * namespace → allowed agents
 * undefined = 仅 qingxiao（默认）
 * ['*']     = 所有 agent
 * ['a','b'] = 仅指定 agent
 */
const namespaceAgents = new Map<string, string[] | undefined>()

/** 设置某个 MCP namespace 允许的 agent 列表 */
export function setNamespaceAgents(namespace: string, agents: string[] | undefined) {
  namespaceAgents.set(namespace, agents)
}

/**
 * 检查工具是否对指定 agent 可见。
 * 内置工具（无 __ 前缀）：始终返回 true，由 TOOL_SETS 控制。
 * MCP 工具（有 __ 前缀）：根据 namespace agents 配置判断。
 */
export function isToolVisibleToAgent(toolName: string, agentId: string): boolean {
  if (!toolName.includes('__')) return true   // 内置工具，TOOL_SETS 管
  const namespace = toolName.split('__')[0]
  const allowed   = namespaceAgents.get(namespace)
  if (allowed === undefined) {
    // 未配置 → 默认仅 qingxiao 可用
    return agentId === 'qingxiao'
  }
  if (allowed.includes('*')) return true
  return allowed.includes(agentId)
}

// ── 内置工具注册 ──────────────────────────────────────────────

export interface RegisterOptions {
  displayName:      string
  category?:        RegisteredTool['category']
  /** true = 执行前必须持有用户批准的 approval_token */
  requiresApproval?: boolean
  /** 生成给用户看的操作摘要（用于权限确认弹窗） */
  approvalSummary?:  (args: Record<string, unknown>) => string
}

export function registerTool(
  definition: ToolDefinition,
  handler:    ToolHandler,
  opts:       RegisterOptions,
) {
  toolMap.set(definition.name, {
    definition,
    handler,
    displayName:      opts.displayName,
    category:         opts.category ?? 'builtin',
    requiresApproval: opts.requiresApproval,
    approvalSummary:  opts.approvalSummary,
  })
}

// ── MCP 适配器注册 ────────────────────────────────────────────

export async function registerMCPAdapter(adapter: MCPAdapter) {
  mcpAdapters.set(adapter.namespace, adapter)

  // 把 MCP 工具代理进注册表，名字加命名空间前缀
  const tools = await adapter.listTools()
  for (const { definition, displayName } of tools) {
    const proxiedName = `${adapter.namespace}__${definition.name}`
    registerTool(
      { ...definition, name: proxiedName },
      async (args) => {
        const content = await adapter.callTool(definition.name, args)
        return { content }
      },
      { displayName, category: 'mcp' },
    )
  }
}

// ── 查询接口 ──────────────────────────────────────────────────

/** 返回所有工具的 OpenAI 格式定义（给模型看） */
export function getToolDefinitions(): ToolDefinition[] {
  return Array.from(toolMap.values()).map(t => t.definition)
}

/** 返回工具完整信息（给 UI 工具面板用） */
export function getToolRegistry(): { name: string; displayName: string; description: string; category: string; params: string[] }[] {
  return Array.from(toolMap.values()).map(t => ({
    name:        t.definition.name,
    displayName: t.displayName,
    description: t.definition.description,
    category:    t.category,
    params:      Object.keys((t.definition.parameters as { properties?: Record<string, unknown> }).properties ?? {}),
  }))
}

/** 返回已注册的 MCP 适配器列表 */
export function getMCPAdapters(): { namespace: string; name: string }[] {
  return Array.from(mcpAdapters.values()).map(a => ({ namespace: a.namespace, name: a.name }))
}

/** 返回工具的展示名（给 UI 进度条用） */
export function getToolDisplayName(name: string): string {
  return toolMap.get(name)?.displayName ?? name
}

/** 获取注册工具的完整记录（供 tools.ts 注入 approval_token 参数用） */
export function getRegisteredTool(name: string): RegisteredTool | undefined {
  return toolMap.get(name)
}

/** 执行工具，返回 ToolResult */
export async function callTool(
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const tool = toolMap.get(name)
  if (!tool) return { content: `未知工具：${name}` }

  // ── 写操作权限拦截 ──────────────────────────────────────────
  if (tool.requiresApproval) {
    const { createWriteToken, consumeWriteToken } = await import('./shell-permissions')
    const token = args.approval_token as string | undefined
    if (token) {
      if (!consumeWriteToken(token, name)) {
        return { content: '令牌无效、已过期或工具不匹配，请重新发起操作。', brief: '令牌验证失败' }
      }
      // 令牌有效，执行 handler（不传 approval_token 给 handler）
    } else {
      const summary = tool.approvalSummary?.(args) ?? `执行 ${tool.displayName}`
      const newToken = createWriteToken(name, summary)
      return {
        content: `PERMISSION_REQUIRED::${newToken}::write::${summary}::`,
        brief:   '等待确认',
      }
    }
  }

  try {
    // 不把 approval_token 透传给实际 handler
    const { approval_token: _, ...cleanArgs } = args
    return await tool.handler(cleanArgs)
  } catch (err) {
    return { content: `工具执行失败：${err instanceof Error ? err.message : String(err)}` }
  }
}

/** 并行执行多个工具调用 */
export async function callToolsParallel(
  calls: { id: string; name: string; args: Record<string, unknown> }[],
): Promise<{ id: string; name: string; result: ToolResult }[]> {
  return Promise.all(
    calls.map(async c => ({
      id:     c.id,
      name:   c.name,
      result: await callTool(c.name, c.args),
    })),
  )
}
