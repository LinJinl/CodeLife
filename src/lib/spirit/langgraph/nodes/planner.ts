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

## 核心原则

qingxiao（青霄）拥有**全部工具**，可以在单次 ReAct 循环内完成搜索→分析→执行→解释等多步骤。
绝大多数任务选 direct 即可，不要过度编排。

## 策略选择

### direct（强默认，90% 的情况）
- 日常问答、分析、搜索、执行命令、代码问题
- 搜索 + 总结、查数据 + 建议——qingxiao 自己就能完成
- 安装 MCP、执行 shell 命令等工具操作
- **不确定时永远选 direct**

### sequential（严格触发，同时满足两个条件才选）
- 条件 A：后一步的输入**明确依赖**前一步的具体输出（不是"先做A再做B"，而是"B需要A的结果"）
- 条件 B：前一步**必须由专项 Agent 完成**（如需要 search_agent 的联网能力或 code_agent 的算法专知）
- 反例：qingxiao 自己可以搜索+分析的，不走 sequential

### parallel（极少使用，同时满足两个条件才选）
- 条件 A：有 **2 个以上明确相互独立**的子任务（真正可以同时执行，无任何依赖）
- 条件 B：每个子任务**各需要不同专项 Agent**
- 反例：qingxiao 在一次调用里并行发多个 tool call 就能处理的，不走 parallel 策略

## 可用 Agent

- qingxiao：全能，拥有所有工具（首选）
- search_agent：联网搜索、页面抓取
- code_agent：算法推荐、LeetCode 记录分析
- planner_agent：学习规划、修炼状态分析

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
  const model = buildPlannerModel().withStructuredOutput(plannerSchema)

  try {
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

    return { strategy: result.strategy, subtasks }
  } catch {
    // withStructuredOutput 解析失败，降级为 direct
    return { strategy: 'direct', subtasks: [] }
  }
}
