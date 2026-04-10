/**
 * Supervisor 节点（Sequential 模式编排）
 * 决定下一步调用哪个专项 Agent，或宣告 FINISH
 */

import { SystemMessage }  from '@langchain/core/messages'
import { z }              from 'zod'
import { buildPlannerModel } from '../agents'
import type { GraphStateType } from '../state'

const SUPERVISOR_SYSTEM_PROMPT = `你是任务调度器，负责在多步骤任务中决定下一步应该由哪个专项 Agent 执行。

## 专项 Agent 能力

- search_agent（搜寻使）：联网搜索、页面抓取、信息收集
- code_agent（算法师）：LeetCode 记录、算法推荐、代码分析
- planner_agent（星盘官）：修炼状态、学习规划、目标拆解
- qingxiao（青霄）：综合问答、写作、使用全部工具的通用任务

## 决策规则

1. 仔细阅读对话历史，判断哪些子目标已完成（已有搜索结果、已有分析结论）
2. 若已有足够信息可以回答用户 → 立即返回 FINISH，不要多余调用 Agent
3. 每次只分配一个 Agent，且只分配**尚未完成**的子目标
4. 禁止重复分配：若历史消息中已有某类信息（如藏经阁搜索结果），不要再安排同类搜索
5. planner_agent 专职规划，在信息收集完成后再调用；code_agent / search_agent 专职信息收集

必须返回 JSON，不输出其他内容。`

const supervisorSchema = z.object({
  next: z.enum(['search_agent', 'code_agent', 'planner_agent', 'qingxiao', 'FINISH']),
  reasoning: z.string(),  // 内部推理，不推送给前端
})

export async function supervisorNode(state: GraphStateType): Promise<Partial<GraphStateType>> {
  const model = buildPlannerModel().withStructuredOutput(supervisorSchema)

  try {
    const result = await model.invoke([
      new SystemMessage(SUPERVISOR_SYSTEM_PROMPT),
      ...state.messages,
    ])
    return { next: result.next }
  } catch {
    // withStructuredOutput 解析失败：模型输出了自然语言而非 JSON
    // 此时 messages 里已有完整回答，直接 FINISH
    return { next: 'FINISH' }
  }
}
