import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import type { SpiritEvent } from './protocol'
import type { PrefetchedMemoryPack } from './memory-gate'
import { clampSummary, type MemoryPackItem } from './memory-pack'
import { dateInTZ, timeInTZ } from './time'

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
