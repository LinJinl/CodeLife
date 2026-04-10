/**
 * Planner 节点
 * 分析用户任务，决定执行策略（direct / sequential / parallel）
 * Parallel 策略时额外生成子任务列表和 Agent 分配
 */

import { SystemMessage }    from '@langchain/core/messages'
import { z }                from 'zod'
import { buildPlannerModel } from '../agents'
import type { GraphStateType, SubTask } from '../state'

const PLANNER_SYSTEM_PROMPT = `你是任务规划器，负责分析用户请求，决定最优执行策略。

## 可用执行策略

### direct（直接）
- 简单问答、日常对话
- 单一工具调用（搜索一个主题、查一个数据）
- 能被单个 Agent 独立完成的任务
- **默认选择**，不确定时优先选 direct

### sequential（顺序编排）
- 多步骤且后一步依赖前一步的结果
- 例：先联网搜索资料，再基于搜索结果制定学习计划
- 例：先分析刷题记录，再推荐下一阶段算法方向

### parallel（并行）
- 多个**相互独立**的子任务，无先后依赖
- 例：同时搜索 A 和 B 两个主题的最新动态
- 例：同时分析多个不同领域的问题
- **要求**：subtasks 数组中每个任务必须真正独立，可以同时执行

## 可用 Agent

- qingxiao：综合问答，拥有全部工具，适合通用任务
- search_agent：专职联网搜索和页面抓取
- code_agent：算法推荐、LeetCode 记录分析、代码问题
- planner_agent：学习规划、修炼状态分析、目标拆解

## 输出规范

必须返回 JSON，不输出其他任何内容：
- strategy 字段必填
- subtasks 仅在 parallel 策略时提供，至少 2 个，最多 5 个
- subtask.id 格式：task_1, task_2, ...
- subtask.description 用中文，具体说明该子任务的目标`

const plannerSchema = z.object({
  strategy: z.enum(['direct', 'sequential', 'parallel']),
  subtasks: z.array(z.object({
    id:          z.string(),
    agentId:     z.enum(['search_agent', 'code_agent', 'planner_agent', 'qingxiao']),
    description: z.string(),
  })).optional(),
})

export async function plannerNode(state: GraphStateType): Promise<Partial<GraphStateType>> {
  const model  = buildPlannerModel().withStructuredOutput(plannerSchema)
  const result = await model.invoke([
    new SystemMessage(PLANNER_SYSTEM_PROMPT),
    ...state.messages,
  ])

  const subtasks: SubTask[] = result.strategy === 'parallel' && result.subtasks
    ? result.subtasks.map(t => ({
        id:          t.id,
        agentId:     t.agentId,
        description: t.description,
      }))
    : []

  return {
    strategy: result.strategy,
    subtasks,
  }
}
