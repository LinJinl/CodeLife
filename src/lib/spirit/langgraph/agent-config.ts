/**
 * Agent 注册表 — 单一来源
 * AgentId 类型、AGENT_IDS tuple、AGENT_DISPLAY 均从此派生，
 * 新增 Agent 只需在 AGENT_DEFS 里加一行。
 */

export interface AgentDef {
  id:          string
  displayName: string
}

export const AGENT_DEFS = [
  { id: 'search_agent',  displayName: '搜寻使' },
  { id: 'code_agent',    displayName: '算法师' },
  { id: 'planner_agent', displayName: '星盘官' },
  { id: 'qingxiao',      displayName: '青霄'   },
] as const satisfies AgentDef[]

export type AgentId = typeof AGENT_DEFS[number]['id']

/** Zod z.enum() 需要 readonly [string, ...string[]] 形式 */
export const AGENT_IDS = AGENT_DEFS.map(a => a.id) as unknown as
  readonly [AgentId, ...AgentId[]]

export const AGENT_DISPLAY: Record<string, string | undefined> = Object.fromEntries(
  AGENT_DEFS.map(a => [a.id, a.displayName]),
)
