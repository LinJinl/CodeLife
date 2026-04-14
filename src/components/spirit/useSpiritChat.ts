'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { usePathname } from 'next/navigation'
import type { SpiritEvent, LibraryCard } from '@/lib/spirit/protocol'
import type { Message, MCPInfo, SlashCommand } from './types'
import { SLASH_COMMANDS } from './types'

function todayStr() { return new Date().toISOString().slice(0, 10) }

export function useSpiritChat(open: boolean) {
  const pathname = usePathname()

  const [messages,   setMessages]   = useState<Message[]>([])
  const [input,      setInput]      = useState('')
  const [loading,    setLoading]    = useState(false)
  const [phase,      setPhase]      = useState<'idle'|'thinking'|'tooling'|'replying'>('idle')
  const [cmdMenu,    setCmdMenu]    = useState(false)
  const [cmdFilter,  setCmdFilter]  = useState('')
  const [cmdIdx,     setCmdIdx]     = useState(0)
  const [contexts,   setContexts]   = useState<{ text: string; path: string; label: string }[]>([])
  const [ctxLoading, setCtxLoading] = useState(false)
  const [activeTab,  setActiveTab]  = useState<'chat' | 'tools' | 'skills' | 'prefs'>('chat')
  const [mcpData,    setMcpData]    = useState<MCPInfo | null>(null)
  const [toolList,   setToolList]   = useState<{ name: string; displayName: string; description: string; category: string }[]>([])
  const [installPkg, setInstallPkg] = useState('')
  const [installing, setInstalling] = useState(false)

  const bottomRef   = useRef<HTMLDivElement>(null)
  const inputRef    = useRef<HTMLTextAreaElement>(null)
  const pendingCards = useRef<LibraryCard[]>([])

  // 加载今日会话
  useEffect(() => {
    if (!open) return
    fetch(`/api/spirit/session?date=${todayStr()}`)
      .then(r => r.json())
      .then((conv: { messages: Message[] }) => { if (conv.messages.length > 0) setMessages(conv.messages) })
      .catch(() => {})
  }, [open])

  // 流式输出时用 instant，避免 smooth scroll 被反复中断造成抖动
  // 流式结束后 loading 变 false，再 smooth 滚到底
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: loading ? 'instant' : 'smooth' })
  }, [messages, phase, loading])

  const saveSession = useCallback((msgs: Message[]) => {
    if (!msgs.length) return
    fetch('/api/spirit/session', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: msgs }),
    }).catch(() => {})
  }, [])

  const updateLastMsg = useCallback((updater: (msg: Message) => Message) => {
    setMessages(prev => {
      if (prev.length === 0) return prev
      const updated = [...prev]
      updated[updated.length - 1] = updater(updated[updated.length - 1])
      return updated
    })
  }, [])

  const handlePermission = useCallback((msgIdx: number, decision: 'once' | 'session' | 'deny', token: string) => {
    setMessages(prev => {
      if (!prev[msgIdx]) return prev
      const updated = [...prev]
      updated[msgIdx] = {
        ...updated[msgIdx],
        permissionRequest: { ...updated[msgIdx].permissionRequest!, resolved: true },
      }
      return updated
    })
    if (decision === 'deny') {
      send('取消，不要执行该命令')
      return
    }
    fetch('/api/spirit/approve', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ token, decision }),
    })
      .then(r => r.json())
      .then((data: { ok?: boolean }) => {
        if (data.ok) send('已确认，请继续执行')
        else         send('确认请求失败，请重试')
      })
      .catch(() => send('确认请求失败，请重试'))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function resolveContent(raw: string): string {
    const matched = SLASH_COMMANDS.find(c => c.cmd === raw.trim())
    return matched ? (matched.fill || matched.cmd) : raw
  }

  async function loadPageContext(path = pathname): Promise<{ text: string; path: string } | null> {
    if (ctxLoading) return null
    const existing = contexts.find(c => c.path === path)
    if (existing) return existing
    setCtxLoading(true)
    try {
      const res  = await fetch(`/api/spirit/context?path=${encodeURIComponent(path)}`)
      const data = await res.json() as { text: string; path: string }
      if (data.text) {
        const label = path === '/' ? '主页' : path.split('/').filter(Boolean).join(' › ')
        const ctx = { text: data.text, path, label }
        setContexts(prev => [...prev, ctx])
        return ctx
      }
    } catch { /* ignore */ }
    finally { setCtxLoading(false) }
    return null
  }

  async function doInstall() {
    const pkg = installPkg.trim()
    if (!pkg || installing) return
    setInstalling(true)
    try {
      const res  = await fetch('/api/spirit/mcp', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'install', package: pkg }),
      })
      const data = await res.json() as { ok?: boolean; error?: string; toolCount?: number }
      if (data.ok) {
        setInstallPkg('')
        setMcpData(null)
        await loadTools(true)
      } else {
        alert(`装载失败：${data.error}`)
      }
    } catch (err) {
      alert(`装载失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setInstalling(false)
    }
  }

  async function loadTools(force = false) {
    if (mcpData && !force) return
    try {
      const res  = await fetch('/api/spirit/mcp')
      const data = await res.json() as MCPInfo
      setMcpData(data)
      setToolList(data.tools ?? [])
    } catch { /* ignore */ }
  }

  async function send(text?: string) {
    let raw = (text ?? input).trim()
    if (!raw || loading) return

    let freshCtx: { text: string; path: string } | null = null
    if (raw.includes('/引此页')) {
      raw = raw.replace(/\/引此页\s*/g, '').trim()
      freshCtx = await loadPageContext()
      if (!raw) { return }
    }

    // /引法器 命令：动态安装 MCP 包
    const installMatch = raw.match(/^\/引法器\s+(.+)$/)
    if (installMatch) {
      const pkg = installMatch[1].trim()
      const userMsg: Message = { role: 'user', content: raw, timestamp: new Date().toISOString() }
      const loadingMsg: Message = { role: 'assistant', content: '', timestamp: new Date().toISOString() }
      setMessages(prev => [...prev, userMsg, loadingMsg])
      setInput(''); setCmdMenu(false); setLoading(true); setPhase('tooling')
      try {
        const res  = await fetch('/api/spirit/mcp', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'install', package: pkg }),
        })
        const data = await res.json() as { ok?: boolean; error?: string; message?: string; toolCount?: number }
        const reply = data.ok
          ? `已装载法器 **${pkg}**，共引入 ${data.toolCount} 个新工具。切换到「法器」Tab 查看。`
          : `装载失败：${data.error}`
        setMessages(prev => {
          const c = [...prev]
          c[c.length - 1] = { ...c[c.length - 1], content: reply }
          return c
        })
        if (data.ok) { setMcpData(null); loadTools(true) }
      } catch (err) {
        setMessages(prev => {
          const c = [...prev]
          c[c.length - 1] = { ...c[c.length - 1], content: `装载失败：${err instanceof Error ? err.message : String(err)}` }
          return c
        })
      } finally { setLoading(false); setPhase('idle') }
      return
    }

    const content = resolveContent(raw)

    const allContexts = freshCtx && !contexts.some(c => c.path === freshCtx!.path)
      ? [...contexts, freshCtx]
      : contexts

    const ctxLabels = allContexts.length > 0
      ? allContexts.map(c => c.path === '/' ? '主页' : c.path.split('/').filter(Boolean).join(' › '))
      : undefined

    const userMsg: Message = { role: 'user', content: raw, timestamp: new Date().toISOString(), ctxLabels }
    const history = [...messages, userMsg]
    setMessages([...history, { role: 'assistant', content: '', timestamp: new Date().toISOString() }])
    setInput('')
    setCmdMenu(false)
    setContexts([])
    setLoading(true)
    setPhase('thinking')
    pendingCards.current = []

    let stepSeq       = 0
    let curStrategy: string | null = null
    const pendingTools = new Map<string, string[]>()

    try {
      const ctxMessages = allContexts.map(c => ({
        role:    'system' as const,
        content: `[页面上下文 — ${c.path}]\n${c.text}`,
      }))

      const res = await fetch('/api/spirit/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: `[当前页面：${typeof window !== 'undefined' ? window.location.href : pathname}]` },
            ...ctxMessages,
            ...history.map((m, i) => ({
              role: m.role,
              content: i === history.length - 1 && m.role === 'user' ? content : m.content,
            })),
          ],
        }),
      })
      if (!res.ok || !res.body) throw new Error(await res.text())

      const reader = res.body.getReader()
      const dec    = new TextDecoder()
      let buf = '', final: Message[] = []

      outer: while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const lines = buf.split('\n'); buf = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          let ev: SpiritEvent
          try { ev = JSON.parse(line.slice(6)) as SpiritEvent } catch { continue }

          switch (ev.type) {
            case 'thinking':
              updateLastMsg(msg => ({ ...msg, thinking: (msg.thinking ?? '') + ev.chunk }))
              break
            case 'text':
              setPhase('replying')
              setMessages(prev => {
                const c    = [...prev]
                const last = c[c.length - 1]
                const cards = pendingCards.current.length > 0 && !last.cards
                  ? pendingCards.current : last.cards
                c[c.length - 1] = { ...last, content: last.content + ev.chunk, cards }
                final = c; return c
              })
              break
            case 'cards':
              pendingCards.current = [...pendingCards.current, ...ev.entries]
              break
            case 'skill_card':
              updateLastMsg(msg => ({ ...msg, skillCard: ev.card }))
              break
            case 'skill_cards':
              updateLastMsg(msg => ({ ...msg, skillCards: ev.entries }))
              break
            case 'strategy':
              curStrategy = ev.mode
              updateLastMsg(msg => ({
                ...msg,
                strategy: ev.mode,
                // direct 策略时移除 planner 占位 step，不在最终结果里显示
                steps: ev.mode === 'direct'
                  ? (msg.steps ?? []).filter(s => s.display !== '规划中')
                  : msg.steps,
              }))
              break
            case 'task_start':
              updateLastMsg(msg => ({
                ...msg,
                steps: [...(msg.steps ?? []), {
                  id: ev.taskId, type: 'task',
                  display: ev.display, desc: ev.desc, done: false,
                }],
              }))
              break
            case 'task_done':
              updateLastMsg(msg => ({
                ...msg,
                steps: (msg.steps ?? []).map(s =>
                  s.id === ev.taskId ? { ...s, done: true } : s
                ),
              }))
              break
            case 'tool_start':
              if (ev.name === '__init__' || ev.name === '__planner__') {
                // 虚拟工具：__init__ 只设 phase，不加 step；__planner__ 加 step
                setPhase('tooling')
                if (ev.name === '__planner__') {
                  const sid = `t${stepSeq++}`
                  if (!pendingTools.has(ev.name)) pendingTools.set(ev.name, [])
                  pendingTools.get(ev.name)!.push(sid)
                  updateLastMsg(msg => ({
                    ...msg,
                    steps: [...(msg.steps ?? []), {
                      id: sid, type: 'tool', display: ev.display,
                      desc: ev.desc, done: false,
                    }],
                  }))
                }
              } else if (curStrategy !== 'parallel') {
                setPhase('tooling')
                const sid = `t${stepSeq++}`
                if (!pendingTools.has(ev.name)) pendingTools.set(ev.name, [])
                pendingTools.get(ev.name)!.push(sid)
                updateLastMsg(msg => ({
                  ...msg,
                  steps: [...(msg.steps ?? []), {
                    id: sid, type: 'tool', display: ev.display,
                    desc: ev.desc, done: false,
                  }],
                }))
              }
              break
            case 'tool_done':
              if (ev.name === '__init__') {
                // 不做任何事，只是等待结束
              } else if (ev.name === '__planner__') {
                const ids = pendingTools.get(ev.name)
                const sid = ids?.shift()
                if (sid) {
                  updateLastMsg(msg => ({
                    ...msg,
                    steps: (msg.steps ?? []).map(s =>
                      s.id === sid ? { ...s, done: true, brief: ev.brief, links: ev.links } : s
                    ),
                  }))
                }
              } else if (curStrategy !== 'parallel') {
                const ids = pendingTools.get(ev.name)
                const sid = ids?.shift()
                if (sid) {
                  updateLastMsg(msg => ({
                    ...msg,
                    steps: (msg.steps ?? []).map(s =>
                      s.id === sid ? { ...s, done: true, brief: ev.brief, links: ev.links } : s
                    ),
                  }))
                }
              }
              break
            case 'agent_start':
              setPhase('tooling')
              break
            case 'agent_end':
              break
            case 'permission_request':
              updateLastMsg(msg => ({
                ...msg,
                permissionRequest: {
                  token:    ev.token,
                  command:  ev.command,
                  workdir:  ev.workdir,
                  level:    ev.level,
                  resolved: false,
                },
              }))
              break
            case 'error': throw new Error(ev.message)
            case 'done':  break outer
          }
        }
      }

      if (pendingCards.current.length > 0) {
        setMessages(prev => {
          const c = [...prev]
          if (!c[c.length - 1].cards) {
            c[c.length - 1] = { ...c[c.length - 1], cards: pendingCards.current }
          }
          final = c; return c
        })
      }
      saveSession(final.length > 0 ? final : history)
    } catch (err) {
      setMessages(prev => {
        const c = [...prev]
        c[c.length - 1] = { ...c[c.length - 1], content: `（器灵暂时沉默——${err instanceof Error ? err.message : '未知'}）` }
        saveSession(c); return c
      })
    } finally {
      setLoading(false); setPhase('idle')
    }
  }

  function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value
    const ta = e.target
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 120) + 'px'
    setInput(val)
    if (val.startsWith('/') && !val.includes(' ')) { setCmdMenu(true); setCmdFilter(val.slice(1).toLowerCase()); setCmdIdx(0) }
    else setCmdMenu(false)
  }

  const filteredCmds = SLASH_COMMANDS.filter(c => c.cmd.includes(cmdFilter) || c.desc.includes(cmdFilter))

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (cmdMenu) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setCmdIdx(prev => Math.min(prev + 1, filteredCmds.length - 1)); return }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setCmdIdx(prev => Math.max(prev - 1, 0)); return }
      if (e.key === 'Tab' || e.key === 'Enter') { e.preventDefault(); selectCmd(filteredCmds[cmdIdx]); return }
      if (e.key === 'Escape') { setCmdMenu(false); return }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!ctxLoading) send() }
  }

  function selectCmd(cmd?: SlashCommand) {
    if (!cmd) return
    setCmdMenu(false)
    if (cmd.cmd === '/引此页') {
      loadPageContext()
      setInput(prev => prev.replace(/^\/引此页\s*/, ''))
      setTimeout(() => inputRef.current?.focus(), 0)
      return
    }
    setInput(cmd.cmd)
    setTimeout(() => {
      const ta = inputRef.current; if (!ta) return
      ta.style.height = 'auto'
      ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length)
    }, 0)
  }

  return {
    messages, loading, phase,
    input, setInput,
    cmdMenu, cmdFilter, cmdIdx, setCmdIdx, filteredCmds,
    contexts, setContexts, ctxLoading,
    activeTab, setActiveTab,
    mcpData, toolList, installPkg, setInstallPkg, installing,
    send, handlePermission, handleInput, handleKeyDown, selectCmd,
    doInstall, loadTools,
    bottomRef, inputRef, pendingCards,
  }
}
