/**
 * Agent 创建工厂
 * 四种 Agent：qingxiao（全能）/ search_agent / code_agent / planner_agent
 * getAgentById 带懒加载单例缓存，供 executor 节点复用
 */

import { createReactAgent }  from '@langchain/langgraph/prebuilt'
import { ChatOpenAI }         from '@langchain/openai'
import { SystemMessage }      from '@langchain/core/messages'
import config                 from '../../../../codelife.config'
import { buildSystemPrompt }  from '../prompt'
import { getLangChainToolsFor, AGENT_DISPLAY } from './tools'

// ── 专项 Agent 的 System Prompt ────────────────────────────────

const AGENT_PROMPTS: Record<string, string> = {
  search_agent: `你是「搜寻使」，专职信息搜集的器灵分身。
职责：联网搜索、抓取页面内容，将信息整理成结构清晰的报告。
规则：
- 每轮在同一次 tool call 中并行发起所有必要的搜索，不分轮串行
- 直接输出信息，不说"我将搜索"之类的宣告
- 搜索完成后简洁汇报，不重复罗列原始链接`,

  code_agent: `你是「算法师」，专职代码与算法的器灵分身。
职责：分析 LeetCode 记录、推荐练习方向、解答代码问题。
规则：
- 推荐题目时，基于已有记录的薄弱点，给出具体题号和分析
- 代码问题直接指出问题，给出改法，不废话`,

  planner_agent: `你是「星盘官」，专职学习规划的器灵分身。
职责：分析修炼状态、制定可执行计划、拆解目标。
规则：
- 计划必须具体可验证，不说模糊的"多做练习"
- 基于真实数据（修为、打卡、进度）给出判断，不猜测
- **优先使用对话历史中已有的信息**，若前序 Agent 已完成搜索，直接引用结果，不重复调用搜索工具`,
}

// ── 构建 ChatOpenAI 实例 ──────────────────────────────────────

export function buildChatModel(modelOverride?: string): ChatOpenAI {
  const spirit = config.spirit!
  return new ChatOpenAI({
    model:       modelOverride ?? spirit.model ?? 'gpt-4o-mini',
    streaming:   true,
    configuration: {
      apiKey:  spirit.apiKey,
      baseURL: spirit.baseURL,
    },
  })
}

/** Planner 专用模型（策略路由，可以比主对话模型更轻量） */
export function buildPlannerModel(): ChatOpenAI {
  const spirit = config.spirit!
  return buildChatModel(spirit.plannerModel ?? spirit.model)
}

// ── 创建各 Agent（createReactAgent subgraph） ─────────────────

export function createQingxiaoAgent() {
  return createReactAgent({
    llm:    buildChatModel(),
    tools:  getLangChainToolsFor('qingxiao'),
    // 每次 Agent 调用时重新读取记忆文件，保证内容最新
    messageModifier: (messages) => [new SystemMessage(buildSystemPrompt()), ...messages],
  })
}

export function createSearchAgent() {
  return createReactAgent({
    llm:             buildChatModel(),
    tools:           getLangChainToolsFor('search_agent'),
    messageModifier: new SystemMessage(AGENT_PROMPTS.search_agent),
    name:            AGENT_DISPLAY.search_agent,
  })
}

export function createCodeAgent() {
  return createReactAgent({
    llm:             buildChatModel(),
    tools:           getLangChainToolsFor('code_agent'),
    messageModifier: new SystemMessage(AGENT_PROMPTS.code_agent),
    name:            AGENT_DISPLAY.code_agent,
  })
}

export function createPlannerAgent() {
  return createReactAgent({
    llm:             buildChatModel(),
    tools:           getLangChainToolsFor('planner_agent'),
    messageModifier: new SystemMessage(AGENT_PROMPTS.planner_agent),
    name:            AGENT_DISPLAY.planner_agent,
  })
}

// ── 懒加载单例（executor 节点复用） ──────────────────────────

type CompiledAgent = ReturnType<typeof createQingxiaoAgent>
const _agentCache = new Map<string, CompiledAgent>()

/**
 * 动态安装新 MCP 工具后调用。
 * agent 是带工具列表的 compiled graph，必须重建才能感知新工具。
 */
export function invalidateAgentCache() {
  _agentCache.clear()
}

export function getAgentById(agentId: string): CompiledAgent {
  if (!_agentCache.has(agentId)) {
    const agent = agentId === 'search_agent'  ? createSearchAgent()
      : agentId === 'code_agent'              ? createCodeAgent()
      : agentId === 'planner_agent'           ? createPlannerAgent()
      : createQingxiaoAgent()
    _agentCache.set(agentId, agent)
  }
  return _agentCache.get(agentId)!
}
