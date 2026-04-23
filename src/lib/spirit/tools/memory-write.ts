/**
 * 记忆写入工具（Issue 2）
 *
 * 让 AI 在对话中主动写入记忆，而不依赖外部 sync 进程：
 *   write_note               — 自由文本追加到今日笔记文件
 *   update_persona_observation — 向人格档案追加观察
 *   save_skill_card          — 保存可复用能力卡
 */

import { registerTool }  from '../registry'
import {
  getPersona, savePersona,
  getSkills,  saveSkills,
  getSkillEmbeddings, saveSkillEmbeddings,
}                        from '../memory'
import { cosine } from '../hybrid-search'
import { makeEmbedder } from '../hybrid-search-service'
import { dateInTZ, timeInTZ } from '../time'
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
  const today  = dateInTZ()
  const time   = timeInTZ()
  const file   = path.join(NOTES_DIR, `${today}.md`)
  const tagStr = tag ? ` [${tag}]` : ''
  const line   = `\n## ${time}${tagStr}\n${content as string}\n`
  fs.appendFileSync(file, line, 'utf-8')
  return {
    content: `已记录到 ${today} 笔记`,
    brief:   '笔记已追加',
  }
}, { displayName: '写入笔记', domain: 'knowledge' })

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
  const now     = dateInTZ()

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
}, { displayName: '更新人格档案', domain: 'memory' })

// ── save_skill_card ───────────────────────────────────────────

registerTool({
  name: 'save_skill_card',
  description: `将对话中产生的可复用能力保存为技能卡，供未来对话调用。

Skill 不是文档摘要。它应该是下一次遇到相似任务时可直接复用的操作规程、排查流程、设计决策框架或检查清单。

使用时机：
- 当前对话解决了一个有复用价值的技术问题
- 讨论出某个值得记住的设计决策或经验教训
- 修士自己明确要求"把这个记下来"

不要保存显而易见的东西，不要把搜索结果/文档内容改写成摘要。只有能指导未来行动的内容才保存。
工具会自动检查相似技能卡；若已存在高度相似内容，会合并到旧卡 userNotes，而不是新建重复卡。`,
  parameters: {
    type: 'object',
    properties: {
      title:   { type: 'string', description: '标题（≤20字）' },
      insight: { type: 'string', description: '一句话能力描述：下次遇到什么任务时，用它怎么做（≤60字）' },
      body:    {
        type: 'string',
        description: '可选。Markdown 能力卡，建议包含：适用场景、操作步骤、检查清单、反例、证据。不要写成长文总结。',
      },
      tags:    { type: 'array', items: { type: 'string' }, description: '标签列表（可选）' },
    },
    required: ['title', 'insight'],
  },
}, async ({ title, insight, body, tags = [] }) => {
  const cards  = getSkills()
  const now    = dateInTZ()
  const text   = `${title as string}。${insight as string}`
  const similar = await findSimilarSkill(text)
  if (similar && similar.score >= 0.86) {
    const idx = cards.findIndex(c => c.id === similar.id)
    if (idx >= 0) {
      const note = `\n\n[${now}] 相似洞察合并：${insight as string}`
      cards[idx] = {
        ...cards[idx],
        tags:      [...new Set([...cards[idx].tags, ...((tags as string[]) ?? [])])],
        userNotes: `${cards[idx].userNotes ?? ''}${note}${body ? `\n${body as string}` : ''}`.trim(),
        editedAt:  new Date().toISOString(),
      }
      saveSkills(cards)
      return {
        content: JSON.stringify(cards[idx]),
        brief:   `发现相似技能卡「${cards[idx].title}」，已合并`,
      }
    }
  }

  const todayPrefix = `skill_${now.replace(/-/g, '')}_`
  const seq = cards
    .filter(c => c.id.startsWith(todayPrefix))
    .map(c => Number(c.id.slice(todayPrefix.length)))
    .filter(Number.isFinite)
    .reduce((max, n) => Math.max(max, n), 0) + 1
  const id = `${todayPrefix}${String(seq).padStart(3, '0')}`
  const newCard = {
    id,
    title:      title as string,
    insight:    insight as string,
    ...(typeof body === 'string' && body.trim() ? { body: body.trim() } : {}),
    tags:       (tags as string[]) ?? [],
    sourceDate: now,
    createdAt:  new Date().toISOString(),
    useCount:   0,
  }

  cards.push(newCard)
  saveSkills(cards)
  await cacheSkillEmbedding(id, text)
  // content 为 JSON，供 stream.ts 解析并推送 skill_card 事件到前端
  return {
    content: JSON.stringify(newCard),
    brief:   `技能卡「${title}」已保存`,
  }
}, { displayName: '保存技能卡', domain: 'knowledge' })

async function findSimilarSkill(text: string): Promise<{ id: string; score: number } | null> {
  const cards = getSkills()
  if (cards.length === 0) return null

  try {
    const cache = getSkillEmbeddings()
    const cacheMap = new Map(cache.map(e => [e.id, e.vec]))
    const missing = cards.filter(c => !cacheMap.has(c.id))
    const embedder = makeEmbedder()

    if (missing.length > 0) {
      const vecs = await embedder.embedDocuments(missing.map(c => `${c.title}。${c.insight}`))
      missing.forEach((c, i) => cacheMap.set(c.id, vecs[i]))
      saveSkillEmbeddings(Array.from(cacheMap.entries()).map(([id, vec]) => ({ id, vec })))
    }

    const queryVec = await embedder.embedQuery(text)
    return cards
      .map(c => ({ id: c.id, score: cosine(queryVec, cacheMap.get(c.id) ?? []) }))
      .sort((a, b) => b.score - a.score)[0] ?? null
  } catch {
    const lowered = text.toLowerCase()
    const hit = cards.find(c => lowered.includes(c.title.toLowerCase()) || c.title.toLowerCase().includes(lowered))
    return hit ? { id: hit.id, score: 0.9 } : null
  }
}

async function cacheSkillEmbedding(id: string, text: string) {
  try {
    const cache = getSkillEmbeddings()
    if (cache.some(e => e.id === id)) return
    const vec = await makeEmbedder().embedQuery(text)
    saveSkillEmbeddings([...cache, { id, vec }])
  } catch {
    // Embedding 缓存失败不影响技能卡写入。
  }
}
