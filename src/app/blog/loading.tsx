export default function BlogLoading() {
  return (
    <div>
      {/* Hero 占位 */}
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

      {/* 骨架列表 */}
      <section style={{ maxWidth: 600, margin: '0 auto', padding: '0 36px 100px' }}>
        <div className="section-head" style={{ marginBottom: 40 }}>
          <div className="section-head-line r" />
          <div className="section-head-text">全部心法</div>
          <div className="section-head-line" />
        </div>

        {[1, 2, 3, 4, 5].map(i => (
          <div key={i} style={{
            display: 'flex', gap: 22, alignItems: 'flex-start',
            padding: '22px 0', borderBottom: '1px solid var(--ink-trace)',
          }}>
            <div className="skeleton" style={{ width: 40, height: 14, flexShrink: 0, marginTop: 3 }} />
            <div style={{ flex: 1 }}>
              <div className="skeleton" style={{ width: `${60 + i * 8}%`, height: 16, marginBottom: 12 }} />
              <div className="skeleton" style={{ width: '35%', height: 11 }} />
            </div>
          </div>
        ))}
      </section>

      <style>{`
        .skeleton {
          background: linear-gradient(90deg,
            var(--ink-trace) 25%,
            rgba(46,38,32,0.6) 50%,
            var(--ink-trace) 75%
          );
          background-size: 200% 100%;
          animation: shimmer 1.8s infinite;
          border-radius: 1px;
        }
        @keyframes shimmer {
          from { background-position: 200% center; }
          to   { background-position: -200% center; }
        }
      `}</style>
    </div>
  )
}
