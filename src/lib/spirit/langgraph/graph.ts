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
import {
  createQingxiaoAgent,
  createSearchAgent,
  createCodeAgent,
  createPlannerAgent,
} from './agents'
import { plannerNode }     from './nodes/planner'
import { supervisorNode }  from './nodes/supervisor'
import { executorNode }    from './nodes/executor'
import { synthesizerNode } from './nodes/synthesizer'

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

function buildFullGraph() {
  const graph = new StateGraph(GraphState)
    .addNode('planner',       plannerNode)
    .addNode('supervisor',    supervisorNode)
    .addNode('executor',      executorNode)
    .addNode('synthesizer',   synthesizerNode)
    .addNode('qingxiao',      createQingxiaoAgent())
    .addNode('search_agent',  createSearchAgent())
    .addNode('code_agent',    createCodeAgent())
    .addNode('planner_agent', createPlannerAgent())

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

  // Sequential 链路：supervisor 路由到专项 Agent
  graph.addConditionalEdges('supervisor', (s) => s.next, {
    search_agent:  'search_agent',
    code_agent:    'code_agent',
    planner_agent: 'planner_agent',
    qingxiao:      'qingxiao',
    FINISH:        '__end__',
  })

  // 专项 Agent 出口（sequential 回 supervisor，direct 结束）
  for (const id of ['qingxiao', 'search_agent', 'code_agent', 'planner_agent'] as const) {
    graph.addConditionalEdges(id, agentExitRouter)
  }

  return graph.compile()
}

// ── 直通图（调试用：传入具体 agentId 时使用） ────────────────

function buildDirectGraph(agentId: string) {
  const agentNode = agentId === 'search_agent'  ? createSearchAgent()
    : agentId === 'code_agent'                  ? createCodeAgent()
    : agentId === 'planner_agent'               ? createPlannerAgent()
    : createQingxiaoAgent()

  return new StateGraph(GraphState)
    .addNode('agent', agentNode)
    .addEdge('__start__', 'agent')
    .addEdge('agent', '__end__')
    .compile()
}

// ── 模块级缓存（避免每次请求重建图） ─────────────────────────

let _fullGraph: ReturnType<typeof buildFullGraph> | null = null
const _directGraphs = new Map<string, ReturnType<typeof buildDirectGraph>>()

/** 动态安装新 MCP 工具后调用，强制下次请求重建完整图 */
export function invalidateGraphCache() {
  _fullGraph = null
  _directGraphs.clear()
}

// ── 对外接口 ──────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CompiledGraph = any

/**
 * 按 agentId 返回对应的编译图（模块级缓存，同进程内复用）
 *   undefined / "auto" → 完整图（Planner 自动决策策略）
 *   具体 agentId       → 直通该 Agent（跳过 Planner，调试用）
 */
export function getCompiledGraph(agentId?: string): CompiledGraph {
  if (agentId && agentId !== 'auto') {
    if (!_directGraphs.has(agentId)) {
      _directGraphs.set(agentId, buildDirectGraph(agentId))
    }
    return _directGraphs.get(agentId)!
  }
  if (!_fullGraph) _fullGraph = buildFullGraph()
  return _fullGraph
}

/** recursionLimit：防止无限循环 */
export function getRecursionLimit(parallelCount = 1): number {
  const base = config.spirit?.maxToolRounds ?? 6
  // parallel 时每个 executor 内部有自己的 tool 轮次
  return base * (parallelCount + 2)
}
