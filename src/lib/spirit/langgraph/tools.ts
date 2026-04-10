/**
 * 把现有 registry 工具 wrap 成 LangChain DynamicStructuredTool
 *
 * brief 约定：
 *   工具返回值若有 brief，格式为 "BRIEF::{内容}\n{实际 content}"
 *   stream.ts 中的 extractBrief() 负责解析
 */

import { DynamicStructuredTool } from '@langchain/core/tools'
import { z }                      from 'zod'
// 注册所有工具（副作用 import）
import '../tools/index'
import {
  getToolDefinitions,
  getRegisteredTool,
  callTool,
  isToolVisibleToAgent,
}                                 from '../registry'

// ── JSON Schema → Zod 转换（覆盖现有工具的参数类型） ────────────

type JSONSchemaProp = {
  type?:        string
  description?: string
  enum?:        string[]
  items?:       JSONSchemaProp
}

function propToZod(prop: JSONSchemaProp): z.ZodTypeAny {
  if (prop.enum) return z.enum(prop.enum as [string, ...string[]]).describe(prop.description ?? '')

  switch (prop.type) {
    case 'number':
    case 'integer': return z.number().optional().describe(prop.description ?? '')
    case 'boolean': return z.boolean().optional().describe(prop.description ?? '')
    case 'array':   return z.array(propToZod(prop.items ?? { type: 'string' })).optional().describe(prop.description ?? '')
    default:        return z.string().optional().describe(prop.description ?? '')
  }
}

function buildZodSchema(
  properties: Record<string, JSONSchemaProp>,
  required: string[],
): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape: Record<string, z.ZodTypeAny> = {}
  for (const [key, prop] of Object.entries(properties)) {
    const base = propToZod(prop)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    shape[key] = required.includes(key) ? (base as any).unwrap?.() ?? base : base
  }
  return z.object(shape)
}

// ── 工具集分组 ────────────────────────────────────────────────

export const TOOL_SETS: Record<string, string[] | '*'> = {
  search_agent:  ['web_search', 'fetch_url'],
  code_agent:    ['read_leetcode_records', 'read_user_blogs', 'search_blog_posts', 'search_library', 'list_library'],
  planner_agent: ['read_cultivation_stats', 'read_leetcode_records', 'search_conversations'],
  qingxiao:      '*',
}

export const AGENT_DISPLAY: Record<string, string> = {
  qingxiao:      '青霄',
  search_agent:  '搜寻使',
  code_agent:    '算法师',
  planner_agent: '星盘官',
}

// ── 构建 LangChain 工具列表 ───────────────────────────────────

const APPROVAL_TOKEN_PROP: JSONSchemaProp = {
  type:        'string',
  description: '用户批准后服务端颁发的一次性令牌。首次调用工具若返回权限请求，以返回值中的令牌重新调用此工具。',
}

function buildAllLangChainTools(): DynamicStructuredTool[] {
  return getToolDefinitions().map(def => {
    const baseProps = ((def.parameters as Record<string, unknown>).properties ?? {}) as Record<string, JSONSchemaProp>
    const required  = ((def.parameters as Record<string, unknown>).required   ?? []) as string[]
    const registered = getRegisteredTool(def.name)

    // 需要用户批准的工具自动注入 approval_token 可选参数
    const props: Record<string, JSONSchemaProp> = registered?.requiresApproval
      ? { ...baseProps, approval_token: APPROVAL_TOKEN_PROP }
      : baseProps

    return new DynamicStructuredTool({
      name:        def.name,
      description: def.description,
      schema:      buildZodSchema(props, required),
      func: async (args) => {
        const result = await callTool(def.name, args as Record<string, unknown>)
        // 附上 brief 前缀，供 stream.ts 提取
        if (result.brief) {
          return `BRIEF::${result.brief}\n${result.content}`
        }
        return result.content
      },
    })
  })
}

let _cachedTools: DynamicStructuredTool[] | null = null

export function getLangChainTools(): DynamicStructuredTool[] {
  if (!_cachedTools) _cachedTools = buildAllLangChainTools()
  return _cachedTools
}

/** 动态安装新 MCP 工具后调用，下次 getLangChainTools 会重新构建 */
export function invalidateToolCache() {
  _cachedTools = null
}

export function getLangChainToolsFor(agentId: string): DynamicStructuredTool[] {
  const all = getLangChainTools()
  const set = TOOL_SETS[agentId]

  return all.filter(t => {
    // Step 1: TOOL_SETS 白名单过滤（内置工具）
    if (set && set !== '*' && !t.name.includes('__')) {
      if (!(set as string[]).includes(t.name)) return false
    }
    // Step 2: MCP namespace → agent 可见性过滤
    return isToolVisibleToAgent(t.name, agentId)
  })
}
