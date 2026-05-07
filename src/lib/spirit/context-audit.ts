import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import type { SpiritEvent } from './protocol'
import type { PrefetchedMemoryPack } from './memory-gate'
import { clampSummary, type MemoryPackItem } from './memory-pack'
import { dateInTZ, timeInTZ } from './time'

export interface ContextPromptMessage {
  id: string
  role: 'system' | 'user' | 'assistant' | 'tool' | 'unknown'
  source: 'system_prompt' | 'memory_gate' | 'prefetched_memory' | 'today_history' | 'page_context' | 'conversation' | 'runtime'
  title: string
  content: string
  chars: number
}

export interface ContextRunTool {
  name: string
  display?: string
  desc?: string
  brief?: string
  links?: { title: string; url: string }[]
}

export interface ContextRun {
  id: string
  date: string
  createdAt: string
  updatedAt: string
  route?: string
  model?: string
  userMessage: string
  finalAnswerPreview?: string
  planner: {
    usePlanner: boolean
    strategy?: 'direct' | 'sequential' | 'parallel'
    taskCount?: number
  }
  domains: string[]
  todayHistory: {
    totalSaved: number
    selected: number
    summarized: number
    skipped: number
    truncated: number
    deduped: boolean
  }
  currentConversation?: {
    total: number
    selected: number
    summarized: number
    chars: number
    truncated: number
  }
  memoryGate: {
    strength: 'strong' | 'weak' | 'none'
    intents: string[]
    requiredTools: string[]
    prefetchedCount: number
    items: {
      type: string
      id: string
      title?: string
      date?: string
      source?: string
      summaryPreview: string
    }[]
  }
  promptSnapshot?: {
    capturedAt: string
    note: string
    messages: ContextPromptMessage[]
  }
  tools: ContextRunTool[]
  errors: string[]
}

export interface ContextRunSummary {
  id: string
  date: string
  createdAt: string
  userMessage: string
  finalAnswerPreview?: string
  domains: string[]
  toolCount: number
  prefetchedCount: number
  strategy?: string
}

const BASE = path.resolve(process.cwd(), 'content/spirit/context-runs')

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function readJSON<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as T
  } catch {
    return fallback
  }
}

function writeJSON(file: string, data: unknown) {
  ensureDir(path.dirname(file))
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8')
  fs.renameSync(tmp, file)
}

function runFile(date: string, id: string): string {
  return path.join(BASE, date, `${id}.json`)
}

function allRunFiles(): { date: string; file: string }[] {
  ensureDir(BASE)
  return fs.readdirSync(BASE, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name))
    .flatMap(entry => {
      const dir = path.join(BASE, entry.name)
      return fs.readdirSync(dir)
        .filter(file => file.endsWith('.json'))
        .map(file => ({ date: entry.name, file: path.join(dir, file) }))
    })
}

function itemPreview(item: MemoryPackItem) {
  return {
    type: item.type,
    id: item.id,
    title: item.title,
    date: item.date,
    source: item.source,
    summaryPreview: clampSummary(item.summary, 220),
  }
}

export function createContextRun(input: {
  userMessage: string
  route?: string
  model?: string
  todayHistory: ContextRun['todayHistory']
  currentConversation?: ContextRun['currentConversation']
}): ContextRun {
  const date = dateInTZ()
  const id = `ctx_${date.replace(/-/g, '')}_${timeInTZ().replace(':', '')}_${randomUUID().slice(0, 8)}`
  const now = new Date().toISOString()
  return {
    id,
    date,
    createdAt: now,
    updatedAt: now,
    route: input.route,
    model: input.model,
    userMessage: clampSummary(input.userMessage, 500),
    planner: { usePlanner: false },
    domains: [],
    todayHistory: input.todayHistory,
    currentConversation: input.currentConversation,
    memoryGate: {
      strength: 'none',
      intents: ['none'],
      requiredTools: [],
      prefetchedCount: 0,
      items: [],
    },
    tools: [],
    errors: [],
  }
}

export function attachMemoryGate(run: ContextRun, prefetch: PrefetchedMemoryPack) {
  run.memoryGate = {
    strength: prefetch.intent.strength,
    intents: prefetch.intent.intents,
    requiredTools: prefetch.intent.requiredTools,
    prefetchedCount: prefetch.items.length,
    items: prefetch.items.slice(0, 12).map(itemPreview),
  }
  run.updatedAt = new Date().toISOString()
}

export function attachPromptSnapshot(run: ContextRun, input: {
  systemPrompt: string
  messages: { role: ContextPromptMessage['role']; content: string }[]
}) {
  const promptMessages: ContextPromptMessage[] = [{
    id: 'system_prompt',
    role: 'system',
    source: 'system_prompt',
    title: '青霄系统提示',
    content: input.systemPrompt,
    chars: input.systemPrompt.length,
  }]

  input.messages.forEach((message, index) => {
    const source = inferPromptSource(message)
    promptMessages.push({
      id: `${source}:${index}`,
      role: message.role,
      source,
      title: promptTitle(source, message.role, index),
      content: message.content,
      chars: message.content.length,
    })
  })

  run.promptSnapshot = {
    capturedAt: new Date().toISOString(),
    note: '这是进入 LangGraph 主助手的实际消息栈。工具 schema 由 LangGraph/OpenAI 工具调用机制单独传递，不属于这段文本 prompt；真实工具调用见下方工具记录。',
    messages: promptMessages,
  }
  run.updatedAt = new Date().toISOString()
}

function inferPromptSource(message: { role: ContextPromptMessage['role']; content: string }): ContextPromptMessage['source'] {
  if (message.content.startsWith('[记忆检索门控]')) return 'memory_gate'
  if (message.content.startsWith('【服务端预取记忆】') || message.content.startsWith('【用户确认带入的上下文】')) return 'prefetched_memory'
  if (message.content.startsWith('[页面上下文')) return 'page_context'
  if (message.content.startsWith('【今日较早对话摘要】')) return 'today_history'
  if (message.role === 'user' || message.role === 'assistant') return 'conversation'
  return 'runtime'
}

function promptTitle(source: ContextPromptMessage['source'], role: ContextPromptMessage['role'], index: number): string {
  const labels: Record<ContextPromptMessage['source'], string> = {
    system_prompt: '系统提示',
    memory_gate: '记忆门控提示',
    prefetched_memory: '预取记忆',
    today_history: '今日历史',
    page_context: '页面上下文',
    conversation: role === 'user' ? '用户消息' : '助手消息',
    runtime: '运行时系统消息',
  }
  return `${labels[source]} #${index + 1}`
}

export function consumeAuditEvent(run: ContextRun, event: SpiritEvent, finalText: { value: string }) {
  if (event.type === 'strategy') {
    run.planner.strategy = event.mode
    run.planner.taskCount = event.taskCount
  }
  if (event.type === 'tool_start') {
    if (event.name.startsWith('__')) return
    run.tools.push({
      name: event.name,
      display: event.display,
      desc: event.desc,
    })
  }
  if (event.type === 'tool_done') {
    if (event.name.startsWith('__')) return
    const tool = [...run.tools].reverse().find(item => item.name === event.name && item.brief === undefined)
    if (tool) {
      tool.brief = event.brief
      tool.links = event.links
    } else {
      run.tools.push({
        name: event.name,
        brief: event.brief,
        links: event.links,
      })
    }
  }
  if (event.type === 'text') {
    finalText.value += event.chunk
  }
  if (event.type === 'error') {
    run.errors.push(event.message)
  }
  run.updatedAt = new Date().toISOString()
}

export function saveContextRun(run: ContextRun) {
  run.finalAnswerPreview = run.finalAnswerPreview
    ? clampSummary(run.finalAnswerPreview, 800)
    : run.finalAnswerPreview
  run.updatedAt = new Date().toISOString()
  writeJSON(runFile(run.date, run.id), run)
}

export function listContextRuns(limit = 50): ContextRunSummary[] {
  return allRunFiles()
    .map(({ file }) => readJSON<ContextRun | null>(file, null))
    .filter((run): run is ContextRun => Boolean(run))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit)
    .map(run => ({
      id: run.id,
      date: run.date,
      createdAt: run.createdAt,
      userMessage: run.userMessage,
      finalAnswerPreview: run.finalAnswerPreview,
      domains: run.domains,
      toolCount: run.tools.length,
      prefetchedCount: run.memoryGate.prefetchedCount,
      strategy: run.planner.strategy,
    }))
}

export function getContextRun(id: string): ContextRun | null {
  const found = allRunFiles().find(({ file }) => path.basename(file, '.json') === id)
  if (!found) return null
  return readJSON<ContextRun | null>(found.file, null)
}

export function deleteContextRun(id: string): boolean {
  const found = allRunFiles().find(({ file }) => path.basename(file, '.json') === id)
  if (!found) return false
  fs.unlinkSync(found.file)
  return true
}
