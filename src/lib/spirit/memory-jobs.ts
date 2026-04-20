import type { ChatOpenAI } from '@langchain/openai'
import type { ConversationMessage } from './memory'
import { extractPreferences } from './preference-extractor'
import { extractSkills } from './skill-extractor'

function transcriptText(messages: ConversationMessage[]): string {
  return messages.slice(-12).map(m => m.content).join('\n')
}

function shouldRunSkillExtraction(messages: ConversationMessage[]): boolean {
  if (messages.length < 4) return false
  const text = transcriptText(messages)
  if (text.length > 1800) return true
  return /架构|设计|实现|bug|修复|根因|方案|代码|TypeScript|Next\.js|LangGraph|MCP|Agent|embedding|检索/.test(text)
}

function shouldRunPreferenceExtraction(messages: ConversationMessage[]): boolean {
  const lastUser = [...messages].reverse().find(m => m.role === 'user')?.content ?? ''
  return /以后|记住|偏好|喜欢|不喜欢|回答.*(精简|详细|直接)|不要|别再|习惯/.test(lastUser)
}

/**
 * 对话保存后的轻量记忆任务。
 * 摘要由 session route 单独生成；这里只补充偏好和技能的增量提炼。
 */
export async function runPostConversationMemoryJobs(
  _date: string,
  messages: ConversationMessage[],
  model: ChatOpenAI,
): Promise<void> {
  const tasks: Promise<unknown>[] = []

  if (shouldRunPreferenceExtraction(messages)) {
    tasks.push(extractPreferences(3, model))
  }
  if (shouldRunSkillExtraction(messages)) {
    tasks.push(extractSkills(3, model))
  }

  if (tasks.length > 0) {
    await Promise.allSettled(tasks)
  }
}
