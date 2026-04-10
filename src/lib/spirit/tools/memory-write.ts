/**
 * 记忆写入工具（Issue 2）
 *
 * 让 AI 在对话中主动写入记忆，而不依赖外部 sync 进程：
 *   write_note               — 自由文本追加到今日笔记文件
 *   update_persona_observation — 向人格档案追加观察
 *   save_skill_card          — 保存技术洞察卡片
 */

import { registerTool }  from '../registry'
import {
  getPersona, savePersona,
  getSkills,  saveSkills,
}                        from '../memory'
import fs   from 'fs'
import path from 'path'

const NOTES_DIR = path.resolve(process.cwd(), 'content/spirit/notes')

// ── write_note ────────────────────────────────────────────────

registerTool({
  name: 'write_note',
  description: `在今日笔记中追加一条记录。

使用时机：
- 对话中发现值得记录的洞察，想在未来对话中记得
- 用户说"帮我记一下..."、"记住这个..."
- 对话结束前汇总关键结论

格式：自由文本，支持 Markdown，会自动追加时间戳。`,
  parameters: {
    type: 'object',
    properties: {
      content: { type: 'string', description: '要记录的内容' },
      tag:     {
        type: 'string',
        enum: ['insight', 'todo', 'observation', 'summary', 'note'],
        description: '可选标签',
      },
    },
    required: ['content'],
  },
}, async ({ content, tag }) => {
  fs.mkdirSync(NOTES_DIR, { recursive: true })
  const today  = new Date().toISOString().slice(0, 10)
  const time   = new Date().toTimeString().slice(0, 5)
  const file   = path.join(NOTES_DIR, `${today}.md`)
  const tagStr = tag ? ` [${tag}]` : ''
  const line   = `\n## ${time}${tagStr}\n${content as string}\n`
  fs.appendFileSync(file, line, 'utf-8')
  return {
    content: `已记录到 ${today} 笔记`,
    brief:   '笔记已追加',
  }
}, { displayName: '写入笔记' })

// ── update_persona_observation ────────────────────────────────

registerTool({
  name: 'update_persona_observation',
  description: `向人格档案追加新的观察（特征或惯性问题）。

使用时机：
- 发现修士新的行为规律，且已多次重复出现（不是一次就记）
- 用户达成某个里程碑值得记录
- 发现的规律有预测价值（比如"每次压力大就断更"）

不要轻易调用：只记录真正反复出现、有实际价值的规律。`,
  parameters: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['trait', 'issue', 'milestone'],
        description: 'trait=行为特征　issue=惯性问题　milestone=里程碑',
      },
      observation: { type: 'string', description: '具体观察内容（一句话，≤50字）' },
    },
    required: ['type', 'observation'],
  },
}, async ({ type, observation }) => {
  const persona = getPersona()
  const obs     = (observation as string).trim()
  const now     = new Date().toISOString().slice(0, 10)

  if (type === 'trait') {
    if (!persona.observedTraits.includes(obs)) {
      persona.observedTraits = [...persona.observedTraits.slice(-9), obs]
    }
  } else if (type === 'issue') {
    if (!persona.recurringIssues.includes(obs)) {
      persona.recurringIssues = [...persona.recurringIssues.slice(-9), obs]
    }
  } else if (type === 'milestone') {
    persona.milestones = [...(persona.milestones ?? []), { date: now, event: obs }]
  }

  persona.lastUpdated = now
  savePersona(persona)
  return {
    content: `人格档案已更新（${type}：${obs}）`,
    brief:   '档案已更新',
  }
}, { displayName: '更新人格档案' })

// ── save_skill_card ───────────────────────────────────────────

registerTool({
  name: 'save_skill_card',
  description: `将对话中产生的技术洞察保存为技能卡，供未来对话使用。

使用时机：
- 当前对话解决了一个有复用价值的技术问题
- 讨论出某个值得记住的设计决策或经验教训
- 修士自己明确要求"把这个记下来"

不要保存显而易见的东西，只保存有实际价值、未来会用到的洞察。`,
  parameters: {
    type: 'object',
    properties: {
      title:   { type: 'string', description: '标题（≤20字）' },
      insight: { type: 'string', description: '洞察内容（2-4句，具体可操作）' },
      tags:    { type: 'array', items: { type: 'string' }, description: '标签列表（可选）' },
    },
    required: ['title', 'insight'],
  },
}, async ({ title, insight, tags = [] }) => {
  const cards = getSkills()
  const now   = new Date().toISOString().slice(0, 10)
  const id    = `skill_${now.replace(/-/g, '')}_${String(cards.length + 1).padStart(3, '0')}`

  cards.push({
    id,
    title:      title as string,
    insight:    insight as string,
    tags:       (tags as string[]) ?? [],
    sourceDate: now,
    createdAt:  new Date().toISOString(),
    useCount:   0,
  })
  saveSkills(cards)
  return {
    content: `技能卡「${title}」已保存（共 ${cards.length} 张）`,
    brief:   `技能卡已保存`,
  }
}, { displayName: '保存技能卡' })
