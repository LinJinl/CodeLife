'use client'

import { memo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import type { LibraryCard, SkillCardData } from '@/lib/spirit/protocol'
import type { Message } from './types'

// ── 藏经阁结果卡片 ─────────────────────────────────────────────

const CATEGORY_COLORS: Record<string, string> = {
  '算法': 'var(--jade)', '系统设计': 'var(--gold-dim)', '工程实践': 'var(--gold-dim)',
  '前端': 'var(--seal)', '后端': 'var(--seal)', '数学': 'var(--ink-mid)', '其他': 'var(--ink-dim)',
}
function categoryColor(cat: string) { return CATEGORY_COLORS[cat] ?? 'var(--ink-dim)' }

function LibraryCards({ entries }: { entries: LibraryCard[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
      {entries.map(e => (
        <div key={e.id} style={{
          background: 'var(--deep)',
          border: '1px solid var(--ink-trace)',
          padding: '10px 14px',
          borderRadius: 2,
        }}>
          {e.url ? (
            <a href={e.url} target="_blank" rel="noopener noreferrer" style={{
              fontFamily: 'var(--font-serif)', fontSize: 13,
              color: 'var(--ink)', letterSpacing: 1, lineHeight: 1.5,
              textDecoration: 'none', borderBottom: '1px solid var(--ink-trace)',
              display: 'inline',
            }}>
              {e.title}
            </a>
          ) : (
            <span style={{ fontFamily: 'var(--font-serif)', fontSize: 13, color: 'var(--ink)', letterSpacing: 1 }}>
              {e.title}
            </span>
          )}
          {e.summary && (
            <div style={{
              fontFamily: 'var(--font-serif)', fontSize: 11,
              color: 'var(--ink-dim)', lineHeight: 1.7, margin: '6px 0 8px',
              letterSpacing: 0.3,
            }}>
              {e.summary}
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <a href="/resources" style={{
              fontFamily: 'var(--font-serif)', fontSize: 9, letterSpacing: 1,
              padding: '1px 6px', border: '1px solid',
              borderColor: categoryColor(e.category),
              color: categoryColor(e.category),
              textDecoration: 'none', flexShrink: 0,
            }}>
              {e.category}
            </a>
            {e.tags.map(tag => (
              <a key={tag} href={`/resources?tag=${encodeURIComponent(tag)}`} style={{
                fontFamily: 'var(--font-serif)', fontSize: 9, letterSpacing: 1,
                padding: '1px 6px', border: '1px solid var(--ink-trace)',
                color: 'var(--ink-dim)', textDecoration: 'none',
              }}>
                {tag}
              </a>
            ))}
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--ink-trace)', marginLeft: 'auto' }}>
              {new Date(e.savedAt).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }).replace('/', '-')}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── 技能卡 ────────────────────────────────────────────────────

function SkillCardItem({ card }: { card: SkillCardData }) {
  return (
    <div style={{
      background: 'linear-gradient(135deg, rgba(212,168,67,0.06) 0%, rgba(0,0,0,0) 100%)',
      border: '1px solid rgba(212,168,67,0.25)',
      borderLeft: '2px solid var(--gold-dim)',
      padding: '10px 14px',
      borderRadius: 2,
      marginTop: 4,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 5 }}>
        <span style={{
          fontFamily: 'var(--font-xiaowei), serif',
          fontSize: 13,
          color: 'var(--gold)',
          letterSpacing: 2,
          flex: 1,
        }}>
          {card.title}
        </span>
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 9,
          color: 'var(--ink-trace)',
          flexShrink: 0,
        }}>
          {card.sourceDate}
        </span>
      </div>
      <div style={{
        fontFamily: 'var(--font-serif)',
        fontSize: 11,
        color: 'var(--ink-dim)',
        lineHeight: 1.75,
        letterSpacing: 0.3,
        marginBottom: card.tags.length > 0 ? 7 : 0,
      }}>
        {card.insight}
      </div>
      {card.tags.length > 0 && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {card.tags.map(tag => (
            <span key={tag} style={{
              fontFamily: 'var(--font-serif)',
              fontSize: 9,
              letterSpacing: 1,
              padding: '1px 6px',
              border: '1px solid rgba(212,168,67,0.2)',
              color: 'var(--gold-dim)',
            }}>
              {tag}
            </span>
          ))}
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 9,
            color: 'var(--ink-trace)',
            marginLeft: 'auto',
            alignSelf: 'center',
          }}>
            {card.id}
          </span>
        </div>
      )}
    </div>
  )
}

function SkillCards({ cards }: { cards: SkillCardData[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
      {cards.map(c => <SkillCardItem key={c.id} card={c} />)}
    </div>
  )
}

// ── 思考过程折叠块 ─────────────────────────────────────────────

function ThinkingBlock({ content, streaming }: { content: string; streaming: boolean }) {
  const [expanded, setExpanded] = useState(false)
  if (!content && !streaming) return null
  return (
    <div style={{ marginBottom: 8 }}>
      <button
        onClick={() => setExpanded(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          background: 'none', border: 'none', cursor: 'pointer',
          padding: '2px 0', color: 'var(--ink-dim)',
        }}
      >
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: 1,
          color: streaming ? 'var(--gold-dim)' : 'var(--ink-dim)',
        }}>
          {streaming ? '推演中' : '推演'}
        </span>
        <span style={{
          fontSize: 8, color: 'var(--ink-trace)',
          transform: expanded ? 'rotate(90deg)' : 'none',
          display: 'inline-block', transition: 'transform 0.15s',
        }}>▶</span>
      </button>
      {expanded && content && (
        <div style={{
          marginTop: 4, padding: '6px 10px',
          borderLeft: '2px solid var(--ink-trace)',
          fontFamily: 'var(--font-serif)', fontSize: 11,
          color: 'var(--ink-dim)', lineHeight: 1.7,
          letterSpacing: 0.3, whiteSpace: 'pre-wrap',
          maxHeight: 240, overflowY: 'auto',
        }}>
          {content}
          {streaming && <span style={{ opacity: 0.4, animation: 'spirit-blink 1s infinite' }}>▌</span>}
        </div>
      )}
    </div>
  )
}

// ── 权限确认区（作为 MessageItem 内嵌子视图） ─────────────────

function PermissionView({
  pr, onPermission,
}: {
  pr: NonNullable<Message['permissionRequest']>
  onPermission: (d: 'once' | 'session' | 'deny') => void
}) {
  const isWrite = pr.level === 'write'
  const isDest  = pr.level === 'destructive'
  const accentColor = isDest ? 'var(--seal)' : isWrite ? 'var(--jade)' : 'var(--gold-dim)'
  const decisions = isWrite
    ? (['once', 'deny'] as const)
    : (['once', 'session', 'deny'] as const)
  const labelMap: Record<string, string> = {
    once:    isWrite ? '确认' : '执行一次',
    session: '本次会话允许',
    deny:    '拒绝',
  }
  const headerText = isDest ? '⚠ 高危操作' : isWrite ? '写操作确认' : '需要确认'

  return (
    <div style={{
      margin: '8px 0', padding: '10px 14px',
      border: `1px solid ${accentColor}`,
      borderRadius: 2, background: 'var(--deep)',
    }}>
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: 10,
        color: accentColor, letterSpacing: 1, marginBottom: 6,
      }}>
        {headerText}
      </div>
      <div style={{
        fontFamily: 'var(--font-serif)', fontSize: 12,
        color: 'var(--ink)', lineHeight: 1.6,
        marginBottom: 10,
      }}>
        {pr.command}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        {decisions.map(d => (
          <button
            key={d}
            onClick={() => onPermission(d)}
            style={{
              fontFamily: 'var(--font-serif)', fontSize: 10, letterSpacing: 1,
              padding: '3px 10px', border: '1px solid',
              borderColor: d === 'deny' ? 'var(--ink-trace)'
                : d === 'session' ? 'var(--jade)'
                : accentColor,
              color: d === 'deny' ? 'var(--ink-dim)'
                : d === 'session' ? 'var(--jade)'
                : accentColor,
              background: 'transparent', cursor: 'pointer', borderRadius: 1,
            }}
          >
            {labelMap[d]}
          </button>
        ))}
      </div>
    </div>
  )
}

// ── 主消息条目 ─────────────────────────────────────────────────

export const MessageItem = memo(function MessageItem({
  msg, isLast, loading, phase, onPermission,
}: {
  msg:           Message
  isLast:        boolean
  loading:       boolean
  phase:         'idle' | 'thinking' | 'tooling' | 'replying'
  onPermission?: (decision: 'once' | 'session' | 'deny') => void
}) {
  const streamingThinking = loading && isLast && phase === 'thinking' && !!msg.thinking
  if (msg.role === 'user') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
        <div style={{
          fontFamily: 'var(--font-serif)', fontSize: 13,
          color: 'var(--ink-mid)', lineHeight: 1.7,
          maxWidth: '80%', padding: '7px 12px',
          background: 'var(--surface)', border: '1px solid var(--ink-trace)',
          whiteSpace: 'pre-wrap', letterSpacing: 0.3,
        }}>
          {msg.content}
        </div>
        {msg.ctxLabels && msg.ctxLabels.length > 0 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {msg.ctxLabels.map(label => (
              <span key={label} style={{
                fontFamily: 'var(--font-serif)', fontSize: 9, letterSpacing: 1,
                color: 'var(--jade)', padding: '1px 6px',
                border: '1px solid rgba(74,125,94,0.3)',
              }}>
                ¶ {label}
              </span>
            ))}
          </div>
        )}
      </div>
    )
  }

  const streaming  = loading && isLast
  const steps      = msg.steps ?? []
  const hasSteps   = steps.length > 0
  const hasCards   = (msg.cards?.length ?? 0) > 0
  const hideText   = hasCards && !streaming
  const isSynthesizing = streaming && hasSteps && steps.every(s => s.done) && !msg.content
    && msg.strategy === 'parallel'
  const isWaitingReply = streaming && hasSteps && steps.every(s => s.done) && !msg.content
    && msg.strategy !== 'parallel'
  const stepsDim = hasSteps && !streaming && !!msg.content

  return (
    <div style={{ borderLeft: '1px solid var(--ink-trace)', paddingLeft: 12, marginLeft: 2 }}>

      {(msg.thinking || streamingThinking) && (
        <ThinkingBlock content={msg.thinking ?? ''} streaming={streamingThinking} />
      )}

      {hasSteps && (
        <div style={{
          marginBottom: msg.content ? 10 : 4,
          opacity: stepsDim ? 0.65 : 1,
          transition: 'opacity 0.4s',
        }}>
          {steps.map(step => (
            <div key={step.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 7, padding: '3px 0' }}>
              {step.done
                ? <span style={{ fontSize: 9, color: 'var(--jade)', flexShrink: 0, lineHeight: '18px' }}>✓</span>
                : <div style={{
                    width: 4, height: 4, borderRadius: '50%', flexShrink: 0, marginTop: 7,
                    border: '1px solid var(--gold-dim)', borderTopColor: 'transparent',
                    animation: 'spin 0.8s linear infinite',
                  }} />
              }
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: 1,
                  color: step.done ? 'var(--jade)' : 'var(--gold-dim)',
                }}>
                  {step.display}
                  {step.done && step.brief && (
                    <span style={{ color: 'var(--ink-dim)', marginLeft: 6, fontFamily: 'var(--font-serif)', letterSpacing: 0.3 }}>
                      {step.brief}
                    </span>
                  )}
                </span>
                {step.desc && (
                  <span style={{
                    fontFamily: 'var(--font-mono)', fontSize: 9,
                    color: 'var(--ink-dim)',
                    letterSpacing: 0.3, lineHeight: 1.5,
                  }}>
                    {step.desc}
                  </span>
                )}
                {step.links && step.links.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 2 }}>
                    {step.links.map((link, i) => (
                      <a key={i} href={link.url} target="_blank" rel="noopener noreferrer"
                        style={{
                          fontFamily: 'var(--font-serif)', fontSize: 10,
                          color: 'var(--jade)', letterSpacing: 0.3, lineHeight: 1.5,
                          textDecoration: 'none',
                          borderBottom: '1px solid rgba(74,125,94,0.25)',
                          display: 'block',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          maxWidth: '100%',
                        }}
                        title={link.url}
                      >
                        ↗ {link.title}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
          {isSynthesizing && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, paddingTop: 6, paddingLeft: 11 }}>
              {[0, 1, 2].map(i => (
                <div key={i} style={{
                  width: 3, height: 3, borderRadius: '50%', background: 'var(--gold-dim)',
                  animation: `spirit-dot 1.2s ease-in-out ${i * 0.2}s infinite`,
                }} />
              ))}
              <span style={{ fontFamily: 'var(--font-serif)', fontSize: 10, color: 'var(--gold-dim)', letterSpacing: 1, opacity: 0.7 }}>
                整合中
              </span>
            </div>
          )}
          {isWaitingReply && (
            <div style={{ display: 'flex', gap: 5, alignItems: 'center', paddingTop: 6, paddingLeft: 11 }}>
              {[0, 1, 2].map(i => (
                <div key={i} style={{
                  width: 3, height: 3, borderRadius: '50%', background: 'var(--gold-dim)',
                  animation: `spirit-dot 1.2s ease-in-out ${i * 0.2}s infinite`,
                }} />
              ))}
            </div>
          )}
        </div>
      )}

      {streaming && !hasSteps && !msg.content && (
        <div style={{ display: 'flex', gap: 5, alignItems: 'center', paddingBottom: 4 }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{
              width: 3, height: 3, borderRadius: '50%', background: 'var(--gold-dim)',
              animation: `spirit-dot 1.2s ease-in-out ${i * 0.2}s infinite`,
            }} />
          ))}
        </div>
      )}

      {msg.permissionRequest && !msg.permissionRequest.resolved && onPermission && (
        <PermissionView pr={msg.permissionRequest} onPermission={onPermission} />
      )}

      {!hideText && (
        <div className="spirit-md">
          {msg.content
            ? <ReactMarkdown>{msg.content}</ReactMarkdown>
            : (!streaming ? <span style={{ color: 'var(--ink-trace)' }}>…</span> : null)
          }
          {streaming && phase === 'replying' && (
            <span style={{ opacity: 0.4, animation: 'spirit-blink 1s infinite' }}>▌</span>
          )}
        </div>
      )}
      {hasCards && <LibraryCards entries={msg.cards!} />}
      {msg.skillCard  && <SkillCards cards={[msg.skillCard]} />}
      {msg.skillCards && <SkillCards cards={msg.skillCards} />}
    </div>
  )
})
