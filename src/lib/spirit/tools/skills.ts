/**
 * 技能洞察工具：搜索从历史对话中提炼的知识卡片
 */

import { registerTool }      from '../registry'
import { getSkills, saveSkills, replaceSkills, getSkillEmbeddings, saveSkillEmbeddings, type SkillCard } from '../memory'
import { hybridSearch, type HybridDoc }  from '../hybrid-search'

registerTool({
  name:        'search_skills',
  description: '搜索从历史对话中提炼的知识洞察卡片。用于"之前学过的关于X的内容""上次解决Y问题的方法""有没有关于Z的历史经验"之类的场景。',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '搜索关键词或自然语言描述' },
      topK:  { type: 'number', description: '返回数量，默认 5' },
    },
    required: ['query'],
  },
}, async ({ query, topK = 5 }) => {
  const skills = getSkills()
  if (skills.length === 0) {
    return { content: '暂无知识洞察记录。对话积累后会自动提炼。', brief: '暂无记录' }
  }

  const docs: HybridDoc[] = skills.map(s => ({
    id:   s.id,
    text: `${s.title}。${s.insight} ${s.tags.join(' ')}`,
  }))

  const cache    = getSkillEmbeddings()
  const cacheMap = new Map(cache.map(e => [e.id, e.vec]))

  const { OpenAIEmbeddings } = await import('@langchain/openai')
  const config = (await import('../../../../codelife.config')).default
  const embedder = new OpenAIEmbeddings({
    apiKey:    config.spirit?.apiKey,
    modelName: 'text-embedding-3-small',
    ...(config.spirit?.baseURL ? { configuration: { baseURL: config.spirit.baseURL } } : {}),
  })

  const results = await hybridSearch(docs, query as string, {
    topK:         Math.min(Number(topK), 10),
    embedder,
    getCachedVec: id => cacheMap.get(id),
    onNewVecs:    newVecs => {
      for (const { id, vec } of newVecs) cacheMap.set(id, vec)
      saveSkillEmbeddings(Array.from(cacheMap.entries()).map(([id, vec]) => ({ id, vec })))
    },
  })

  if (results.length === 0) {
    return { content: `未找到与「${query}」相关的知识洞察`, brief: '无匹配' }
  }

  const skillMap = new Map<string, SkillCard>(skills.map(s => [s.id, s]))
  const matched  = results.map(r => {
    const s = skillMap.get(r.id)!
    return `【${s.title}】（${s.sourceDate}）\n${s.insight}\n标签：${s.tags.join('、')}`
  }).join('\n\n---\n\n')

  // 更新被引用卡片的 useCount
  const updatedSkills = skills.map(s =>
    results.some(r => r.id === s.id) ? { ...s, useCount: s.useCount + 1 } : s
  )
  const { saveSkills } = await import('../memory')
  saveSkills(updatedSkills)

  return {
    content: matched,
    brief:   `找到 ${results.length} 条知识洞察`,
  }
}, { displayName: '检索知识洞察', domain: 'knowledge' })

// ── list_skills ───────────────────────────────────────────────

registerTool({
  name:        'list_skills',
  description: '列出已保存的技能卡（按创建时间倒序）。用于"我有哪些技能卡""查看所有洞察记录"之类的场景。',
  parameters: {
    type: 'object',
    properties: {
      tag:   { type: 'string', description: '按标签筛选（可选）' },
      limit: { type: 'number', description: '返回数量上限，默认 20' },
    },
  },
}, async ({ tag, limit = 20 }) => {
  const cards    = getSkills()
  const filtered = tag
    ? cards.filter(c => c.tags.includes(tag as string))
    : cards
  const sorted = [...filtered].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const result = sorted.slice(0, Math.min(Number(limit), 50))

  if (result.length === 0) {
    return {
      content: tag ? `暂无标签「${tag}」的技能卡` : '暂无技能卡，对话积累后可手动或自动提炼。',
      brief:   '暂无记录',
    }
  }

  // content 为 JSON 数组，stream.ts 解析后推送 skill_cards 事件
  return {
    content: JSON.stringify(result),
    brief:   `共 ${filtered.length} 张，返回 ${result.length} 张`,
  }
}, { displayName: '列出技能卡', domain: 'knowledge' })

// ── delete_skill ──────────────────────────────────────────────

registerTool({
  name:        'delete_skill',
  description: '按 ID 删除一张技能卡。删除前应先用 list_skills 确认 ID。',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: '技能卡 ID（格式如 skill_20260414_001）' },
    },
    required: ['id'],
  },
}, async ({ id }) => {
  const cards = getSkills()
  const idx   = cards.findIndex(c => c.id === id)
  if (idx < 0) {
    return { content: `未找到技能卡 ${id}，请用 list_skills 确认 ID。`, brief: '未找到' }
  }
  const [removed] = cards.splice(idx, 1)
  replaceSkills(cards)
  return {
    content: `已删除技能卡「${removed.title}」（ID: ${id}）`,
    brief:   `已删除「${removed.title}」`,
  }
}, { displayName: '删除技能卡', domain: 'knowledge' })
