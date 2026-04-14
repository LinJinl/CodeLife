/**
 * LangGraph 自适应多 Agent 编排图
 *
 * 三种执行策略（由 Planner 节点按任务动态选择）：
 *
 *   direct     → qingxiao → __end__
 *   sequential → supervisor ⇄ [specialists] → __end__
 *   parallel   → Send([executor×N]) → synthesizer → __end__
 *
 * 传入具体 agentId（调试用）时跳过 planner，直接走 direct 路径。
 */

import { StateGraph, Send } from '@langchain/langgraph'
import config               from '../../../../codelife.config'
import { GraphState }       from './state'
import type { GraphStateType, SubTask } from './state'
import { quickClassify }    from './classify'
import { SPECIALIST_AGENTS, createQingxiaoAgent } from './agents'
import { AGENT_IDS } from './agent-config'
import { plannerNode }     from './nodes/planner'
import { supervisorNode }  from './nodes/supervisor'
import { executorNode }    from './nodes/executor'
import { synthesizerNode } from './nodes/synthesizer'
import type { ToolDomain } from './tools'

// ── 路由函数 ──────────────────────────────────────────────────

/** 图入口：usePlanner=false 时跳过 Planner，直接进 qingxiao */
function entryRouter(state: GraphStateType): string {
  return state.usePlanner ? 'planner' : 'qingxiao'
}

/** Planner 出口：按 strategy 分发 */
function strategyRouter(state: GraphStateType): string | Send[] {
  if (state.strategy === 'sequential') return 'supervisor'
  if (state.strategy === 'parallel' && state.subtasks.length > 0) {
    return state.subtasks.map((t: SubTask) =>
      new Send('executor', { messages: state.messages, subtask: t })
    )
  }
  return 'qingxiao'   // direct（默认 fallback）
}

/** 专项 Agent 出口：sequential 回 supervisor，direct 直接结束 */
function agentExitRouter(state: GraphStateType): string {
  return state.strategy === 'sequential' ? 'supervisor' : '__end__'
}

// ── 完整图（auto 模式） ───────────────────────────────────────

/**
 * 构建完整图
 * domains：青霄可见工具域。对个人应用而言每次请求重建图开销很低（纯 JS，无 I/O），
 * 因此不再模块级缓存，确保每次请求的工具域与当前消息意图匹配。
 */
function buildFullGraph(domains?: ToolDomain[]) {
  // LangGraph 的泛型通过方法链静态追踪节点名，动态 addNode 无法满足其类型约束，
  // 故整体 cast 为 any。运行时完全正确，返回类型 CompiledGraph 本身也是 any。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const graph: any = new StateGraph(GraphState)
    .addNode('planner',     plannerNode)
    .addNode('supervisor',  supervisorNode)
    .addNode('executor',    executorNode)
    .addNode('synthesizer', synthesizerNode)

  // 动态注册专项 Agent 节点
  // qingxiao 使用 per-request 的 domains，其他 specialist agent 已经有自己的 agents 字段
  for (const agentId of AGENT_IDS) {
    const factory = agentId === 'qingxiao'
      ? () => createQingxiaoAgent(domains)
      : SPECIALIST_AGENTS[agentId]
    graph.addNode(agentId, factory())
  }

  // 主入口：根据 usePlanner 决定是否走 Planner
  graph.addConditionalEdges('__start__', entryRouter, {
    planner:  'planner',
    qingxiao: 'qingxiao',
  })

  // Planner → 策略分发
  graph.addConditionalEdges('planner', strategyRouter)

  // Parallel 链路
  graph.addEdge('executor',    'synthesizer')
  graph.addEdge('synthesizer', '__end__')

  // Sequential 链路：supervisor 路由按 AGENT_IDS 动态构建
  const supervisorRoutes: Record<string, string> = { FINISH: '__end__' }
  for (const agentId of AGENT_IDS) supervisorRoutes[agentId] = agentId
  graph.addConditionalEdges('supervisor', (s: GraphStateType) => s.next, supervisorRoutes)

  // 专项 Agent 出口（sequential 回 supervisor，direct 结束）
  for (const agentId of AGENT_IDS) {
    graph.addConditionalEdges(agentId, agentExitRouter)
  }

  return graph.compile()
}

// ── 直通图（调试用：传入具体 agentId 时使用） ────────────────

function buildDirectGraph(agentId: string) {
  const factory = (SPECIALIST_AGENTS as Record<string, (() => ReturnType<typeof SPECIALIST_AGENTS.qingxiao>) | undefined>)[agentId]
    ?? SPECIALIST_AGENTS.qingxiao

  return new StateGraph(GraphState)
    .addNode('agent', factory())
    .addEdge('__start__', 'agent')
    .addEdge('agent', '__end__')
    .compile()
}

// ── 模块级缓存（仅 direct 调试图） ───────────────────────────

const _directGraphs = new Map<string, ReturnType<typeof buildDirectGraph>>()

/** 动态安装新 MCP 工具后调用 */
export function invalidateGraphCache() {
  _directGraphs.clear()
}

// ── 对外接口 ──────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CompiledGraph = any

/**
 * 返回对应的编译图。
 *   undefined / "auto" → 完整图（每次请求重建，确保工具域与消息意图匹配）
 *   具体 agentId       → 直通该 Agent（跳过 Planner，调试用，缓存复用）
 *
 * 个人应用场景下重建图的开销可忽略（纯 JS 状态机编译，无 I/O）。
 */
export function getCompiledGraph(agentId?: string, domains?: ToolDomain[]): CompiledGraph {
  if (agentId && agentId !== 'auto') {
    if (!_directGraphs.has(agentId)) {
      _directGraphs.set(agentId, buildDirectGraph(agentId))
    }
    return _directGraphs.get(agentId)!
  }
  return buildFullGraph(domains)
}

/** recursionLimit：防止无限循环 */
export function getRecursionLimit(parallelCount = 1): number {
  const base = config.spirit?.maxToolRounds ?? 6
  // parallel 时每个 executor 内部有自己的 tool 轮次
  return base * (parallelCount + 2)
}
