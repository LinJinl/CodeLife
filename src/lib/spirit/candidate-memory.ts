import fs from 'fs'
import path from 'path'
import {
  getPreferences,
  getSkills,
  savePreferences,
  saveSkills,
  type Preference,
  type PreferenceCategory,
  type SkillCard,
} from './memory'
import { dateInTZ } from './time'

export interface EvidenceRef {
  type: 'conversation' | 'daily_log' | 'manual' | 'system'
  id: string
  date?: string
  quote?: string
}

export type MemoryCandidateType = 'preference' | 'skill' | 'persona' | 'note'
export type MemoryCandidateStatus = 'pending' | 'promoted' | 'ignored' | 'merged'

export interface MemoryCandidate {
  id: string
  proposedType: MemoryCandidateType
  payload: unknown
  reason: string
  evidence: EvidenceRef[]
  confidence: number
  status: MemoryCandidateStatus
  createdAt: string
  updatedAt?: string
  promotedAt?: string
}

const BASE = path.resolve(process.cwd(), 'content/spirit/candidates')

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

function candidateFile(date = dateInTZ()): string {
  return path.join(BASE, `${date}.json`)
}

function payloadKey(candidate: Pick<MemoryCandidate, 'proposedType' | 'payload'>): string {
  const payload = candidate.payload as Record<string, unknown>
  const key = typeof payload.key === 'string'
    ? payload.key
    : typeof payload.title === 'string'
      ? payload.title
      : JSON.stringify(candidate.payload).slice(0, 80)
  return `${candidate.proposedType}:${key}`
}

export function getCandidates(date = dateInTZ()): MemoryCandidate[] {
  return readJSON<MemoryCandidate[]>(candidateFile(date), [])
}

export function getAllCandidates(): MemoryCandidate[] {
  ensureDir(BASE)
  return fs.readdirSync(BASE)
    .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort()
    .flatMap(file => getCandidates(file.replace('.json', '')))
}

export function saveCandidates(candidates: MemoryCandidate[], date = dateInTZ()) {
  writeJSON(candidateFile(date), candidates)
}

export function addMemoryCandidates(
  inputs: Omit<MemoryCandidate, 'id' | 'status' | 'createdAt'>[],
  date = dateInTZ(),
): MemoryCandidate[] {
  const existing = getCandidates(date)
  const byKey = new Map(existing.map(c => [payloadKey(c), c]))
  const now = new Date().toISOString()
  const added: MemoryCandidate[] = []
  const prefix = `cand_${date.replace(/-/g, '')}_`
  let seq = existing
    .filter(c => c.id.startsWith(prefix))
    .map(c => Number(c.id.slice(prefix.length)))
    .filter(Number.isFinite)
    .reduce((max, n) => Math.max(max, n), 0)

  for (const input of inputs) {
    const key = payloadKey(input)
    const current = byKey.get(key)
    if (current && current.status === 'pending') {
      current.payload = input.payload
      current.reason = input.reason
      current.evidence = mergeEvidence(current.evidence, input.evidence)
      current.confidence = Math.max(current.confidence, input.confidence)
      current.updatedAt = now
      added.push(current)
      continue
    }

    const candidate: MemoryCandidate = {
      ...input,
      id: `${prefix}${String(++seq).padStart(3, '0')}`,
      status: 'pending',
      createdAt: now,
    }
    existing.push(candidate)
    byKey.set(key, candidate)
    added.push(candidate)
  }

  saveCandidates(existing, date)
  return added
}

function mergeEvidence(a: EvidenceRef[], b: EvidenceRef[]): EvidenceRef[] {
  const map = new Map<string, EvidenceRef>()
  for (const item of [...a, ...b]) map.set(`${item.type}:${item.id}:${item.quote ?? ''}`, item)
  return Array.from(map.values())
}

function findCandidate(id: string): { date: string; candidates: MemoryCandidate[]; candidate: MemoryCandidate } | null {
  ensureDir(BASE)
  const files = fs.readdirSync(BASE).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().reverse()
  for (const file of files) {
    const date = file.replace('.json', '')
    const candidates = getCandidates(date)
    const candidate = candidates.find(c => c.id === id)
    if (candidate) return { date, candidates, candidate }
  }
  return null
}

function promotePreference(candidate: MemoryCandidate) {
  const payload = candidate.payload as Partial<Preference> & {
    key?: string
    category?: PreferenceCategory
    description?: string
  }
  if (!payload.key || !payload.category || !payload.description) {
    throw new Error('preference candidate payload is incomplete')
  }

  const prefs = getPreferences()
  const today = dateInTZ()
  const now = new Date().toISOString()
  const idx = prefs.findIndex(p => p.key === payload.key || p.id === payload.id)
  if (idx >= 0) {
    const nextConfidence = payload.confidence === 0
      ? 0
      : Math.max(prefs[idx].confidence, payload.confidence ?? candidate.confidence)
    prefs[idx] = {
      ...prefs[idx],
      ...payload,
      confidence: nextConfidence,
      evidence: [...new Set([...(prefs[idx].evidence ?? []), ...candidate.evidence.map(e => e.date ?? today)])],
      source: 'extractor',
      confirmed: prefs[idx].confirmed ?? false,
      lastSeen: today,
      updatedAt: now,
    } as Preference
  } else {
    const newId = `pref_${today.replace(/-/g, '')}_${String(prefs.length + 1).padStart(3, '0')}`
    prefs.push({
      id: newId,
      category: payload.category,
      key: payload.key,
      description: payload.description,
      confidence: payload.confidence ?? candidate.confidence,
      evidence: candidate.evidence.map(e => e.date ?? today),
      counterEvidence: payload.counterEvidence,
      volatility: payload.volatility ?? 'moderate',
      source: 'extractor',
      confirmed: false,
      lastSeen: today,
      updatedAt: now,
    })
  }
  savePreferences(prefs)
}

function promoteSkill(candidate: MemoryCandidate): SkillCard | null {
  const payload = candidate.payload as SkillCard
  if (!payload.title || !payload.insight || !payload.sourceDate) {
    throw new Error('skill candidate payload is incomplete')
  }

  const cards = getSkills()
  if (cards.some(card => card.title === payload.title)) return null

  let card = payload
  if (cards.some(existing => existing.id === payload.id)) {
    const todayPrefix = `skill_${dateInTZ().replace(/-/g, '')}_`
    const seq = cards
      .filter(existing => existing.id.startsWith(todayPrefix))
      .map(existing => Number(existing.id.slice(todayPrefix.length)))
      .filter(Number.isFinite)
      .reduce((max, n) => Math.max(max, n), 0) + 1
    card = {
      ...payload,
      id: `${todayPrefix}${String(seq).padStart(3, '0')}`,
      sourceDate: dateInTZ(),
      createdAt: new Date().toISOString(),
    }
  }
  saveSkills([...cards, card])
  return card
}

export function promoteCandidate(id: string): MemoryCandidate {
  const found = findCandidate(id)
  if (!found) throw new Error(`candidate not found: ${id}`)
  if (found.candidate.status !== 'pending') return found.candidate

  let finalStatus: MemoryCandidateStatus = 'promoted'
  if (found.candidate.proposedType === 'preference') promotePreference(found.candidate)
  else if (found.candidate.proposedType === 'skill') {
    const promoted = promoteSkill(found.candidate)
    if (promoted) found.candidate.payload = promoted
    else finalStatus = 'merged'
  }
  else throw new Error(`promote unsupported for ${found.candidate.proposedType}`)

  found.candidate.status = finalStatus
  found.candidate.promotedAt = new Date().toISOString()
  found.candidate.updatedAt = found.candidate.promotedAt
  saveCandidates(found.candidates, found.date)
  return found.candidate
}

export function updateCandidateStatus(id: string, status: Exclude<MemoryCandidateStatus, 'promoted'>): MemoryCandidate {
  const found = findCandidate(id)
  if (!found) throw new Error(`candidate not found: ${id}`)
  found.candidate.status = status
  found.candidate.updatedAt = new Date().toISOString()
  saveCandidates(found.candidates, found.date)
  return found.candidate
}
