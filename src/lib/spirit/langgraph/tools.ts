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
  isToolInDomains,
  type ToolDomain,
}                                 from '../registry'
export { AGENT_DISPLAY }          from './agent-config'
export type { ToolDomain }        from '../registry'

// ── 青霄默认工具域 ─────────────────────────────────────────────

/**
 * 青霄默认加载的域（始终注入）
 * web / library / system 按消息意图按需追加
 */
const QINGXIAO_DEFAULT_DOMAINS: ToolDomain[] = [
  'cultivation', 'memory', 'vow', 'knowledge', 'meta',
]

/**
 * 根据用户消息内容推断需要追加的域（纯规则，无 LLM 调用）
 *
 * 策略：宁可多加（功能完整）也不要少加（AI 看不见工具无法决策）。
 * web 和 system 通常是「按需追加」的大头。
 */
export function inferExtraDomains(userMessage: string): ToolDomain[] {
  const extra: ToolDomain[] = []
  const text = userMessage.toLowerCase()

  // web：搜索、查最新信息、抓页面
  if (/搜索|搜一下|查一下|查查|最新|网上|在线|网页|链接|url|http|google|bing/.test(text)) {
    extra.push('web')
  }

  // library：藏经阁、收藏、书单
  if (/藏经阁|收藏|书单|资料库|文档库|collect/.test(text)) {
    extra.push('library')
  }

  // system：文件操作、代码库、shell
  if (/文件|目录|代码|项目|shell|执行|命令|ls |cat |git |npm |run |脚本/.test(text)) {
    extra.push('system')
  }

  return extra
}

export function getQingxiaoDomains(userMessage?: string): ToolDomain[] {
  const domains = [...QINGXIAO_DEFAULT_DOMAINS]
  if (userMessage) {
    for (const d of inferExtraDomains(userMessage)) {
      if (!domains.includes(d)) domains.push(d)
    }
  }
  return domains
}

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

export function getLangChainToolsFor(agentId: string, domains?: ToolDomain[]): DynamicStructuredTool[] {
  return getLangChainTools().filter(t => {
    if (!isToolVisibleToAgent(t.name, agentId)) return false
    if (agentId === 'qingxiao' && domains) return isToolInDomains(t.name, domains)
    return true
  })
}
