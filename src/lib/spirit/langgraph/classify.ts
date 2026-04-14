/**
 * 轻量任务分类器（无 LLM，纯规则）
 *
 * 返回 'direct'  → 跳过 Planner，直接进 qingxiao
 * 返回 'plan'    → 走 Planner 做策略决策
 *
 * 设计原则：宁可把复杂任务误判为 direct（qingxiao 仍能用工具完成），
 * 也不要把简单任务误判为 plan（浪费一次 LLM 调用）。
 */

import type { BaseMessage } from '@langchain/core/messages'

export function quickClassify(messages: BaseMessage[]): 'direct' | 'plan' {
  const last = (messages.at(-1)?.content ?? '') as string
  const text = last.trim()

  // 极短消息 / 明显闲聊 → direct
  if (text.length < 60) return 'direct'

  // 单一工具意图 → direct（qingxiao 自己就能处理）
  const DIRECT_PATTERNS = [
    /^(搜索|查一下|查查|找一下|帮我搜|帮我查|搜集|帮我搜集)/,
    /(请.{0,3})?(帮我.{0,3})?(搜索|搜集|查一下|找一下|查找)/,          // 带"请/帮我"前缀的搜索
    /搜集.{0,20}资料|找.{0,20}资料|查.{0,20}资料|相关资料|学习资料/,  // 搜集资料类
    /^(ls|cat|git |npm |node |find |grep )/,   // shell 命令直接开头
    /藏经阁|技能卡|誓约|修炼|打卡|刷题/,
    /^(解释|分析|翻译|总结|帮我写|写一下|帮写)/,
    /是什么|怎么做|如何|为什么|怎么|什么是/,
    /梳理|整理|看看|列一下|列出/,              // 整理性任务 → qingxiao+shell
    /代码|文件|目录|结构|架构/,                // 代码相关 → qingxiao+shell
    /了解.{0,10}(一下|用|用法|怎么|如何)|学习.{0,10}(用|使用|资料)/,  // 学习意图
  ]
  if (DIRECT_PATTERNS.some(p => p.test(text))) return 'direct'

  // 明确需要多 Agent 协作 → plan
  const PLAN_PATTERNS = [
    /分别.{0,20}(搜索|查询|分析).{0,20}(和|与|及)/,
    /先.{0,15}再.{0,15}(然后|最后).{0,15}(搜|查|分析)/,
    /同时.{0,10}(搜索|拉取|处理).{0,20}和.{0,20}(搜索|拉取)/,
    /(两个|三个|多个).{0,5}(Agent|专项|任务)/,
    /并行.{0,10}(搜索|执行|处理)/,
  ]
  if (PLAN_PATTERNS.some(p => p.test(text))) return 'plan'

  // 默认 direct（与 Planner 的策略收紧原则一致）
  return 'direct'
}
