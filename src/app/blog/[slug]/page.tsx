import { getBlogPost, getBlogPosts } from '@/lib/data'
import { notFound } from 'next/navigation'
import ReactMarkdown from 'react-markdown'

export const revalidate = 3600

export async function generateStaticParams() {
  const posts = await getBlogPosts()
  return posts.map(p => ({ slug: p.slug }))
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const post = await getBlogPost(slug)
  if (!post) notFound()

  return (
    <div>
      {/* ── Header ── */}
      <section style={{
        minHeight: '48vh',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'flex-end',
        textAlign: 'center', padding: '120px 36px 56px',
      }}>
        <div style={{ fontFamily: 'var(--font-serif)', fontSize: 11, letterSpacing: 4, color: 'var(--ink-dim)', marginBottom: 24 }}>
          {post.category}
        </div>
        <h1 style={{
          fontFamily: 'var(--font-xiaowei), serif',
          fontSize: 'clamp(26px, 5vw, 40px)',
          letterSpacing: 8, textIndent: 8,
          color: 'var(--ink)', fontWeight: 400,
          lineHeight: 1.5, marginBottom: 28, maxWidth: 640,
        }}>{post.title}</h1>

        <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap', justifyContent: 'center' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-dim)', letterSpacing: 1 }}>
            {new Date(post.publishedAt).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })}
          </span>
          {post.wordCount > 0 && (
            <>
              <span style={{ color: 'var(--ink-trace)' }}>·</span>
              <span style={{ fontFamily: 'var(--font-serif)', fontSize: 11, color: 'var(--ink-dim)', letterSpacing: 1 }}>
                {post.wordCount.toLocaleString()} 字　约 {post.readingMinutes} 分钟
              </span>
            </>
          )}
          {post.pointsLabel && (
            <>
              <span style={{ color: 'var(--ink-trace)' }}>·</span>
              <span className="seal-mark">{post.pointsLabel} +{post.pointsEarned}</span>
            </>
          )}
        </div>

        {post.tags.length > 0 && (
          <div style={{ display: 'flex', gap: 8, marginTop: 20, flexWrap: 'wrap', justifyContent: 'center' }}>
            {post.tags.map(t => (
              <a key={t} href={`/blog?tag=${encodeURIComponent(t)}`} style={{
                fontFamily: 'var(--font-serif)', fontSize: 10, letterSpacing: 2,
                padding: '2px 10px', textDecoration: 'none',
                border: '1px solid var(--ink-trace)', color: 'var(--ink-dim)',
              }}>{t}</a>
            ))}
          </div>
        )}
      </section>

      <div className="ornate" style={{ width: 320, margin: '0 auto 56px' }}>
        <div className="ornate-line r" />
        <div className="ornate-glyph">◆　◆　◆</div>
        <div className="ornate-line" />
      </div>

      {/* ── 正文 ── */}
      <article style={{ maxWidth: 680, margin: '0 auto', padding: '0 36px 120px' }}>
        <div className="prose">
          <ReactMarkdown>{post.content}</ReactMarkdown>
        </div>
      </article>

      {/* ── 底部导航 ── */}
      <div style={{ maxWidth: 680, margin: '0 auto', padding: '0 36px 80px', textAlign: 'center' }}>
        <a href="/blog" style={{
          fontFamily: 'var(--font-serif)', fontSize: 12, letterSpacing: 4,
          color: 'var(--ink-dim)', textDecoration: 'none',
          borderBottom: '1px solid var(--ink-trace)', paddingBottom: 2,
        }}>← 返回藏经阁</a>
      </div>
    </div>
  )
}
