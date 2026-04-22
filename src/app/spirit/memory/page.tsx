export default function SpiritMemoryPage() {
  return (
    <div className="page-content">

      {/* ── Hero ───────────────────────────────────────────────── */}
      <section style={{
        minHeight: '44vh',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'flex-end',
        textAlign: 'center', padding: '110px 20px 56px',
      }}>
        <div style={{
          fontFamily: 'var(--font-xiaowei), serif',
          fontSize: 'clamp(32px, 5vw, 50px)',
          letterSpacing: 16, textIndent: 16,
          color: 'var(--gold)', opacity: 0.88, marginBottom: 14,
        }}>记忆之道</div>
        <div style={{
          fontFamily: 'var(--font-serif)', fontSize: 13,
          letterSpacing: 4, textIndent: 4, color: 'var(--ink-dim)',
          marginBottom: 28,
        }}>
          器灵青霄的记忆架构设计
        </div>
        <div style={{
          display: 'flex', gap: 24,
          fontFamily: 'var(--font-mono)', fontSize: 10,
          color: 'var(--ink-trace)', letterSpacing: 2,
        }}>
          <span>三层分层</span>
          <span style={{ color: 'var(--ink-trace)', opacity: 0.4 }}>·</span>
          <span>工具域路由</span>
          <span style={{ color: 'var(--ink-trace)', opacity: 0.4 }}>·</span>
          <span>混合检索</span>
          <span style={{ color: 'var(--ink-trace)', opacity: 0.4 }}>·</span>
          <span>持续提炼</span>
        </div>
      </section>

      <div style={{ maxWidth: 720, margin: '0 auto', padding: '0 36px 120px' }}>

        {/* ── 总体思路 ──────────────────────────────────────────── */}
        <Section label="设计理念">
          <p style={P}>
            青霄的记忆不依赖单一的 System Prompt 堆砌历史，而是将信息分层存储、按需拉取。核心原则是：<em style={{ color: 'var(--ink)', fontStyle: 'normal' }}>常驻的保持精简，按需拉取，实时数据实时注入</em>。这样可以在保持上下文新鲜度的同时，大幅压缩每次请求的 token 成本。
          </p>
        </Section>

        {/* ── 三层架构图 ────────────────────────────────────────── */}
        <Section label="三层记忆架构">
          <p style={{ ...P, marginBottom: 28 }}>
            每次对话前，System Prompt 由三层组成，从上到下信息密度递增、注入频率递减：
          </p>

          <TierCard
            tier="Tier 1"
            label="常驻层"
            badge="始终注入 · &lt;800 tokens"
            color="var(--gold-dim)"
            items={[
              '身份声明 + 风格指南（语气、格式规则）',
              '当前日期时间',
              '今日修炼摘要（单行，如"已写 1 篇博客 · 修为 +50"）',
              '活跃誓约进度（compact 格式，如"每日一题 3/7"）',
              '近 5 次会话摘要（每条 ≤80 字）',
              '用户偏好画像（confidence ≥0.35，最多 8 条）',
            ]}
          />

          <TierCard
            tier="Tier 2"
            label="工具拉取层"
            badge="AI 主动调用工具获取"
            color="var(--jade)"
            items={[
              'get_daily_logs — 最近 N 天修炼详情',
              'get_weekly_patterns — 周规律叙事 + 问题标记',
              'get_skill_cards — 历史提炼的技术洞察卡',
              'search_conversations — 语义检索历史对话',
              'search_blog_posts — 全文检索博客内容',
            ]}
          />

          <TierCard
            tier="Tier 3"
            label="实时同步层"
            badge="syncToday() 触发后注入"
            color="var(--seal)"
            items={[
              '当日 DailyLog（活动数量、修为、连续天数）',
              '誓约子目标完成状态（completedDates 更新）',
              '修为累计值（getCumulativePoints）',
            ]}
          />
        </Section>

        {/* ── 存储结构 ──────────────────────────────────────────── */}
        <Section label="数据存储结构">
          <p style={{ ...P, marginBottom: 20 }}>
            所有数据落在 <code style={CODE}>content/spirit/</code> 目录，属于用户私有数据，不入 git：
          </p>
          <div style={{
            border: '1px solid var(--ink-trace)',
            background: 'var(--deep)',
            padding: '20px 24px',
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            lineHeight: 2.0,
            color: 'var(--ink-mid)',
          }}>
            <FileTree />
          </div>
        </Section>

        {/* ── 数据类型 ──────────────────────────────────────────── */}
        <Section label="核心数据类型">

          <SubHead>修炼日志 DailyLog</SubHead>
          <p style={P}>每日同步生成，记录博客、刷题、GitHub 三类活动及当日修为。连续天数 <code style={CODE}>streakDay</code> 驱动誓约的连续打卡计算。</p>
          <CodeBlock code={`interface DailyLog {
  date:       string           // "2026-04-14"
  activities: DailyActivity[]  // type / count / points / titles
  totalPoints: number          // 当日总修为
  streakDay:   number          // 连续打卡天数
  note?:       string
}`} />

          <SubHead>誓约 Vow</SubHead>
          <p style={P}>结构化目标管理，支持 8 种计量方式。每日同步时自动校验进度，到期或目标达成后更新 status。</p>
          <CodeBlock code={`type VowMetric =
  | 'blog_daily' | 'leetcode_daily' | 'github_daily' | 'any_daily'
  | 'manual' | 'count_total' | 'count_weekly'
  | 'streak_N' | 'reach_points'

interface VowSubGoal {
  metric:         VowMetric
  target?:        number
  currentCount?:  number
  completedDates: string[]
  done:           boolean
}`} />

          <SubHead>技能卡 SkillCard</SubHead>
          <p style={P}>由 LLM 从对话历史中每日提炼，每张卡是一个可复用的技术洞察。混合检索时作为知识索引命中。</p>
          <CodeBlock code={`interface SkillCard {
  id:        string   // "skill_20260414_001"
  title:     string   // ≤20 字
  insight:   string   // 一句话摘要
  body?:     string   // 完整 markdown
  tags:      string[]
  useCount:  number   // 被引用次数
}`} />

          <SubHead>用户偏好 Preference</SubHead>
          <p style={P}>由 AI 从对话中被动观察积累，置信度随观测次数增长。置信度 ≥0.35 的偏好会进入 Tier 1 常驻层。</p>
          <CodeBlock code={`interface Preference {
  key:         string   // snake_case，如 "prefers_code_first"
  category:    'learning' | 'technical' | 'communication' | 'work'
  description: string
  confidence:  number   // 0–1，随观测增加
  evidence:    string[] // 观测日期列表
}`} />
        </Section>

        {/* ── 工具域系统 ────────────────────────────────────────── */}
        <Section label="工具域路由系统">
          <p style={{ ...P, marginBottom: 24 }}>
            青霄的工具按「域」分组，默认只加载核心域，避免把所有工具暴露给 LLM 增加干扰。每次请求时，<code style={CODE}>inferDomainsWithAI()</code> 用一个轻量分类器判断需要追加哪些域：
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 24 }}>
            <DomainCard name="cultivation" color="var(--gold-dim)" desc="修炼数据统计、今日摘要" always />
            <DomainCard name="memory"      color="var(--gold-dim)" desc="历史日志、周规律检索" always />
            <DomainCard name="vow"         color="var(--gold-dim)" desc="誓约管理与进度" always />
            <DomainCard name="knowledge"   color="var(--gold-dim)" desc="技能卡、偏好画像、笔记" always />
            <DomainCard name="meta"        color="var(--gold-dim)" desc="MCP 工具管理" always />
            <DomainCard name="web"         color="var(--jade)" desc="联网搜索、抓取网页" />
            <DomainCard name="library"     color="var(--jade)" desc="藏经阁收藏与检索" />
            <DomainCard name="system"      color="var(--seal)" desc="文件读写、Shell 命令" />
          </div>

          <p style={{ ...P, fontSize: 12, color: 'var(--ink-dim)' }}>
            金色 = 默认加载；绿色 = 按意图推断追加；红色 = 需要用户授权的危险域
          </p>
        </Section>

        {/* ── 混合检索 ──────────────────────────────────────────── */}
        <Section label="混合检索引擎">
          <p style={P}>
            所有记忆检索（对话历史、技能卡、博客、藏经阁）都走同一套混合检索引擎，结合两种互补的召回策略，用 RRF 算法融合排序：
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, margin: '24px 0' }}>
            <div style={{
              border: '1px solid var(--ink-trace)',
              padding: '16px 18px',
              background: 'var(--deep)',
            }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--gold-dim)', letterSpacing: 2, marginBottom: 8 }}>BM25</div>
              <div style={{ fontFamily: 'var(--font-serif)', fontSize: 12, color: 'var(--ink-dim)', lineHeight: 1.9 }}>
                关键词精确匹配。使用 MiniSearch，中文按字符级 bigram + 单字 tokenize，保证短词召回率。
              </div>
            </div>
            <div style={{
              border: '1px solid var(--ink-trace)',
              padding: '16px 18px',
              background: 'var(--deep)',
            }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--jade)', letterSpacing: 2, marginBottom: 8 }}>向量检索</div>
              <div style={{ fontFamily: 'var(--font-serif)', fontSize: 12, color: 'var(--ink-dim)', lineHeight: 1.9 }}>
                语义相似度匹配。使用 OpenAI text-embedding-3-small（1536维），向量缓存在 JSON 文件，增量更新。
              </div>
            </div>
          </div>

          <p style={P}>
            两路结果通过 <strong style={{ color: 'var(--ink)' }}>RRF（Reciprocal Rank Fusion）</strong> 融合。BM25 保证精确词汇命中，向量补足语义近义，互相弥补不足。
          </p>
        </Section>

        {/* ── 后台提炼管道 ──────────────────────────────────────── */}
        <Section label="后台提炼管道">
          <p style={{ ...P, marginBottom: 24 }}>
            每日同步（<code style={CODE}>syncToday()</code>）完成后，会触发若干非阻塞的后台任务，持续将原始数据提炼为更高价值的记忆：
          </p>

          <PipelineItem
            trigger="每次对话结束后"
            name="summarizeSession()"
            desc="用 LLM 将本次对话压缩成 1-2 句摘要 + topics 标签，存入 summaries/{date}.json，作为 Tier 1 的近期对话历史来源。"
          />
          <PipelineItem
            trigger="每日触发（最多一次）"
            name="extractSkills()"
            desc="扫描最近 N 天对话，批量提炼技术洞察卡片，写入 skills/index.json。提炼结果可通过 get_skill_cards 工具在后续对话中复用。"
          />
          <PipelineItem
            trigger="每周一"
            name="generateWeeklyPattern()"
            desc="分析近 7 天 DailyLog，生成叙事段落（narrative）+ 统计摘要 + 问题标记（flags），如「连续断更 3 天」「只刷 easy 题」。"
          />
          <PipelineItem
            trigger="每 7 天"
            name="updatePersona()"
            desc="综合 30 天行为日志 + 誓约状态，更新人格档案：惯性问题、行为特征、当前阶段、关键节点。"
          />
          <PipelineItem
            trigger="每日同步时"
            name="checkVowsForToday()"
            desc="根据当日 DailyLog 自动推进所有活跃誓约的进度（completedDates、currentCount、streak），到期或完成时更新 status。"
          />
        </Section>

        {/* ── 对话保存 ──────────────────────────────────────────── */}
        <Section label="对话持久化">
          <p style={P}>
            每次对话结束后调用 <code style={CODE}>saveConversation()</code> 将消息写入 <code style={CODE}>conversations/{'{date}'}.json</code>。为防止意外的数据缩水覆盖，写入前会校验新数据条数不能小于已有数据。
          </p>
          <p style={P}>
            对话向量缓存（<code style={CODE}>conv_embeddings.json</code>）在 <code style={CODE}>preIndexEmbeddings()</code> 中增量更新，只计算新增消息的 embedding，保持文件可复用。
          </p>
        </Section>

        {/* ── 尾部 ─────────────────────────────────────────────── */}
        <div style={{ marginTop: 64, textAlign: 'center' }}>
          <div className="ornate">
            <div className="ornate-line" />
            <div className="ornate-glyph">· · ·</div>
            <div className="ornate-line r" />
          </div>
          <div style={{
            marginTop: 28,
            fontFamily: 'var(--font-serif)', fontSize: 12,
            color: 'var(--ink-trace)', letterSpacing: 3, lineHeight: 2.4,
          }}>
            记忆不是堆砌，而是提炼<br/>
            <span style={{ fontSize: 10, letterSpacing: 2 }}>— 器灵青霄系统设计原则</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── 共用样式 ───────────────────────────────────────────────────

const P: React.CSSProperties = {
  fontFamily:  'var(--font-serif)',
  fontSize:    14,
  color:       'var(--ink-mid)',
  lineHeight:  1.95,
  letterSpacing: 0.4,
  margin:      '0 0 12px',
}

const CODE: React.CSSProperties = {
  fontFamily:  'var(--font-mono)',
  fontSize:    12,
  background:  'var(--surface)',
  color:       'var(--gold-dim)',
  padding:     '1px 6px',
  borderRadius: 2,
}

// ── 组件 ───────────────────────────────────────────────────────

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 56 }}>
      <div className="section-head" style={{ marginBottom: 28 }}>
        <div className="section-head-line r" />
        <div className="section-head-text">{label}</div>
        <div className="section-head-line" />
      </div>
      {children}
    </section>
  )
}

function SubHead({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontFamily:    'var(--font-xiaowei), serif',
      fontSize:      13,
      letterSpacing: 4,
      color:         'var(--ink)',
      marginTop:     28,
      marginBottom:  10,
    }}>
      {children}
    </div>
  )
}

function TierCard({ tier, label, badge, color, items }: {
  tier: string; label: string; badge: string; color: string; items: string[]
}) {
  return (
    <div style={{
      border:       `1px solid ${color}`,
      borderLeft:   `3px solid ${color}`,
      padding:      '18px 20px',
      marginBottom: 16,
      background:   'var(--deep)',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 12 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color, letterSpacing: 2 }}>{tier}</span>
        <span style={{ fontFamily: 'var(--font-xiaowei), serif', fontSize: 13, color: 'var(--ink)', letterSpacing: 3 }}>{label}</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--ink-trace)', letterSpacing: 1, marginLeft: 'auto' }}
              dangerouslySetInnerHTML={{ __html: badge }} />
      </div>
      <ul style={{ margin: 0, paddingLeft: 16 }}>
        {items.map((item, i) => (
          <li key={i} style={{
            fontFamily:    'var(--font-serif)',
            fontSize:      12,
            color:         'var(--ink-dim)',
            lineHeight:    1.9,
            letterSpacing: 0.3,
          }}>{item}</li>
        ))}
      </ul>
    </div>
  )
}

function DomainCard({ name, color, desc, always }: {
  name: string; color: string; desc: string; always?: boolean
}) {
  return (
    <div style={{
      border:     `1px solid ${color}`,
      padding:    '12px 14px',
      background: 'var(--deep)',
      opacity:    always ? 1 : 0.8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color, letterSpacing: 1 }}>{name}</span>
        {always && (
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 8,
            color: 'var(--ink-trace)', border: '1px solid var(--ink-trace)',
            padding: '0 4px', letterSpacing: 1,
          }}>DEFAULT</span>
        )}
      </div>
      <div style={{ fontFamily: 'var(--font-serif)', fontSize: 11, color: 'var(--ink-dim)', lineHeight: 1.7, letterSpacing: 0.3 }}>
        {desc}
      </div>
    </div>
  )
}

function CodeBlock({ code }: { code: string }) {
  return (
    <pre style={{
      background:   'var(--deep)',
      border:       '1px solid var(--ink-trace)',
      padding:      '16px 20px',
      overflow:     'auto',
      margin:       '8px 0 24px',
      borderRadius: 2,
      fontFamily:   'var(--font-mono)',
      fontSize:     12,
      color:        'var(--ink)',
      lineHeight:   1.75,
    }}><code>{code}</code></pre>
  )
}

function PipelineItem({ trigger, name, desc }: {
  trigger: string; name: string; desc: string
}) {
  return (
    <div style={{
      display:      'flex',
      gap:          20,
      paddingBottom: 20,
      marginBottom: 20,
      borderBottom: '1px solid var(--ink-trace)',
    }}>
      <div style={{
        flexShrink:  0,
        width:       100,
        fontFamily:  'var(--font-mono)',
        fontSize:    9,
        color:       'var(--ink-trace)',
        letterSpacing: 0.5,
        lineHeight:  1.6,
        paddingTop:  2,
      }}>{trigger}</div>
      <div>
        <div style={{
          fontFamily:    'var(--font-mono)',
          fontSize:      11,
          color:         'var(--gold-dim)',
          marginBottom:  6,
          letterSpacing: 0.5,
        }}>{name}</div>
        <div style={{
          fontFamily:    'var(--font-serif)',
          fontSize:      13,
          color:         'var(--ink-dim)',
          lineHeight:    1.85,
          letterSpacing: 0.3,
        }}>{desc}</div>
      </div>
    </div>
  )
}

function FileTree() {
  const tree = [
    { depth: 0, name: 'content/spirit/',       desc: '' },
    { depth: 1, name: 'logs/',                 desc: '日修炼日志  2026-04-14.json' },
    { depth: 1, name: 'patterns/',             desc: '周规律分析  2026-W15.json' },
    { depth: 1, name: 'conversations/',        desc: '对话历史（按日期）' },
    { depth: 1, name: 'summaries/',            desc: '会话摘要（按日期）' },
    { depth: 1, name: 'skills/',               desc: '' },
    { depth: 2, name: 'index.json',            desc: '技能卡列表' },
    { depth: 2, name: 'embeddings.json',       desc: '技能卡向量缓存' },
    { depth: 1, name: 'library/',              desc: '' },
    { depth: 2, name: 'index.json',            desc: '藏经阁典籍列表' },
    { depth: 2, name: 'embeddings.json',       desc: '藏经阁向量缓存' },
    { depth: 1, name: 'notes/',                desc: 'AI 自由笔记（markdown）' },
    { depth: 1, name: 'preferences.json',      desc: '用户偏好画像' },
    { depth: 1, name: 'vows.json',             desc: '誓约列表' },
    { depth: 1, name: 'persona.json',          desc: '人格档案' },
    { depth: 1, name: 'conv_embeddings.json',  desc: '对话向量缓存' },
    { depth: 1, name: 'blog_embeddings.json',  desc: '博客向量缓存' },
    { depth: 1, name: 'blog_posts_cache.json', desc: '博客内容缓存' },
  ]

  return (
    <>
      {tree.map((item, i) => (
        <div key={i} style={{ display: 'flex', gap: 8 }}>
          <span style={{ color: 'var(--ink-trace)', userSelect: 'none' }}>
            {'  '.repeat(item.depth)}{item.depth > 0 ? '├─ ' : ''}
          </span>
          <span style={{ color: item.name.endsWith('/') ? 'var(--gold-dim)' : 'var(--ink)' }}>
            {item.name}
          </span>
          {item.desc && (
            <span style={{ color: 'var(--ink-trace)', fontSize: 11 }}>
              {'  '}{item.desc}
            </span>
          )}
        </div>
      ))}
    </>
  )
}
