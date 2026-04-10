import { loadLibraryIndex } from '@/lib/spirit/tools/library'

export const dynamic = 'force-dynamic'

const CATEGORY_COLORS: Record<string, string> = {
  '算法':     'var(--jade)',
  '系统设计': 'var(--gold-dim)',
  '工程实践': 'var(--gold-dim)',
  '前端':     'var(--seal)',
  '后端':     'var(--seal)',
  '数学':     'var(--ink-mid)',
  '其他':     'var(--ink-dim)',
}

function categoryColor(cat: string) {
  return CATEGORY_COLORS[cat] ?? 'var(--ink-dim)'
}

export default async function ResourcesPage({
  searchParams,
}: {
  searchParams: Promise<{ tag?: string }>
}) {
  const { tag } = await searchParams
  const allEntries = loadLibraryIndex()
  const entries = tag ? allEntries.filter(e => e.tags.includes(tag)) : allEntries

  // 统计基于全部数据
  const categories = Array.from(new Set(allEntries.map(e => e.category)))
  const catCounts  = categories.map(cat => ({
    name:  cat,
    count: allEntries.filter(e => e.category === cat).length,
  })).sort((a, b) => b.count - a.count)

  const tagCounts = new Map<string, number>()
  allEntries.forEach(e => e.tags.forEach(t => tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1)))
  const topTags = Array.from(tagCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 20)

  return (
    <div>
      <section style={{
        minHeight: '52vh',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'flex-end',
        textAlign: 'center', padding: '120px 20px 64px',
      }}>
        <div style={{
          fontFamily: 'var(--font-xiaowei), serif',
          fontSize: 'clamp(38px, 6vw, 58px)',
          letterSpacing: 18, textIndent: 18,
          color: 'var(--gold)', opacity: 0.86, marginBottom: 14,
        }}>藏经阁</div>
        <div style={{ fontFamily: 'var(--font-serif)', fontSize: 13, letterSpacing: 4, textIndent: 4, color: 'var(--ink-dim)' }}>
          珍贵典籍　·　览典之所
        </div>
      </section>

      <div style={{ maxWidth: 680, margin: '0 auto', padding: '0 36px 100px' }}>

        {entries.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--ink-dim)', letterSpacing: 3, lineHeight: 2.8, paddingTop: 20 }}>
            藏经阁尚无典籍<br/>
            <span style={{ fontSize: 12, color: 'var(--ink-trace)' }}>
              呼唤器灵，说「帮我收藏这篇文章」即可入典
            </span>
          </div>
        ) : (
          <>
            {/* 统计概览 */}
            <div style={{
              display: 'flex', gap: 32, justifyContent: 'center',
              fontFamily: 'var(--font-serif)', fontSize: 13,
              color: 'var(--ink-mid)', letterSpacing: 3, lineHeight: 2.4,
              marginBottom: 48, textAlign: 'center',
            }}>
              <div>
                <div style={{ fontSize: 26, color: 'var(--ink)', fontFamily: 'var(--font-mono)', letterSpacing: 0 }}>
                  {allEntries.length}
                </div>
                <div>典籍</div>
              </div>
              <div>
                <div style={{ fontSize: 26, color: 'var(--ink)', fontFamily: 'var(--font-mono)', letterSpacing: 0 }}>
                  {categories.length}
                </div>
                <div>分类</div>
              </div>
              <div>
                <div style={{ fontSize: 26, color: 'var(--ink)', fontFamily: 'var(--font-mono)', letterSpacing: 0 }}>
                  {tagCounts.size}
                </div>
                <div>标签</div>
              </div>
            </div>

            {/* 分类标签云 */}
            {catCounts.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 48 }}>
                {catCounts.map(c => (
                  <div key={c.name} style={{
                    fontFamily: 'var(--font-serif)', fontSize: 11, letterSpacing: 2,
                    padding: '4px 12px',
                    border: '1px solid',
                    borderColor: categoryColor(c.name),
                    color: categoryColor(c.name),
                  }}>
                    {c.name} <span style={{ opacity: 0.5 }}>{c.count}</span>
                  </div>
                ))}
              </div>
            )}

            {/* 标签云 */}
            {topTags.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 52 }}>
                {tag && (
                  <a href="/resources" style={{
                    fontFamily: 'var(--font-serif)', fontSize: 10, letterSpacing: 1,
                    padding: '2px 8px', border: '1px solid var(--gold-dim)',
                    color: 'var(--gold-dim)', textDecoration: 'none',
                  }}>全部</a>
                )}
                {topTags.map(([t, count]) => (
                  <a key={t} href={tag === t ? '/resources' : `/resources?tag=${encodeURIComponent(t)}`} style={{
                    fontFamily: 'var(--font-serif)', fontSize: 10, letterSpacing: 1,
                    padding: '2px 8px', textDecoration: 'none',
                    border: `1px solid ${tag === t ? 'var(--gold-dim)' : 'var(--ink-trace)'}`,
                    color: tag === t ? 'var(--gold-dim)' : 'var(--ink-dim)',
                  }}>
                    {t} {count > 1 && <span style={{ opacity: 0.4 }}>{count}</span>}
                  </a>
                ))}
              </div>
            )}

            {/* 典籍列表 */}
            <div className="section-head" style={{ marginBottom: 32 }}>
              <div className="section-head-line r" />
              <div className="section-head-text">{tag ? `# ${tag}` : '全部典籍'}</div>
              <div className="section-head-line" />
            </div>

            {entries.length === 0 && tag && (
              <div style={{ textAlign: 'center', color: 'var(--ink-dim)', letterSpacing: 3, lineHeight: 2.8, paddingTop: 10 }}>
                尚无「{tag}」相关典籍
              </div>
            )}

            {entries.map(entry => (
              <div key={entry.id} style={{
                padding: '22px 0',
                borderBottom: '1px solid var(--ink-trace)',
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 8 }}>
                  {entry.url ? (
                    <a href={entry.url} target="_blank" rel="noopener noreferrer" style={{
                      fontFamily: 'var(--font-serif)', fontSize: 15,
                      color: 'var(--ink)', letterSpacing: 1.5, lineHeight: 1.5,
                      textDecoration: 'none', borderBottom: '1px solid var(--ink-trace)',
                      flex: 1,
                    }}>
                      {entry.title}
                    </a>
                  ) : (
                    <div style={{
                      fontFamily: 'var(--font-serif)', fontSize: 15,
                      color: 'var(--ink)', letterSpacing: 1.5, lineHeight: 1.5, flex: 1,
                    }}>
                      {entry.title}
                    </div>
                  )}
                  <a href={`/resources?tag=${encodeURIComponent(entry.category)}`} style={{
                    fontFamily: 'var(--font-serif)', fontSize: 10, letterSpacing: 1,
                    color: categoryColor(entry.category),
                    border: '1px solid', borderColor: categoryColor(entry.category),
                    padding: '1px 7px', flexShrink: 0, marginTop: 2,
                    textDecoration: 'none',
                  }}>
                    {entry.category}
                  </a>
                </div>

                <div style={{
                  fontFamily: 'var(--font-serif)', fontSize: 12,
                  color: 'var(--ink-dim)', letterSpacing: 0.5, lineHeight: 1.8,
                  marginBottom: 10,
                }}>
                  {entry.summary}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  {entry.tags.map(t => (
                    <a key={t} href={tag === t ? '/resources' : `/resources?tag=${encodeURIComponent(t)}`} style={{
                      fontFamily: 'var(--font-serif)', fontSize: 10, letterSpacing: 1,
                      padding: '1px 7px', textDecoration: 'none',
                      border: `1px solid ${tag === t ? 'rgba(196,149,53,0.5)' : 'var(--ink-trace)'}`,
                      color: tag === t ? 'var(--gold-dim)' : 'var(--ink-dim)',
                    }}>{t}</a>
                  ))}
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-trace)', marginLeft: 'auto' }}>
                    {new Date(entry.savedAt).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }).replace('/', '-')}
                  </span>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
