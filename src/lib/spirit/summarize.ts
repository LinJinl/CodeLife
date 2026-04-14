/**
 * 会话摘要模块
 *
 * 1. summarizeSession     — 对话结束后生成当日 1-2 句摘要，异步持久化
 * 2. summarizeChunksForQuery — search_conversations 检索后，将碎片消息压缩为聚焦回答
 */

import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import type { ChatOpenAI }             from '@langchain/openai'
import type { ConversationMessage, SessionSummary } from './memory'

// ── 网络探测（超时后辅助诊断）────────────────────────────────

async function probe(url: string, timeoutMs = 4000): Promise<'ok' | 'timeout' | 'error'> {
  try {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), timeoutMs)
    const res = await fetch(url, { method: 'HEAD', signal: ac.signal })
    clearTimeout(timer)
    return res.ok || res.status < 500 ? 'ok' : 'error'
  } catch (e: unknown) {
    if (e instanceof Error && e.name === 'AbortError') return 'timeout'
    return 'error'
  }
}

async function diagnoseNetwork(apiBaseUrl?: string): Promise<void> {
  const internet = await probe('https://1.1.1.1')
  const api      = apiBaseUrl ? await probe(apiBaseUrl) : null

  const netLabel = internet === 'ok' ? '✓ 网络正常' : internet === 'timeout' ? '✗ 网络超时' : '✗ 网络不可达'
  const apiLabel = api === null      ? '（未配置 baseURL）'
                 : api === 'ok'      ? '✓ API 端点可达'
                 : api === 'timeout' ? '✗ API 端点超时'
                 :                    '✗ API 端点不可达'

  console.warn(`[summarize] 网络诊断 → ${netLabel} | ${apiLabel}`)
  if (internet !== 'ok') {
    console.warn('[summarize] 建议：检查服务器/本机网络连接，或代理配置')
  } else if (api && api !== 'ok') {
    console.warn('[summarize] 建议：API 服务商当前不可用，可稍后重试或切换端点')
  } else {
    console.warn('[summarize] 建议：网络正常但请求超时，可能是模型响应慢或请求体过大')
  }
}

// ── summarizeSession ──────────────────────────────────────────

const SESSION_SYSTEM = `你是一个对话记录整理助手。
请用1-2句话（不超过80字）概括以下对话的核心内容：今天聊了什么、得出了哪些结论或决定。
只输出摘要文字，不要加前缀，不要换行。`

/**
 * 生成当日对话的简短摘要。
 * 建议在对话保存后异步调用（不阻塞响应）。
 */
export async function summarizeSession(
  date: string,
  messages: ConversationMessage[],
  model: ChatOpenAI,
): Promise<SessionSummary> {
  // 过滤空消息，取最近 20 条（避免超 token）
  const filtered = messages
    .filter(m => m.content.trim())
    .slice(-20)

  if (filtered.length === 0) {
    return { date, summary: '无有效对话内容', topics: [], generatedAt: new Date().toISOString() }
  }

  const transcript = filtered.map(m => {
    const role = m.role === 'user' ? '修士' : '器灵'
    return `${role}：${m.content}`
  }).join('\n')

  try {
    const invoke = model.invoke([
      new SystemMessage(SESSION_SYSTEM),
      new HumanMessage(`日期：${date}\n\n${transcript}`),
    ])
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('summarize timeout')), 20_000)
    )
    const resp = await Promise.race([invoke, timeout])

    const summary = (typeof resp.content === 'string' ? resp.content : String(resp.content)).trim()
    const topics  = extractTopics(summary, filtered)

    return { date, summary, topics, generatedAt: new Date().toISOString() }
  } catch (err) {
    console.warn('[summarize] summarizeSession failed:', err)
    if (err instanceof Error && err.message === 'summarize timeout') {
      // 异步诊断，不阻塞降级返回
      const baseURL = (model as unknown as { clientOptions?: { baseURL?: string } })
        .clientOptions?.baseURL
      diagnoseNetwork(baseURL).catch(() => {})
    }
    const fallback = filtered.find(m => m.role === 'user')?.content.slice(0, 60) ?? '对话记录'
    return { date, summary: fallback + '…', topics: [], generatedAt: new Date().toISOString() }
  }
}

// ── summarizeChunksForQuery ───────────────────────────────────

const CHUNKS_SYSTEM = `你是一个历史对话检索助手。
以下是从历史对话中找到的相关片段。请基于这些片段，针对给定问题给出综合回答：
- 2-4句话，包含具体日期和关键结论
- 如果片段中有明确答案，直接给出；如果只是相关背景，说明上下文
- 不要说"根据片段"之类的前缀，直接回答`

/**
 * 把 search_conversations 检索到的碎片消息压缩为针对 query 的聚焦回答。
 */
export async function summarizeChunksForQuery(
  chunks: { date: string; role: string; content: string; timestamp: string }[],
  query: string,
  model: ChatOpenAI,
): Promise<string> {
  if (chunks.length === 0) return '未找到相关历史对话。'

  const text = chunks.map(c => {
    const role = c.role === 'user' ? '修士' : '器灵'
    return `[${c.date} ${c.timestamp}] ${role}：${c.content}`
  }).join('\n\n---\n\n')

  try {
    const invoke = model.invoke([
      new SystemMessage(CHUNKS_SYSTEM),
      new HumanMessage(`问题：「${query}」\n\n历史片段（共 ${chunks.length} 条）：\n\n${text}`),
    ])
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('summarize timeout')), 20_000)
    )
    const resp = await Promise.race([invoke, timeout])
    return (typeof resp.content === 'string' ? resp.content : String(resp.content)).trim()
  } catch (err) {
    console.warn('[summarize] summarizeChunksForQuery failed:', err)
    if (err instanceof Error && err.message === 'summarize timeout') {
      const baseURL = (model as unknown as { clientOptions?: { baseURL?: string } })
        .clientOptions?.baseURL
      diagnoseNetwork(baseURL).catch(() => {})
    }
    const top = chunks[0]
    const role = top.role === 'user' ? '修士' : '器灵'
    return `[${top.date}] ${role}：${top.content}`
  }
}

// ── 辅助：提取 topics ─────────────────────────────────────────

function extractTopics(summary: string, messages: ConversationMessage[]): string[] {
  // 从摘要 + 消息内容中提取常见技术关键词
  const combined = summary + ' ' + messages.slice(-5).map(m => m.content).join(' ')
  const patterns = [
    /LangGraph/gi, /LangChain/gi, /MCP/gi, /Agent/gi,
    /LeetCode|刷题/gi, /博客|Notion|Ghost/gi,
    /GitHub|commit/gi, /器灵|青霄/gi,
    /Python|TypeScript|Go|Rust/gi,
    /学习路线|学习计划/gi, /修为|境界/gi,
  ]
  const found = new Set<string>()
  for (const pat of patterns) {
    const m = combined.match(pat)
    if (m) found.add(m[0].toLowerCase().replace(/^./, c => c.toUpperCase()))
  }
  return Array.from(found).slice(0, 5)
}
