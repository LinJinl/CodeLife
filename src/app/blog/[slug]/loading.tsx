export default function PostLoading() {
  return (
    <div>
      {/* Header 占位 */}
      <section style={{
        minHeight: '48vh',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'flex-end',
        textAlign: 'center', padding: '120px 36px 56px',
        gap: 16,
      }}>
        <div className="skeleton" style={{ width: 60, height: 11 }} />
        <div className="skeleton" style={{ width: 380, height: 36, maxWidth: '80vw' }} />
        <div className="skeleton" style={{ width: 200, height: 11 }} />
      </section>

      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        gap: 14, width: 320, margin: '0 auto 56px',
      }}>
        <div style={{ flex: 1, height: 1, background: 'var(--gold-line)' }} />
        <div style={{ color: 'var(--gold-dim)', fontSize: 9, letterSpacing: 4 }}>◆　◆　◆</div>
        <div style={{ flex: 1, height: 1, background: 'var(--gold-line)' }} />
      </div>

      {/* 正文骨架 */}
      <article style={{ maxWidth: 680, margin: '0 auto', padding: '0 36px 120px' }}>
        {[90, 75, 85, 60, 80, 70, 88, 55, 78, 65, 82, 50].map((w, i) => (
          <div key={i} className="skeleton" style={{
            width: `${w}%`, height: 14,
            marginBottom: i % 4 === 3 ? 28 : 10,
          }} />
        ))}
      </article>

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
