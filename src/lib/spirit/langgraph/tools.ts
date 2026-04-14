/**
 * 把现有 registry 工具 wrap 成 LangChain DynamicStructuredTool
 *
 * brief 约定：
 *   工具返回值若有 brief，格式为 "BRIEF::{内容}\n{实际 content}"
 *   stream.ts 中的 extractBrief() 负责解析
 */

import { DynamicStructuredTool } from '@langchain/core/tools'
import { z }                      from 'zod'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import type { ChatOpenAI }        from '@langchain/openai'
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

// ── AI 域分类器 ────────────────────────────────────────────────

const DOMAIN_SCHEMA = z.object({
  domains: z.array(z.enum(['web', 'library', 'system'])).describe(
    '需要追加的工具域列表，只填实际需要的'
  ),
})

const CLASSIFIER_SYSTEM = `你是工具域路由器。根据用户消息，判断需要追加哪些工具域。

可选域：
- web：联网搜索外部信息、抓取网页、找文档/教程/资料、了解某个技术/工具/概念
- library：操作藏经阁（收藏文章、搜已收藏内容）
- system：读写文件、浏览目录、执行 shell 命令、操作代码库

规则：
- 只加明确需要的域，不确定则不加
- 问本地数据（博客/修为/刷题/誓约等）不需要任何额外域
- 聊天、分析、建议不需要额外域

只输出 JSON，不输出其他内容。`

/**
 * 用 LLM 判断需要追加哪些工具域。
 * 与 syncToday 并行调用，不增加额外延迟。
 * 若 LLM 调用失败或超时，回退到规则推断。
 *
 * 注意：
 * - maxRetries:0 防止 LangChain 默认 6 次退避重试吃掉数分钟
 * - 4s 超时兜底，确保 API 无响应时不阻塞主流程
 * - streaming:false 避免部分 OpenAI 兼容端点在流式 + structured output 下的不稳定行为
 */
export async function inferDomainsWithAI(
  userMessage: string,
  model: ChatOpenAI,
): Promise<ToolDomain[]> {
  if (!userMessage.trim()) return []
  try {
    const classifierModel = model.bind({ stream: false }) as unknown as ChatOpenAI
    const classifier      = classifierModel.withStructuredOutput(DOMAIN_SCHEMA)
    const invoke          = classifier.invoke([
      new SystemMessage(CLASSIFIER_SYSTEM),
      new HumanMessage(userMessage.slice(0, 400)),
    ])
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('domain-classify timeout')), 4000)
    )
    const result = await Promise.race([invoke, timeout])
    return result.domains as ToolDomain[]
  } catch (err) {
    // 降级到规则推断，不影响主流程
    console.warn('[spirit] domain classifier failed, fallback to rules:', err instanceof Error ? err.message : err)
    return inferExtraDomains(userMessage)
  }
}

/**
 * 规则推断（fallback / 无 LLM 时使用）
 */
export function inferExtraDomains(userMessage: string): ToolDomain[] {
  const extra: ToolDomain[] = []
  const text = userMessage.toLowerCase()

  if (/搜索|搜一下|搜集|查一下|查查|找.*资料|相关资料|最新|网上|在线|网页|链接|url|http|google|bing|了解一下|学习资料/.test(text)) {
    extra.push('web')
  }
  if (/藏经阁|收藏|书单|资料库|文档库|collect/.test(text)) {
    extra.push('library')
  }
  if (/文件|目录|代码|项目|shell|执行|命令|ls |cat |git |npm |run |脚本/.test(text)) {
    extra.push('system')
  }
  return extra
}

export function getQingxiaoDomains(extraDomains?: ToolDomain[]): ToolDomain[] {
  const domains = [...QINGXIAO_DEFAULT_DOMAINS]
  if (extraDomains) {
    for (const d of extraDomains) {
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
