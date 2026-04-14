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
  { cmd: '/晨省', desc: '查看修炼状态 + 今日行动建议', fill: '分析我近期的修炼状态，并给出今日行动建议。' },
  { cmd: '/立誓', desc: '设定一个可验证的目标',         fill: '我想立下一个目标：' },
  { cmd: '/藏经', desc: '收藏文章到藏经阁',             fill: '帮我收藏这篇文章：' },
  { cmd: '/寻典', desc: '检索藏经阁中的文章',           fill: '帮我检索藏经阁中关于' },
  { cmd: '/引此页', desc: '将当前页面内容注入对话',     fill: '' },
  { cmd: '/引法器', desc: '动态装载 MCP 工具包',        fill: '/引法器 ' },
] as const
