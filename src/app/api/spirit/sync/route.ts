/**
 * POST /api/spirit/sync
 * 触发今日数据同步，写入 DailyLog
 * 可由 cron 或手动调用
 */

import { NextRequest } from 'next/server'
import {
  syncToday,
  generateWeeklyPattern,
  updatePersona,
  shouldGenerateWeeklyPattern,
  shouldUpdatePersona,
  preIndexEmbeddings,
} from '@/lib/spirit/sync'
import { buildChatModel }  from '@/lib/spirit/langgraph/agents'
import { invalidateAgentCache } from '@/lib/spirit/langgraph/agents'
import config from '../../../../../codelife.config'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  // 简单 secret 保护
  const secret = req.headers.get('x-sync-secret')
  if (process.env.SYNC_SECRET && secret !== process.env.SYNC_SECRET) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  if (!config.spirit?.enabled) {
    return Response.json({ error: '器灵未开启' }, { status: 403 })
  }

  try {
    // 1. 当日数据同步
    const log = await syncToday()

    // 2. 周期记忆生成（非阻塞，后台运行）
    const llm = buildChatModel(config.spirit.reflectModel ?? config.spirit.model)
    const tasks: Promise<unknown>[] = []

    if (shouldGenerateWeeklyPattern()) {
      tasks.push(generateWeeklyPattern(llm).catch(e => console.warn('[sync] weekly pattern 生成失败:', e)))
    }
    if (shouldUpdatePersona()) {
      tasks.push(updatePersona(llm).catch(e => console.warn('[sync] persona 更新失败:', e)))
    }

    // 等待周期任务（通常很快，模型返回 JSON 即可）
    if (tasks.length > 0) {
      await Promise.allSettled(tasks)
      // 记忆更新后清空 agent 缓存，下次对话拿到新 prompt
      invalidateAgentCache()
    }

    // 3. 预热 embedding 索引（后台，失败不影响响应）
    const indexResult = await preIndexEmbeddings(llm).catch(e => {
      console.warn('[sync] embedding 预热失败:', e)
      return { blogNew: 0, convNew: 0 }
    })

    return Response.json({
      ok: true, log,
      weeklyUpdated: shouldGenerateWeeklyPattern(),
      personaUpdated: shouldUpdatePersona(),
      indexed: indexResult,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return Response.json({ error: message }, { status: 500 })
  }
}
