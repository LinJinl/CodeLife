/**
 * Spirit SSE 协议 — 客户端与服务端共享的事件类型
 */

export interface SkillCardData {
  id:          string
  title:       string
  insight:     string    // 一句话摘要
  body?:       string    // 完整 markdown 内容
  tags:        string[]
  sourceDate:  string
  createdAt:   string
  useCount:    number
  userNotes?:  string
  editedAt?:   string
}

export interface LibraryCard {
  id:       string
  url?:     string
  title:    string
  summary:  string
  tags:     string[]
  category: string
  savedAt:  string
}

export type SpiritEvent =
  | { type: 'text';       chunk: string }
  | { type: 'thinking';   chunk: string }
  | { type: 'tool_start'; name: string; display: string; desc?: string }
  | { type: 'tool_done';  name: string; brief?: string; links?: { title: string; url: string }[] }
  | { type: 'cards';       entries: LibraryCard[] }
  | { type: 'skill_card';  card: SkillCardData }
  | { type: 'skill_cards'; entries: SkillCardData[] }
  | { type: 'error';       message: string }
  | { type: 'done' }
  // ── 多 Agent 事件 ──────────────────────────────────────────
  | { type: 'agent_start'; agent: string; display: string }
  | { type: 'agent_end';   agent: string }
  // ── 自适应策略事件 ─────────────────────────────────────────
  | { type: 'strategy';    mode: 'direct' | 'sequential' | 'parallel'; taskCount?: number }
  | { type: 'task_start';  taskId: string; agent: string; display: string; desc: string }
  | { type: 'task_done';   taskId: string; agent: string }
  // ── 权限请求 ───────────────────────────────────────────────
  | { type: 'permission_request'; token: string; command: string; workdir: string; level: 'moderate' | 'destructive' | 'write' }

/** 序列化成 SSE data 行 */
export function encodeEvent(event: SpiritEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`
}

/** 解析 SSE data 行，失败返回 null */
export function decodeEvent(line: string): SpiritEvent | null {
  if (!line.startsWith('data: ')) return null
  try {
    return JSON.parse(line.slice(6)) as SpiritEvent
  } catch {
    return null
  }
}
