/**
 * 技能洞察工具：搜索从历史对话中提炼的知识卡片
 */

import { registerTool }      from '../registry'
import { getSkills, getSkillEmbeddings, saveSkillEmbeddings, type SkillCard } from '../memory'
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
}, { displayName: '检索知识洞察' })
