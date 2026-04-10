/**
 * Synthesizer 节点（Parallel 模式收尾）
 * 等所有 executor 完成后，将并行结果合并为统一回答
 */

import { SystemMessage }   from '@langchain/core/messages'
import { buildChatModel }  from '../agents'
import { AGENT_DISPLAY }   from '../tools'
import type { GraphStateType } from '../state'

export async function synthesizerNode(state: GraphStateType): Promise<Partial<GraphStateType>> {
  const parts = state.subtasks.map(t => {
    const agentName = AGENT_DISPLAY[t.agentId] ?? t.agentId
    const result    = state.subtaskResults[t.id] ?? '（无结果）'
    return `### ${agentName}：${t.description}\n\n${result}`
  }).join('\n\n---\n\n')

  const model  = buildChatModel()
  const result = await model.invoke([
    new SystemMessage(
      `以下是各专项 Agent 并行执行的结果，请综合整理为一份统一、连贯的回答，避免重复内容，突出关键信息：\n\n${parts}`
    ),
    ...state.messages,
  ])

  return { messages: [result] }
}
