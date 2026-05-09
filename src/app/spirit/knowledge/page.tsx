import { KnowledgeGraphWorkbench } from '@/components/spirit/KnowledgeGraphWorkbench'
import { getContextRun, listContextRuns } from '@/lib/spirit/context-audit'
import { buildKnowledgeGraph, filterKnowledgeGraph, type KnowledgeNodeType } from '@/lib/spirit/knowledge-graph'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

type KnowledgeView = 'graph' | 'list' | 'audit'

export default async function SpiritKnowledgePage({
  searchParams,
}: {
  searchParams?: Promise<{ id?: string; graphType?: string; q?: string; view?: string }>
}) {
  const params = await searchParams
  const view = resolveView(params?.view)
  const runs = listContextRuns(80)
  const selectedId = params?.id ?? runs[0]?.id
  const selected = selectedId ? getContextRun(selectedId) : null
  const graph = filterKnowledgeGraph(buildKnowledgeGraph(), {
    type: params?.graphType as KnowledgeNodeType | undefined,
    q: params?.q,
    limit: view === 'graph' ? 180 : 80,
  })

  return (
    <div className="page-content">
      <section style={{
        minHeight: '32vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-end',
        textAlign: 'center',
        padding: '110px 20px 44px',
      }}>
        <div style={{
          fontFamily: 'var(--font-xiaowei), serif',
          fontSize: 'clamp(32px, 5vw, 50px)',
          letterSpacing: 16,
          textIndent: 16,
          color: 'var(--gold)',
          opacity: 0.88,
          marginBottom: 14,
        }}>能力知图</div>
        <div style={{
          fontFamily: 'var(--font-serif)',
          fontSize: 13,
          letterSpacing: 4,
          textIndent: 4,
          color: 'var(--ink-dim)',
        }}>
          按能力方向整理文章、技能和助手经验
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 20, flexWrap: 'wrap', justifyContent: 'center' }}>
          <Link href="/spirit" style={ACTION_LINK}>进入器灵</Link>
          <Link href="/spirit/memory" style={ACTION_LINK}>管理记忆</Link>
        </div>
      </section>

      <nav style={TAB_BAR}>
        <TabLink href="/spirit/knowledge?view=graph" active={view === 'graph'}>知识图谱</TabLink>
        <TabLink href="/spirit/knowledge?view=list" active={view === 'list'}>节点清单</TabLink>
        <TabLink href="/spirit/knowledge?view=audit" active={view === 'audit'}>上下文审计</TabLink>
      </nav>

      {view === 'graph' && (
        <section style={WIDE_SECTION}>
          <div style={SECTION_HEAD}>
            <PanelTitle>能力地图</PanelTitle>
            <p style={P}>
              按 Agent、RAG、LLM 基础、AI 工程化等方向整理个人能力点。点击能力点即可查看关联博文。
            </p>
          </div>
          <KnowledgeGraphWorkbench graph={graph} />
        </section>
      )}

      {view === 'audit' && (
        <div style={AUDIT_LAYOUT}>
          <aside style={PANEL}>
            <PanelTitle>最近对话</PanelTitle>
            {runs.length === 0 ? (
              <p style={P}>暂无审计记录。下一次和青霄对话后会自动生成。</p>
            ) : (
              <div style={{ display: 'grid', gap: 10 }}>
                {runs.map(run => (
                  <Link
                    key={run.id}
                    href={`/spirit/knowledge?view=audit&id=${run.id}`}
                    style={{
                      display: 'block',
                      textDecoration: 'none',
                      border: `1px solid ${run.id === selectedId ? 'var(--gold-line)' : 'var(--ink-trace)'}`,
                      background: run.id === selectedId ? 'var(--surface)' : 'var(--void)',
                      padding: '11px 12px',
                    }}
                  >
                    <div style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 9,
                      color: 'var(--ink-trace)',
                      marginBottom: 6,
                    }}>
                      {formatTime(run.createdAt)}
                    </div>
                    <div style={{
                      fontFamily: 'var(--font-serif)',
                      fontSize: 12,
                      color: 'var(--ink)',
                      lineHeight: 1.65,
                    }}>
                      {clip(run.userMessage, 86)}
                    </div>
                    <div style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 9,
                      color: 'var(--jade)',
                      marginTop: 7,
                    }}>
                      带入记忆 {run.prefetchedCount} · 调用工具 {run.toolCount}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </aside>

          <main style={PANEL}>
            {!selected ? (
              <p style={P}>选择一条审计记录查看详情。</p>
            ) : (
              <RunDetail run={selected} />
            )}
          </main>
        </div>
      )}

      {view === 'list' && (
        <section style={SECTION}>
          <div style={PANEL}>
            <PanelTitle>能力地图节点</PanelTitle>
            <div style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 8,
              marginBottom: 18,
            }}>
              <GraphFilter label="全部" />
              <GraphFilter label="能力方向" type="capability_domain" />
              <GraphFilter label="能力点" type="capability" />
              <GraphFilter label="博客" type="blog" />
            </div>
            <div style={{
              fontFamily: 'var(--font-serif)',
              fontSize: 12,
              color: 'var(--ink-trace)',
              marginBottom: 18,
            }}>
              当前节点 {graph.nodes.length} 个，关系 {graph.edges.length} 条。这里用于快速扫源数据，图谱视图用于看能力方向和支撑博文。
            </div>
            <div style={NODE_GRID}>
              {graph.nodes.map(node => (
                <article key={node.id} style={NODE_CARD}>
                  <div style={ITEM_HEAD}>{nodeTypeLabel(node.type)} {node.date ? `· ${node.date}` : ''}</div>
                  <h3 style={NODE_TITLE}>{node.title}</h3>
                  <p style={P}>{node.summary}</p>
                  {node.tags.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                      {node.tags.slice(0, 5).map(tag => <span key={tag} style={TAG}>{tag}</span>)}
                    </div>
                  )}
                  <div style={SOURCE}>来源：{node.source}</div>
                </article>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  )
}

function GraphFilter({ label, type }: { label: string; type?: KnowledgeNodeType }) {
  const href = type ? `/spirit/knowledge?view=list&graphType=${type}` : '/spirit/knowledge?view=list'
  return <Link href={href} style={ACTION_LINK}>{label}</Link>
}

function TabLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      style={{
        ...TAB_LINK,
        borderColor: active ? 'var(--gold-line)' : 'var(--ink-trace)',
        background: active ? 'var(--surface)' : 'transparent',
        color: active ? 'var(--gold)' : 'var(--gold-dim)',
      }}
    >
      {children}
    </Link>
  )
}

function resolveView(view?: string): KnowledgeView {
  if (view === 'list' || view === 'audit') return view
  return 'graph'
}

function RunDetail({ run }: { run: NonNullable<ReturnType<typeof getContextRun>> }) {
  const summary = buildPlainSummary(run)

  return (
    <div>
      <PanelTitle>这次回答前的上下文</PanelTitle>
      <div style={SUMMARY_GRID}>
        <Metric label="长期记忆" value={`${run.memoryGate.items.length} 条`} />
        <Metric label="工具调用" value={`${run.tools.length} 次`} />
        <Metric label="今日历史" value={`${run.todayHistory.selected}/${run.todayHistory.totalSaved}`} />
        <Metric label="执行方式" value={summary.mode} />
      </div>

      <Block title="用户问题">
        <p style={P}>{run.userMessage}</p>
      </Block>

      <Block title="上下文清单">
        <div style={STACK}>
          {summary.stack.map(item => (
            <div key={item.label} style={STACK_ROW}>
              <div style={STACK_LABEL}>{item.label}</div>
              <div style={STACK_TEXT}>{item.value}</div>
            </div>
          ))}
        </div>
      </Block>

      <Block title="实际 Prompt 快照">
        {!run.promptSnapshot ? (
          <p style={P}>这条记录生成于 Prompt 快照功能之前，暂无完整消息栈。</p>
        ) : (
          <div>
            <p style={{ ...P, marginBottom: 12 }}>{run.promptSnapshot.note}</p>
            <div style={{ display: 'grid', gap: 12 }}>
              {run.promptSnapshot.messages.map(message => (
                <details key={message.id} open={message.source !== 'system_prompt'} style={PROMPT_BLOCK}>
                  <summary style={PROMPT_SUMMARY}>
                    <span>{sourceLabel(message.source)} · {roleLabel(message.role)}</span>
                    <span style={{ color: 'var(--ink-trace)' }}>{message.chars} chars</span>
                  </summary>
                  <pre style={PROMPT_PRE}>{message.content}</pre>
                </details>
              ))}
            </div>
          </div>
        )}
      </Block>

      <Block title="带入的长期记忆">
        {run.memoryGate.items.length === 0 ? (
          <p style={P}>本轮没有额外带入长期记忆。</p>
        ) : (
          <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
            {run.memoryGate.items.map(item => (
              <div key={`${item.type}:${item.id}`} style={ITEM}>
                <div style={ITEM_HEAD}>
                  {memoryTypeLabel(item.type)} {item.title ? `· ${item.title}` : ''}
                  {item.date ? ` · ${item.date}` : ''}
                </div>
                <div style={P}>{item.summaryPreview}</div>
                {item.source && <div style={SOURCE}>来源：{item.source}</div>}
              </div>
            ))}
          </div>
        )}
      </Block>

      <Block title="调用过的工具">
        {run.tools.length === 0 ? (
          <p style={P}>本轮没有工具调用，主要依赖对话上下文和已带入记忆直接回答。</p>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {run.tools.map((tool, idx) => (
              <div key={`${tool.name}:${idx}`} style={ITEM}>
                <div style={ITEM_HEAD}>{tool.display ?? tool.name}</div>
                {tool.desc && <div style={P}>参数：{tool.desc}</div>}
                {tool.brief && <div style={P}>结果：{tool.brief}</div>}
                {tool.links?.length ? (
                  <div style={SOURCE}>链接：{tool.links.map(link => link.title).join(' / ')}</div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </Block>

      <Block title="最终回答预览">
        <p style={P}>{run.finalAnswerPreview || '本轮没有文本输出。'}</p>
      </Block>

      {run.errors.length > 0 && (
        <Block title="错误">
          {run.errors.map(error => <p key={error} style={{ ...P, color: 'var(--seal)' }}>{error}</p>)}
        </Block>
      )}
    </div>
  )
}

function buildPlainSummary(run: NonNullable<ReturnType<typeof getContextRun>>) {
  const history = run.todayHistory.selected > 0
    ? `带入今日已保存对话 ${run.todayHistory.selected}/${run.todayHistory.totalSaved} 条${run.todayHistory.summarized ? `，其中 ${run.todayHistory.summarized} 条使用摘要` : ''}${run.todayHistory.truncated ? '，内容被截断' : ''}${run.todayHistory.deduped ? '，已避开当前请求里的重复片段' : ''}`
    : '没有带入今日已保存对话'
  const memoryTypes = unique(run.memoryGate.items.map(item => memoryTypeLabel(item.type)))
  const mode = run.planner.strategy === 'parallel'
    ? '并行'
    : run.planner.strategy === 'sequential'
      ? '顺序'
      : '直接'

  return {
    mode,
    stack: [
      { label: '当前问题', value: run.userMessage || '未知' },
      { label: '页面上下文', value: run.route ? `来自 ${run.route}` : '没有页面上下文' },
      { label: '今日历史', value: history },
      { label: '当前会话', value: run.currentConversation ? `保留 ${run.currentConversation.selected}/${run.currentConversation.total} 条，摘要 ${run.currentConversation.summarized} 条，约 ${run.currentConversation.chars} 字` : '未记录当前会话压缩信息' },
      { label: '长期记忆', value: run.memoryGate.items.length > 0 ? `带入 ${run.memoryGate.items.length} 条，类型：${memoryTypes.join('、')}` : '没有额外带入' },
      { label: '工具范围', value: run.domains.length > 0 ? run.domains.map(domainLabel).join('、') : '默认范围' },
      { label: '执行方式', value: `${mode}回答${run.planner.taskCount ? `，任务数 ${run.planner.taskCount}` : ''}` },
      { label: '模型', value: run.model ?? '未知' },
    ],
  }
}

function unique(items: string[]) {
  return Array.from(new Set(items))
}

function memoryTypeLabel(type: string) {
  const map: Record<string, string> = {
    preference: '偏好',
    skill: '技能卡',
    note: '笔记',
    daily_log: '日志',
    session_summary: '对话摘要',
    weekly_pattern: '周规律',
    vow: '誓愿',
    conversation: '历史对话',
  }
  return map[type] ?? type
}

function domainLabel(domain: string) {
  const map: Record<string, string> = {
    system: '系统',
    knowledge: '知识记忆',
    memory: '记忆读取',
    cultivation: '修炼数据',
    vow: '誓愿',
    meta: '元信息',
    search: '搜索',
    code: '代码',
    debug: '调试',
  }
  return map[domain] ?? domain
}

function nodeTypeLabel(type: string) {
  const map: Record<string, string> = {
    capability_domain: '能力方向',
    capability: '能力点',
    blog: '博客',
  }
  return map[type] ?? type
}

function sourceLabel(source: string) {
  const map: Record<string, string> = {
    system_prompt: '系统提示',
    memory_gate: '记忆门控',
    prefetched_memory: '预取记忆',
    today_history: '今日历史',
    page_context: '页面上下文',
    conversation: '对话消息',
    runtime: '运行时消息',
  }
  return map[source] ?? source
}

function roleLabel(role: string) {
  const map: Record<string, string> = {
    system: 'system',
    user: 'user',
    assistant: 'assistant',
    tool: 'tool',
    unknown: 'unknown',
  }
  return map[role] ?? role
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: 26 }}>
      <div style={BLOCK_TITLE}>{title}</div>
      {children}
    </section>
  )
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={ITEM}>
      <div style={META_LABEL}>{label}</div>
      <div style={{ ...META_VALUE, color: 'var(--gold-dim)', fontSize: 16 }}>{value}</div>
    </div>
  )
}

function PanelTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontFamily: 'var(--font-mono)',
      fontSize: 10,
      color: 'var(--gold-dim)',
      letterSpacing: 2,
      marginBottom: 16,
    }}>
      {children}
    </div>
  )
}

function clip(text: string, max: number) {
  const normalized = text.replace(/\s+/g, ' ').trim()
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1)}…`
}

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

const PANEL: React.CSSProperties = {
  border: '1px solid var(--ink-trace)',
  background: 'var(--deep)',
  padding: '18px',
}

const P: React.CSSProperties = {
  fontFamily: 'var(--font-serif)',
  fontSize: 13,
  color: 'var(--ink-dim)',
  lineHeight: 1.85,
  margin: 0,
}

const ACTION_LINK: React.CSSProperties = {
  border: '1px solid var(--ink-trace)',
  color: 'var(--gold-dim)',
  textDecoration: 'none',
  fontFamily: 'var(--font-serif)',
  fontSize: 12,
  letterSpacing: 2,
  padding: '6px 14px',
}

const TAB_BAR: React.CSSProperties = {
  maxWidth: 1120,
  margin: '0 auto 22px',
  padding: '0 28px',
  display: 'flex',
  gap: 10,
  flexWrap: 'wrap',
  justifyContent: 'center',
}

const TAB_LINK: React.CSSProperties = {
  border: '1px solid var(--ink-trace)',
  color: 'var(--gold-dim)',
  textDecoration: 'none',
  fontFamily: 'var(--font-serif)',
  fontSize: 13,
  letterSpacing: 2,
  padding: '8px 18px',
}

const WIDE_SECTION: React.CSSProperties = {
  maxWidth: 1280,
  margin: '0 auto',
  padding: '0 28px 120px',
}

const SECTION: React.CSSProperties = {
  maxWidth: 1120,
  margin: '0 auto',
  padding: '0 28px 120px',
}

const SECTION_HEAD: React.CSSProperties = {
  border: '1px solid var(--ink-trace)',
  borderBottom: 0,
  background: 'var(--deep)',
  padding: '18px',
}

const AUDIT_LAYOUT: React.CSSProperties = {
  maxWidth: 1120,
  margin: '0 auto',
  padding: '0 28px 100px',
  display: 'grid',
  gridTemplateColumns: 'minmax(260px, 340px) minmax(0, 1fr)',
  gap: 24,
  alignItems: 'start',
}

const BLOCK_TITLE: React.CSSProperties = {
  fontFamily: 'var(--font-serif), serif',
  fontSize: 14,
  color: 'var(--ink)',
  letterSpacing: 2,
  marginBottom: 12,
}

const META_LABEL: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  color: 'var(--ink-trace)',
}

const META_VALUE: React.CSSProperties = {
  fontFamily: 'var(--font-serif)',
  fontSize: 12,
  color: 'var(--ink-dim)',
  lineHeight: 1.6,
}

const SUMMARY_GRID: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))',
  gap: 10,
}

const STACK: React.CSSProperties = {
  display: 'grid',
  borderTop: '1px solid var(--ink-trace)',
}

const STACK_ROW: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '92px 1fr',
  gap: 14,
  padding: '10px 0',
  borderBottom: '1px solid var(--ink-trace)',
}

const STACK_LABEL: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  color: 'var(--ink-trace)',
}

const STACK_TEXT: React.CSSProperties = {
  fontFamily: 'var(--font-serif)',
  fontSize: 13,
  color: 'var(--ink-dim)',
  lineHeight: 1.75,
}

const PROMPT_BLOCK: React.CSSProperties = {
  border: '1px solid var(--ink-trace)',
  background: 'var(--void)',
  padding: '10px 12px',
}

const PROMPT_SUMMARY: React.CSSProperties = {
  cursor: 'pointer',
  display: 'flex',
  justifyContent: 'space-between',
  gap: 12,
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  color: 'var(--jade)',
}

const PROMPT_PRE: React.CSSProperties = {
  margin: '10px 0 0',
  padding: '10px 12px',
  maxHeight: 360,
  overflow: 'auto',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  background: 'var(--deep)',
  color: 'var(--ink-dim)',
  border: '1px solid var(--ink-trace)',
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  lineHeight: 1.7,
}

const NODE_GRID: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
  gap: 12,
}

const NODE_CARD: React.CSSProperties = {
  border: '1px solid var(--ink-trace)',
  background: 'var(--void)',
  padding: '12px 14px',
  minHeight: 170,
}

const NODE_TITLE: React.CSSProperties = {
  fontFamily: 'var(--font-xiaowei), serif',
  fontSize: 15,
  color: 'var(--ink)',
  letterSpacing: 2,
  margin: '0 0 9px',
  lineHeight: 1.45,
}

const TAG: React.CSSProperties = {
  border: '1px solid var(--ink-trace)',
  color: 'var(--ink-dim)',
  fontFamily: 'var(--font-mono)',
  fontSize: 9,
  padding: '2px 6px',
}

const ITEM: React.CSSProperties = {
  border: '1px solid var(--ink-trace)',
  background: 'var(--void)',
  padding: '10px 12px',
}

const ITEM_HEAD: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  color: 'var(--jade)',
  marginBottom: 7,
}

const SOURCE: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 9,
  color: 'var(--ink-trace)',
  marginTop: 7,
}
