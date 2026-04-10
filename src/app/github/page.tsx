import { getGithubRepos, getGithubCommits, getGithubStats } from '@/lib/data'

export const revalidate = 3600

export default async function GithubPage() {
  const [repos, commits, stats] = await Promise.all([
    getGithubRepos(),
    getGithubCommits(),
    getGithubStats(),
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
        }}>声望殿</div>
        <div style={{ fontFamily: 'var(--font-serif)', fontSize: 13, letterSpacing: 4, textIndent: 4, color: 'var(--ink-dim)' }}>
          日积月累　·　声名远播
        </div>
      </section>

      <div style={{ maxWidth: 600, margin: '0 auto', padding: '0 36px 100px' }}>
        {stats ? (
          <div style={{
            textAlign: 'center', fontFamily: 'var(--font-serif)',
            fontSize: 15, color: 'var(--ink-mid)', letterSpacing: 3, lineHeight: 2.4, marginBottom: 56,
          }}>
            入道以来，共铸 <span style={{ color: 'var(--gold-dim)' }}>{stats.totalCommits.toLocaleString()} 锤</span><br/>
            当前已连续贡献 <span style={{ color: 'var(--gold-dim)'}}>{stats.currentStreak} 日</span>
          </div>
        ) : (
          <div style={{ textAlign: 'center', color: 'var(--ink-dim)', letterSpacing: 3, marginBottom: 56, lineHeight: 2 }}>
            在 codelife.config.ts 配置 GITHUB_TOKEN 后，声望记录将在此显示
          </div>
        )}

        {repos.length > 0 && (
          <>
            <div className="section-head" style={{ marginBottom: 0 }}>
              <div className="section-head-line r" />
              <div className="section-head-text">当前神兵</div>
              <div className="section-head-line" />
            </div>

            {repos.map(repo => (
              <a key={repo.name} href={repo.url} target="_blank" rel="noopener noreferrer" style={{
                display: 'block', padding: '24px 0',
                borderBottom: '1px solid var(--ink-trace)',
                textDecoration: 'none',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 8 }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 17, color: 'var(--ink)', letterSpacing: 0.5 }}>
                    {repo.name}
                  </div>
                  {repo.stars > 0 && (
                    <div style={{
                      fontFamily: 'var(--font-serif)', fontSize: 10, letterSpacing: 2, textIndent: 2,
                      color: 'var(--gold-dim)', border: '1px solid rgba(196,149,53,0.22)',
                      padding: '2px 8px',
                    }}>
                      ★ {repo.stars}
                    </div>
                  )}
                </div>
                <div style={{ fontFamily: 'var(--font-serif)', fontSize: 13, color: 'var(--ink-dim)', letterSpacing: 1, lineHeight: 1.8 }}>
                  {repo.description ?? '此剑尚无描述'}<br/>
                  {repo.language && <span>{repo.language} · </span>}
                  共铸 {repo.commitCount} 锤
                </div>
              </a>
            ))}
          </>
        )}

        {commits.length > 0 && (
          <>
            <div className="section-head" style={{ margin: '44px 0 28px' }}>
              <div className="section-head-line r" />
              <div className="section-head-text">铸造记录</div>
              <div className="section-head-line" />
            </div>

            {commits.map((c, i) => (
              <div key={i} style={{
                display: 'grid',
                gridTemplateColumns: '52px 58px 1fr auto',
                gap: '0 12px',
                alignItems: 'baseline',
                padding: '13px 0',
                borderBottom: '1px solid var(--ink-trace)',
              }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-dim)' }}>
                  {new Date(c.committedAt).toLocaleDateString('zh-CN',{month:'2-digit',day:'2-digit'}).replace('/','-')}
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-trace)', letterSpacing: 0.5 }}>
                  {c.hash}
                </div>
                <div style={{
                  fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-mid)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {c.message}
                </div>
                <div style={{ fontFamily: 'var(--font-serif)', fontSize: 11, color: 'var(--ink-dim)', letterSpacing: 1, whiteSpace: 'nowrap', paddingLeft: 8 }}>
                  {c.repoName}
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
