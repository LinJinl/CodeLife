import { getBlogPosts, getLeetcodeProblems } from '@/lib/data'
import { deriveSkillGraph }                  from '@/lib/gongfa/derive'
import SkillGraph                            from '@/components/SkillGraph'

export const revalidate = 3600

export default async function GongfaPage() {
  const [posts, problems] = await Promise.all([
    getBlogPosts().catch(() => []),
    getLeetcodeProblems().catch(() => []),
  ])

  const graph = deriveSkillGraph(
    posts.map(p => ({
      title:       p.title,
      category:    p.category,
      tags:        p.tags,
      wordCount:   p.wordCount,
      publishedAt: p.publishedAt,   // unstable_cache 后可能是 string，derive.ts 内部兼容处理
    })),
    problems.map(p => ({
      title:      p.title,
      difficulty: p.difficulty,
      category:   p.category,
      solvedAt:   p.solvedAt,
      language:   p.language,
    })),
  )

  const hasData = graph.nodes.length > 0

  return (
    <div>
      {/* ── Hero ── */}
      <section style={{
        minHeight: '42vh',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'flex-end',
        textAlign: 'center', padding: '100px 20px 48px',
      }}>
        <div style={{
          fontFamily: 'var(--font-xiaowei), serif',
          fontSize: 'clamp(38px, 6vw, 58px)',
          letterSpacing: 18, textIndent: 18,
          color: 'var(--gold)', opacity: 0.86, marginBottom: 14,
        }}>功法殿</div>
        <div style={{
          fontFamily: 'var(--font-serif)', fontSize: 13,
          letterSpacing: 4, textIndent: 4, color: 'var(--ink-dim)',
        }}>
          凝炼心得　·　图观大道
        </div>
        {hasData && (
          <div style={{
            fontFamily: 'var(--font-mono)', fontSize: 10,
            color: 'var(--ink-trace)', letterSpacing: 2, marginTop: 10,
          }}>
            {graph.nodes.length} 个功法节点　{graph.edges.length} 条关联
          </div>
        )}
      </section>

      {/* ── 图谱区 ── */}
      <div style={{
        margin: '0 auto 80px',
        maxWidth: 1200,
        padding: '0 24px',
      }}>
        {hasData ? (
          <div style={{
            height: 'calc(100vh - 280px)',
            minHeight: 480,
            position: 'relative',
          }}>
            <SkillGraph graph={graph} />
          </div>
        ) : (
          <div style={{
            height: 320,
            border: '1px solid var(--ink-trace)',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 12,
          }}>
            <div style={{
              fontFamily: 'var(--font-xiaowei), serif',
              fontSize: 18, color: 'var(--ink-dim)', letterSpacing: 4,
            }}>功法殿空空如也</div>
            <div style={{
              fontFamily: 'var(--font-serif)', fontSize: 11,
              color: 'var(--ink-trace)', letterSpacing: 2, lineHeight: 2,
              textAlign: 'center',
            }}>
              在 codelife.config.ts 中配置博客数据源，<br/>
              发布文章并添加标签后，功法将自动浮现
            </div>
          </div>
        )}
      </div>

      {/* ── 说明 ── */}
      {hasData && (
        <div style={{
          maxWidth: 520, margin: '0 auto 100px',
          padding: '0 36px',
          fontFamily: 'var(--font-serif)', fontSize: 12,
          color: 'var(--ink-trace)', lineHeight: 2.2,
          letterSpacing: 1, textAlign: 'center',
        }}>
          节点大小代表涉猎深度　连线粗细代表关联频次<br/>
          悬停节点可查看对应的著述与铸剑记录
        </div>
      )}
    </div>
  )
}
