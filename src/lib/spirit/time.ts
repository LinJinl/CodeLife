export const SPIRIT_TIME_ZONE = 'Asia/Shanghai'

function partsInTZ(date: Date, timeZone = SPIRIT_TIME_ZONE): Record<string, string> {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date)

  return Object.fromEntries(parts.map(p => [p.type, p.value]))
}

export function dateInTZ(date: Date = new Date(), timeZone = SPIRIT_TIME_ZONE): string {
  const p = partsInTZ(date, timeZone)
  return `${p.year}-${p.month}-${p.day}`
}

export function timeInTZ(date: Date = new Date(), timeZone = SPIRIT_TIME_ZONE): string {
  const p = partsInTZ(date, timeZone)
  const hour = p.hour === '24' ? '00' : p.hour
  return `${hour}:${p.minute}`
}

export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d + days))
  return date.toISOString().slice(0, 10)
}

export function recentDates(days: number, fromDate = dateInTZ()): string[] {
  return Array.from({ length: Math.max(0, days) }, (_, i) => addDays(fromDate, -i))
}

export function weekStart(dateStr = dateInTZ()): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  const day = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() - day + 1)
  return date.toISOString().slice(0, 10)
}

export function currentDatetimeLabel(): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: SPIRIT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hour12: false,
  }).format(new Date())
}
