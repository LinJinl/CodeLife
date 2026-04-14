/**
 * Next.js instrumentation hook — 服务端启动时执行一次
 *
 * 职责：
 * 1. 技能卡：本周未提炼则后台触发
 * 2. 偏好画像：每次启动都更新（对话积累后持续收敛）
 */

export async function register() {
  // 只在 Node.js runtime 运行（Edge runtime 没有文件系统）
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  try {
    const config = (await import('../codelife.config')).default
    if (!config.spirit?.enabled || !config.spirit.apiKey) return

    const { buildChatModel } = await import('@/lib/spirit/langgraph/agents')
    const model = buildChatModel(config.spirit.reflectModel ?? config.spirit.model)

    // ── 技能卡（本周未提炼才触发）────────────────────────────
    const { shouldExtractSkills, extractSkills } = await import('@/lib/spirit/skill-extractor')
    if (shouldExtractSkills()) {
      extractSkills(14, model)
        .then(r => {
          if (r.newCount > 0) console.log(`[startup] 技能提炼完成，新增 ${r.newCount} 张（共 ${r.cards.length} 张）`)
          else                console.log('[startup] 技能提炼完成，本轮无新洞察')
        })
        .catch(e => console.warn('[startup] 技能提炼失败:', e))
    } else {
      console.log('[startup] 技能卡本周已提炼，跳过')
    }

    // ── 偏好画像（每次启动都尝试更新，对话有新内容才会写入）──
    const { extractPreferences } = await import('@/lib/spirit/preference-extractor')
    extractPreferences(7, model)
      .then(r => {
        if (r.changedCount > 0) console.log(`[startup] 偏好更新完成，${r.changedCount} 条变化（共 ${r.totalCount} 条）`)
        else                    console.log('[startup] 偏好无新观察，跳过写入')
      })
      .catch(e => console.warn('[startup] 偏好提炼失败:', e))

  } catch (e) {
    console.warn('[startup] instrumentation 初始化失败:', e)
  }
}
