/**
 * SpiritWidget 共享类型 + 常量
 */

import type { LibraryCard, SkillCardData } from '@/lib/spirit/protocol'

export interface ExecutionStep {
  id:       string
  type:     'task' | 'tool'
  display:  string
  desc?:    string
  brief?:   string
  links?:   { title: string; url: string }[]
  done:     boolean
}

export interface PermissionRequest {
  token:    string
  command:  string
  workdir:  string
  level:    'moderate' | 'destructive' | 'write'
  resolved: boolean
}

export interface Message {
  role:               'user' | 'assistant'
  content:            string
  timestamp:          string
  cards?:             LibraryCard[]
  skillCard?:         SkillCardData
  skillCards?:        SkillCardData[]
  steps?:             ExecutionStep[]
  strategy?:          'direct' | 'sequential' | 'parallel'
  ctxLabels?:         string[]
  permissionRequest?: PermissionRequest
  thinking?:          string
}

export interface MCPInfo {
  allowDynamicInstall: boolean
  adapters: { namespace: string; name: string }[]
  tools: { name: string; displayName: string; description: string; category: string; params: string[] }[]
}

export type SlashCommand = { cmd: string; desc: string; fill: string }

export const SLASH_COMMANDS = [
  { cmd: '/观心', desc: '分析近期修炼状态',           fill: '近况如何' },
  { cmd: '/指路', desc: '推荐今日该做什么',           fill: '今天该做什么' },
  { cmd: '/问道', desc: '提问技术或概念问题',         fill: '我想问：' },
  { cmd: '/立誓', desc: '设定一个可验证的目标',       fill: '我想定一个目标：' },
  { cmd: '/炼心', desc: '提炼本次对话为技能卡',       fill: '请从本次对话中提炼最有价值的知识洞察，保存为技能卡。' },
  { cmd: '/藏经', desc: '收藏文章到藏经阁',           fill: '帮我收藏这篇文章：' },
  { cmd: '/寻典', desc: '检索藏经阁中的文章',         fill: '帮我检索藏经阁中关于' },
  { cmd: '/此页', desc: '将当前页面内容注入上下文',   fill: '' },
  { cmd: '/install', desc: '装载 MCP 法器包',         fill: '/install ' },
] as const
