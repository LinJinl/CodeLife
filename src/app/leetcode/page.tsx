import { getLeetcodeStats, getLeetcodeProblems } from '@/lib/data'

export const revalidate = 86400

const DIFF_LABEL: Record<string, string> = { easy: '初锻', medium: '淬炼', hard: '神铸' }
const DIFF_COLOR: Record<string, string> = {
  easy:   'var(--jade)',
  medium: 'var(--gold-dim)',
  hard:   'var(--seal)',
}

export default async function LeetcodePage() {
  const [stats, problems] = await Promise.all([
    getLeetcodeStats(),
    getLeetcodeProblems(),
  ])

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
        }}>铸剑台</div>
        <div style={{ fontFamily: 'var(--font-serif)', fontSize: 13, letterSpacing: 4, textIndent: 4, color: 'var(--ink-dim)' }}>
          千锤百炼　·　剑气纵横
        </div>
      </section>

      <div style={{ maxWidth: 600, margin: '0 auto', padding: '0 36px 100px' }}>
        {stats ? (
          <div style={{
            textAlign: 'center', fontFamily: 'var(--font-serif)',
            fontSize: 15, color: 'var(--ink-mid)',
            letterSpacing: 3, lineHeight: 2.4, marginBottom: 56,
          }}>
            已铸剑题共 <strong style={{ color: 'var(--ink)' }}>{stats.totalSolved} 枚</strong><br/>
            <span style={{ color: 'var(--seal)' }}>困难</span> {stats.hard} 枚
            <span style={{ color: 'var(--gold-dim)' }}>中等</span> {stats.medium} 枚
            <span style={{ color: 'var(--jade)' }}>简单</span> {stats.easy} 枚
          </div>
        ) : (
          <div style={{ textAlign: 'center', color: 'var(--ink-dim)', letterSpacing: 3, marginBottom: 56, lineHeight: 2 }}>
            在 codelife.config.ts 配置 leetcode 后，铸剑记录将在此显示<br/>
            或手动编辑 content/leetcode.yaml
          </div>
        )}

        {stats?.categories && stats.categories.length > 0 && (
          <>
            <div className="section-head" style={{ marginBottom: 28 }}>
              <div className="section-head-line r" />
              <div className="section-head-text">题型分类</div>
              <div className="section-head-line" />
            </div>

            <div style={{ marginBottom: 50 }}>
              {stats.categories.map(cat => (
                <div key={cat.name} style={{
                  display: 'flex', alignItems: 'center', padding: '17px 0',
                  borderBottom: '1px solid var(--ink-trace)', gap: 20,
                }}>
                  <div style={{ fontFamily: 'var(--font-serif)', fontSize: 15, color: 'var(--ink)', letterSpacing: 2, flex: 1 }}>
                    {cat.name}
                  </div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22, color: 'var(--ink-mid)', letterSpacing: -1 }}>
                    {cat.solved}
                  </div>
                  <div style={{
                    fontSize: 11, letterSpacing: 2, textIndent: 2,
                    color: cat.mastered ? 'var(--gold-dim)' : 'var(--ink-dim)',
                    width: 52, textAlign: 'right',
                  }}>
                    {cat.mastered ? '已精通' : '练习中'}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="section-head" style={{ margin: '44px 0 28px' }}>
          <div className="section-head-line r" />
          <div className="section-head-text">近期铸剑</div>
          <div className="section-head-line" />
        </div>

        {problems.length === 0 ? (
          <p style={{ color: 'var(--ink-dim)', textAlign: 'center', letterSpacing: 3 }}>铸剑台尚未开炉</p>
        ) : problems.slice(0, 20).map((p, i) => (
          <div key={i} style={{
            display: 'grid',
            gridTemplateColumns: '52px 36px 1fr auto',
            gap: '0 14px',
            alignItems: 'baseline',
            padding: '13px 0',
            borderBottom: '1px solid var(--ink-trace)',
          }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-dim)' }}>
              {new Date(p.solvedAt).toLocaleDateString('zh-CN',{month:'2-digit',day:'2-digit'}).replace('/','-')}
            </div>
            <div style={{ fontFamily: 'var(--font-serif)', fontSize: 11, color: DIFF_COLOR[p.difficulty], letterSpacing: 1 }}>
              {DIFF_LABEL[p.difficulty]}
            </div>
            <div style={{ fontFamily: 'var(--font-serif)', fontSize: 14, color: 'var(--ink-mid)', letterSpacing: 1 }}>
              {p.title}
            </div>
            <div style={{ fontSize: 11, letterSpacing: 2, textIndent: 2, color: 'var(--gold-dim)', opacity: 0.8 }}>
              已悟
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
