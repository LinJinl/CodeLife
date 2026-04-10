import { getDashboardData } from '@/lib/data'

export const revalidate = 3600

export default async function HomePage() {
  const data = await getDashboardData()
  const { realm, totalPoints, blogCount, lcSolved, ghCommits, streak, recentActivity } = data

  const stats = [
    { val: totalPoints.toLocaleString(), key: '修　为' },
    { val: blogCount.toString(),         key: '著　述' },
    { val: lcSolved.toString(),          key: '铸　剑' },
    { val: ghCommits.toLocaleString(),   key: '声　望' },
    { val: streak.toString(),            key: '连续不辍' },
  ]

  const dotColor: Record<string, string> = {
    blog:    'var(--gold-dim)',
    github:  'var(--ink-dim)',
    leetcode:'var(--jade)',
  }

  return (
    <div>
      {/* ── Hero ── */}
      <section style={{
        minHeight: '100vh',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        textAlign: 'center', padding: '120px 20px 80px',
      }}>
        <div style={{ fontFamily: 'var(--font-serif)', fontSize: 10, letterSpacing: 5, color: 'var(--ink-dim)', marginBottom: 32 }}>
          当前境界
        </div>

        <div style={{
          fontFamily: 'var(--font-xiaowei), serif',
          fontSize: 'clamp(60px, 10vw, 96px)',
          letterSpacing: 24, textIndent: 24,
          color: 'var(--gold)', lineHeight: 1,
          marginBottom: realm.stage ? 14 : 52, opacity: 0.9,
        }}>
          {realm.name}
        </div>

        {realm.stage && (
          <div style={{
            fontFamily: 'var(--font-serif)', fontSize: 17,
            letterSpacing: 12, textIndent: 12,
            color: 'var(--ink-mid)', marginBottom: 52,
          }}>
            {realm.stage.split('').join('　')}
          </div>
        )}

        <div className="ornate" style={{ width: 360, margin: '0 auto 48px' }}>
          <div className="ornate-line r" />
          <div className="ornate-glyph">◆　◆　◆</div>
          <div className="ornate-line" />
        </div>

        <div style={{ display: 'flex', gap: 56, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 40 }}>
          {stats.map(f => (
            <div key={f.key} style={{ textAlign: 'center' }}>
              <div style={{ fontFamily: 'var(--font-serif)', fontSize: 26, color: 'var(--ink)', letterSpacing: 2, marginBottom: 8 }}>
                {f.val}
              </div>
              <div style={{ fontSize: 11, letterSpacing: 4, textIndent: 4, color: 'var(--ink-dim)' }}>{f.key}</div>
            </div>
          ))}
        </div>

        {realm.pointsToNext > 0 && (
          <div style={{ fontFamily: 'var(--font-serif)', fontSize: 13, color: 'var(--ink-dim)', letterSpacing: 3, lineHeight: 2 }}>
            距下一境界，尚余{' '}
            <span style={{ color: 'var(--gold-dim)' }}>{realm.pointsToNext.toLocaleString()}</span>{' '}修为
          </div>
        )}
      </section>

      {/* ── Recent Activity ── */}
      <section style={{ maxWidth: 620, margin: '0 auto', padding: '0 36px 100px' }}>
        <div className="section-head" style={{ marginBottom: 40 }}>
          <div className="section-head-line r" />
          <div className="section-head-text">近期修炼记录</div>
          <div className="section-head-line" />
        </div>

        {recentActivity.length === 0 ? (
          <p style={{ color: 'var(--ink-dim)', textAlign: 'center', letterSpacing: 3 }}>
            尚无记录，开始你的修炼之路
          </p>
        ) : recentActivity.map((item, i) => (
          <a key={i} href={`/blog/${item.slug}`} style={{
            display: 'grid',
            gridTemplateColumns: '52px 6px 1fr auto',
            gap: '0 14px',
            alignItems: 'baseline',
            padding: '14px 0',
            borderBottom: '1px solid var(--ink-trace)',
            textDecoration: 'none',
            cursor: 'pointer',
          }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-dim)' }}>
              {new Date(item.dateStr).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }).replace('/', '-')}
            </div>
            <div style={{
              width: 5, height: 5, borderRadius: '50%',
              background: dotColor[item.type] ?? 'var(--ink-dim)',
              marginTop: 5, alignSelf: 'start',
            }} />
            <div style={{ fontFamily: 'var(--font-serif)', fontSize: 14, color: 'var(--ink-mid)', lineHeight: 1.65 }}>
              著述·<strong style={{ color: 'var(--ink)', fontWeight: 400 }}>《{item.title}》</strong>
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--gold-dim)', opacity: 0.7 }}>
              {item.points > 0 ? `+${item.points}` : ''}
            </div>
          </a>
        ))}
      </section>
    </div>
  )
}
