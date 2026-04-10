import { Annotation, messagesStateReducer } from '@langchain/langgraph'
import type { BaseMessage } from '@langchain/core/messages'

export interface SubTask {
  id:          string
  agentId:     string   // 'search_agent' | 'code_agent' | 'planner_agent' | 'qingxiao'
  description: string   // 传给 executor 的具体子任务指令
}

export const GraphState = Annotation.Root({
  /** 对话消息历史，append-only */
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),

  /** Planner 决定的执行策略 */
  strategy: Annotation<'direct' | 'sequential' | 'parallel' | null>({
    reducer: (_, update) => update,
    default: () => null,
  }),

  /** Sequential 模式：supervisor 路由决策（节点名 or "FINISH"） */
  next: Annotation<string>({
    reducer: (_, update) => update,
    default: () => 'FINISH',
  }),

  /** Parallel 模式：子任务定义列表 */
  subtasks: Annotation<SubTask[]>({
    reducer: (_, update) => update,
    default: () => [],
  }),

  /** Parallel 模式：各 executor 写入各自结果，reducer 并行合并 */
  subtaskResults: Annotation<Record<string, string>>({
    reducer: (left, right) => ({ ...left, ...right }),
    default: () => ({}),
  }),

  /** quickClassify 判定为 direct 时跳过 Planner，直接进 qingxiao */
  usePlanner: Annotation<boolean>({
    reducer: (_, update) => update,
    default: () => true,
  }),
})

export type GraphStateType = typeof GraphState.State
