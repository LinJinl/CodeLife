export default function HomeLoading() {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      gap: 32,
    }}>
      <div style={{ position: 'relative', width: 64, height: 64 }}>
        {/* 外环 */}
        <div style={{
          position: 'absolute', inset: 0,
          border: '1px solid rgba(196,149,53,0.25)',
          borderTopColor: 'var(--gold-dim)',
          borderRadius: '50%',
          animation: 'spin 1.6s linear infinite',
        }} />
        {/* 内环 */}
        <div style={{
          position: 'absolute', inset: 10,
          border: '1px solid rgba(196,149,53,0.12)',
          borderBottomColor: 'rgba(196,149,53,0.45)',
          borderRadius: '50%',
          animation: 'spin 2.4s linear infinite reverse',
        }} />
        {/* 中心点 */}
        <div style={{
          position: 'absolute',
          top: '50%', left: '50%',
          transform: 'translate(-50%,-50%)',
          width: 4, height: 4,
          borderRadius: '50%',
          background: 'var(--gold-dim)',
          animation: 'pulse-dot 1.6s ease-in-out infinite',
        }} />
      </div>

      <div style={{
        fontFamily: 'var(--font-xiaowei), serif',
        fontSize: 13, letterSpacing: 8, textIndent: 8,
        color: 'var(--ink-dim)',
        animation: 'fade-text 1.6s ease-in-out infinite',
      }}>推演天机中</div>

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        @keyframes pulse-dot {
          0%, 100% { opacity: 0.3; transform: translate(-50%,-50%) scale(1); }
          50%       { opacity: 1;   transform: translate(-50%,-50%) scale(1.6); }
        }
        @keyframes fade-text {
          0%, 100% { opacity: 0.3; }
          50%       { opacity: 0.8; }
        }
      `}</style>
    </div>
  )
}
