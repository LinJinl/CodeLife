export type MemoryPackType =
  | 'daily_log'
  | 'weekly_pattern'
  | 'skill'
  | 'conversation'
  | 'note'
  | 'vow'
  | 'library'
  | 'blog'

export interface MemoryPackItem {
  type: MemoryPackType
  id: string
  date?: string
  title?: string
  summary: string
  source?: string
  score?: number
  confidence?: number
}

export function clampSummary(text: string, maxChars = 420): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxChars) return normalized
  return `${normalized.slice(0, Math.max(0, maxChars - 12)).trimEnd()}...[已截断]`
}

function formatScore(item: MemoryPackItem): string {
  const values: string[] = []
  if (typeof item.score === 'number') values.push(`score=${item.score.toFixed(2)}`)
  if (typeof item.confidence === 'number') values.push(`confidence=${item.confidence.toFixed(2)}`)
  return values.length ? `[${values.join(' ')}]` : ''
}

export function formatMemoryPack(items: MemoryPackItem[], heading = '相关记忆'): string {
  if (items.length === 0) return `【${heading}】\n无匹配记录`

  const lines = items.map(item => {
    const meta = [
      `[${item.type}]`,
      item.date ? `[${item.date}]` : '',
      item.title ? `[${item.title}]` : '',
      formatScore(item),
    ].filter(Boolean).join('')
    const source = item.source ? `（来源：${item.source}）` : ''
    return `${meta} ${clampSummary(item.summary)}${source}`
  })

  return `【${heading}】\n${lines.join('\n')}`
}
