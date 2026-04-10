import { getBlogPosts } from '@/lib/data'
import { SyncBlogButton } from '@/components/SyncBlogButton'

export const revalidate = 3600

export default async function BlogPage({
  searchParams,
}: {
  searchParams: Promise<{ tag?: string; category?: string }>
}) {
  const { tag, category } = await searchParams
  const allPosts = await getBlogPosts()
  const posts = category
    ? allPosts.filter(p => p.category === category)
    : tag
      ? allPosts.filter(p => p.tags.includes(tag))
      : allPosts

  // 收集所有标签
  const tagCounts = new Map<string, number>()
  for (const p of allPosts) {
    for (const t of p.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1)
  }
  const allTags = Array.from(tagCounts.entries()).sort((a, b) => b[1] - a[1])

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
        }}>心法卷轴</div>
        <div style={{ fontFamily: 'var(--font-serif)', fontSize: 13, letterSpacing: 4, textIndent: 4, color: 'var(--ink-dim)' }}>
          著述之录　·　顿悟之迹
        </div>
      </section>

      <section style={{ maxWidth: 600, margin: '0 auto', padding: '0 36px 100px' }}>

        {/* ── 标签云 ── */}
        {allTags.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 40 }}>
            <a href="/blog" style={{
              fontFamily: 'var(--font-serif)', fontSize: 11, letterSpacing: 2,
              padding: '4px 12px', textDecoration: 'none',
              border: '1px solid',
              borderColor: !tag ? 'var(--gold-dim)' : 'var(--ink-trace)',
              color: !tag ? 'var(--gold-dim)' : 'var(--ink-dim)',
            }}>全部</a>
            {allTags.map(([t, count]) => (
              <a key={t} href={`/blog?tag=${encodeURIComponent(t)}`} style={{
                fontFamily: 'var(--font-serif)', fontSize: 11, letterSpacing: 2,
                padding: '4px 12px', textDecoration: 'none',
                border: '1px solid',
                borderColor: tag === t ? 'var(--gold-dim)' : 'var(--ink-trace)',
                color: tag === t ? 'var(--gold-dim)' : 'var(--ink-dim)',
              }}>{t} <span style={{ opacity: 0.5 }}>{count}</span></a>
            ))}
          </div>
        )}

        <div className="section-head" style={{ marginBottom: 40 }}>
          <div className="section-head-line r" />
          <div className="section-head-text">{tag ? `# ${tag}` : '全部心法'}</div>
          <div className="section-head-line" />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 20, marginTop: -20 }}>
          <SyncBlogButton />
        </div>

        {posts.length === 0 ? (
          <p style={{ color: 'var(--ink-dim)', textAlign: 'center', letterSpacing: 3, lineHeight: 2 }}>
            {tag ? `尚无「${tag}」相关心法` : '心法卷轴空空如也'}
          </p>
        ) : posts.map(post => (
          <a href={`/blog/${post.slug}`} key={post.id} style={{
            display: 'flex', gap: 22, alignItems: 'flex-start',
            padding: '22px 0', borderBottom: '1px solid var(--ink-trace)',
            cursor: 'pointer', textDecoration: 'none',
          }}>
            <div style={{
              fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-dim)',
              letterSpacing: 0.5, flexShrink: 0, paddingTop: 2, width: 56,
            }}>
              {new Date(post.publishedAt).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }).replace('/', '-')}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{
                fontFamily: 'var(--font-serif)', fontSize: 16,
                color: 'var(--ink)', letterSpacing: 2,
                marginBottom: 9, lineHeight: 1.5,
              }}>{post.title}</div>
              <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, fontSize: 11, color: 'var(--ink-dim)', letterSpacing: 1 }}>
                <span>{post.category}</span>
                <span>·</span>
                <span>{post.wordCount > 0 ? `${post.wordCount.toLocaleString()} 字` : '阅读'}</span>
                {post.pointsLabel && <span className="seal-mark">{post.pointsLabel}</span>}
                {post.tags.map(t => (
                  <a key={t} href={`/blog?tag=${encodeURIComponent(t)}`}
                    onClick={e => e.stopPropagation()}
                    style={{
                      fontSize: 10, letterSpacing: 1, padding: '1px 7px',
                      border: '1px solid var(--ink-trace)',
                      color: tag === t ? 'var(--gold-dim)' : 'var(--ink-dim)',
                      borderColor: tag === t ? 'rgba(196,149,53,0.4)' : 'var(--ink-trace)',
                      textDecoration: 'none',
                    }}>{t}</a>
                ))}
              </div>
            </div>
          </a>
        ))}
      </section>
    </div>
  )
}
