/**
 * Executor 节点（Parallel 模式）
 * 由 Send API 触发，独立运行一个专项 Agent 完成子任务
 * 结果通过 subtaskResults reducer 合并回父 GraphState
 */

import { HumanMessage }   from '@langchain/core/messages'
import type { BaseMessage } from '@langchain/core/messages'
import { getAgentById }   from '../agents'
import type { SubTask }   from '../state'

interface ExecutorInput {
  messages: BaseMessage[]
  subtask:  SubTask
}

export async function executorNode(state: ExecutorInput) {
  const agent = getAgentById(state.subtask.agentId)

  const result = await agent.invoke({
    messages: [
      ...state.messages,
      new HumanMessage(state.subtask.description),
    ],
  })

  const lastMsg = result.messages.at(-1)
  const content = typeof lastMsg?.content === 'string'
    ? lastMsg.content
    : JSON.stringify(lastMsg?.content ?? '')

  // 返回值通过父 GraphState 的 subtaskResults reducer 合并
  return {
    subtaskResults: { [state.subtask.id]: content },
  }
}
