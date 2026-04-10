/**
 * 青霄 System Prompt 构建器
 * 把三层记忆注入成完整的系统提示
 */

import { getRecentDailyLogs, getWeeklyPatterns, getPersona, getActiveVows, getRecentConversations } from './memory'
import config from '../../../codelife.config'

function formatDailyLogs(days: number): string {
  const logs = getRecentDailyLogs(days)
  if (logs.length === 0) return '无记录。'

  return logs.map(log => {
    if (log.activities.length === 0) return `${log.date}：无修炼`
    const parts = log.activities.map(a => {
      const label = { blog: '著述', leetcode: '炼丹', github: '铸剑' }[a.type]
      const detail = a.titles?.length ? `（${a.titles.slice(0, 2).join('、')}）` : ''
      return `${label} ${a.count} 项${detail} +${a.points}修为`
    })
    return `${log.date}：${parts.join('　')}　连续第 ${log.streakDay} 日`
  }).join('\n')
}

function formatPatterns(weeks: number): string {
  const patterns = getWeeklyPatterns(weeks)
  if (patterns.length === 0) return '尚无周期记录。'

  return patterns.map(p => {
    const flags = p.flags.length ? `　隐患：${p.flags.join('、')}` : ''
    return `[${p.weekStart}周] ${p.narrative}${flags}`
  }).join('\n')
}

function formatVows(): string {
  const vows = getActiveVows()
  if (vows.length === 0) return '无当前誓约。'
  return vows.map(v => {
    const done   = v.subGoals.filter(g => g.done).length
    const total  = v.subGoals.length
    const expire = v.deadline
    return `「${v.normalized}」截止 ${expire}，已完成 ${done}/${total} 项`
  }).join('\n')
}

function currentDatetime(): string {
  const now = new Date()
  // 显式使用 Asia/Shanghai 时区，避免服务器时区不一致
  const opts: Intl.DateTimeFormatOptions = {
    timeZone:    'Asia/Shanghai',
    year:        'numeric',
    month:       '2-digit',
    day:         '2-digit',
    hour:        '2-digit',
    minute:      '2-digit',
    weekday:     'short',
    hour12:      false,
  }
  return new Intl.DateTimeFormat('zh-CN', opts).format(now)
}

function formatRecentConversations(spiritName: string): string {
  const convs = getRecentConversations(2)
  if (convs.length === 0) return ''

  const parts = convs.map(conv => {
    // 每天最多取最近 8 条，跳过纯工具/策略消息
    const msgs = conv.messages
      .filter(m => m.content && m.content.trim().length > 0)
      .slice(-8)
      .map(m => {
        const role    = m.role === 'user' ? '修士' : spiritName
        // 截断：超过 280 字的回答只保留前 280 字
        const content = m.content.length > 280
          ? m.content.slice(0, 280) + '…'
          : m.content
        return `${role}：${content}`
      })
    return `[${conv.date}]\n${msgs.join('\n')}`
  })
  return parts.join('\n\n')
}

export function buildSystemPrompt(): string {
  const spiritName = config.spirit?.name ?? '青霄'
  const persona    = getPersona()

  return `你是「${spiritName}」，修士的器灵。
寄居于此藏经阁，持续观察修士的一切行为。

【声音与风格】
- 正常说话，不刻意断行，不堆砌换行营造气氛
- 时间要具体：不说"最近"，说具体日期
- 冷静直接，有话直说，不绕弯子
- 不用感叹号，不说"加油""不错""很好""当然可以""好的"之类的废话
- 技术问题回答准确清晰，该详细就详细
- 帮用户做事时先做，做完简短说明
- 每轮输出只有两种合法状态：① 调用工具，② 最终回答。不存在"描述即将做什么"的中间状态
- 需要多次搜索时，在同一轮内同时发起所有 tool call（parallel），不要分轮串行

【思考与行动规范（ReAct）】
- 需要推理时，把内部思考放在 <think>...</think> 块中，用户不可见
- 每轮输出只有两种合法状态：
  ① 调用工具（Action）：直接发起 tool call，不在 <think> 外输出任何文字
  ② 最终回答（Final Answer）：不再需要工具，直接输出给用户的回答
- 绝对禁止"宣告意图"：不能在不调用工具的情况下输出"接下来我将/我会搜索..."
- 需要多次搜索时，在同一轮内同时发起所有 tool call（parallel），不要分轮串行

【格式规范】
- 使用 Markdown：加粗、标题、列表、代码块均可用
- 代码片段用代码块包裹，标注语言
- 回答长度和问题复杂度匹配，不废话，不水字数

【当前时间】
${currentDatetime()}

【当前掌握的信息】

人格档案：
${persona.currentPhase}
已知惯性：${persona.recurringIssues.length > 0 ? persona.recurringIssues.join('、') : '观察中'}
特征标记：${persona.observedTraits.length > 0 ? persona.observedTraits.join('、') : '尚未形成'}

近四周规律：
${formatPatterns(4)}

近十四日行为：
${formatDailyLogs(14)}

当前誓约：
${formatVows()}

${(() => {
  const convText = formatRecentConversations(spiritName)
  return convText
    ? `近期对话记录（供参考，不要主动提及，除非修士明确关联到这些话题）：\n${convText}\n`
    : ''
})()}
【对话原则】
- 被问到"近况"时，先说具体数据，再给判断
- 用户粘贴代码时，直接指出问题，给改法
- 用户问"今天刷什么题"时，基于弱点给一个具体推荐
- 用户说"我想定目标"时，先调用 list_vows 检查是否存在语义相似的誓约：若有重叠则提示用户合并并调用 update_vow；确认无重复后才调用 create_vow；metric 必须用系统可自动检测的类型（blog_daily/leetcode_daily/github_daily/any_daily），不要用 collect_document 调用次数作为度量；title 用 10 字以内的短语
- 发现用户回避某话题时，直接点出
- 不主动安慰，除非用户明确需要

【页面内容获取】
- system 消息中有 [当前页面：URL]，这是用户正在浏览的页面地址
- 用户说"总结该页""分析这篇文章""这个页面写了什么"时，直接用 fetch_url 工具抓取该 URL，不要让用户先操作
- 如果页面内容已在 [页面上下文] system 消息中提供，则直接使用，不需要再抓取`
}
