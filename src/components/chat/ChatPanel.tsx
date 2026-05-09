'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface Site { id: number; name: string; slug: string }

interface Message {
  role: 'user' | 'assistant'
  content: string
  toolLabels?: string[]
}

function ToolIndicator({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-[#2387a6] bg-blue-50 px-2 py-0.5 rounded-full">
      <span className="w-1.5 h-1.5 rounded-full bg-[#2387a6] animate-pulse" />
      {label}
    </span>
  )
}

function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === 'user'
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
      <div className={`max-w-[80%] ${isUser ? 'order-2' : ''}`}>
        {msg.toolLabels && msg.toolLabels.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-1.5">
            {msg.toolLabels.map((l, i) => <ToolIndicator key={i} label={l} />)}
          </div>
        )}
        <div
          className={`px-4 py-2.5 rounded-2xl text-sm break-words leading-relaxed ${
            isUser
              ? 'bg-[#692a77] text-white rounded-br-sm'
              : 'bg-slate-100 text-slate-800 rounded-bl-sm'
          }`}
        >
          {msg.content ? (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                ul: ({ children }) => <ul className="list-disc pl-4 mb-2 space-y-0.5">{children}</ul>,
                ol: ({ children }) => <ol className="list-decimal pl-4 mb-2 space-y-0.5">{children}</ol>,
                li: ({ children }) => <li>{children}</li>,
                strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                code: ({ children, className }) =>
                  className ? (
                    <code className="block bg-black/10 rounded p-2 text-xs font-mono overflow-x-auto my-1">{children}</code>
                  ) : (
                    <code className="bg-black/10 rounded px-1 py-0.5 text-xs font-mono">{children}</code>
                  ),
                table: ({ children }) => (
                  <div className="overflow-x-auto my-2">
                    <table className="text-xs border-collapse w-full">{children}</table>
                  </div>
                ),
                th: ({ children }) => <th className="border border-black/20 px-2 py-1 font-semibold bg-black/10 text-left">{children}</th>,
                td: ({ children }) => <td className="border border-black/20 px-2 py-1">{children}</td>,
                a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer" className="underline opacity-80 hover:opacity-100">{children}</a>,
                h1: ({ children }) => <p className="font-bold text-base mb-1">{children}</p>,
                h2: ({ children }) => <p className="font-bold mb-1">{children}</p>,
                h3: ({ children }) => <p className="font-semibold mb-1">{children}</p>,
              }}
            >
              {msg.content}
            </ReactMarkdown>
          ) : (
            <span className="opacity-40 italic">Thinking…</span>
          )}
        </div>
      </div>
    </div>
  )
}

export function ChatPanel() {
  const [sites, setSites] = useState<Site[]>([])
  const [siteId, setSiteId] = useState<number | null>(() => {
    if (typeof window === 'undefined') return null
    const saved = localStorage.getItem('chat_site_id')
    return saved ? Number(saved) : null
  })
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    fetch('/api/sites').then(r => r.json()).then(data => {
      if (Array.isArray(data)) {
        setSites(data)
        if (data.length === 1) setSiteId(data[0].id)
      }
    })
  }, [])

  // Persist selected site
  useEffect(() => {
    if (siteId != null) localStorage.setItem('chat_site_id', String(siteId))
  }, [siteId])

  // Load messages when site changes
  useEffect(() => {
    if (!siteId) { setMessages([]); return }
    try {
      const saved = localStorage.getItem(`chat_messages_${siteId}`)
      setMessages(saved ? JSON.parse(saved) : [])
    } catch { setMessages([]) }
  }, [siteId])

  // Save messages after each completed response
  useEffect(() => {
    if (!siteId || streaming) return
    localStorage.setItem(`chat_messages_${siteId}`, JSON.stringify(messages))
  }, [messages, siteId, streaming])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const send = useCallback(async () => {
    const text = input.trim()
    if (!text || streaming || !siteId) return

    setInput('')
    setError('')

    const userMsg: Message = { role: 'user', content: text }
    const assistantMsg: Message = { role: 'assistant', content: '', toolLabels: [] }

    setMessages(prev => [...prev, userMsg, assistantMsg])
    setStreaming(true)

    const apiMessages = [
      ...messages.map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: text },
    ]

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: apiMessages, siteId }),
      })

      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error ?? res.statusText)
      }

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buf = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const evt = JSON.parse(line.slice(6))
            if (evt.type === 'text') {
              setMessages(prev => {
                const next = [...prev]
                const last = { ...next[next.length - 1] }
                last.content += evt.content
                next[next.length - 1] = last
                return next
              })
            } else if (evt.type === 'tool') {
              setMessages(prev => {
                const next = [...prev]
                const last = { ...next[next.length - 1] }
                last.toolLabels = [...(last.toolLabels ?? []), evt.label]
                next[next.length - 1] = last
                return next
              })
            } else if (evt.type === 'error') {
              setError(evt.message)
            }
          } catch { /* malformed event, skip */ }
        }
      }
    } catch (e) {
      setError(String(e))
      setMessages(prev => prev.slice(0, -1)) // remove empty assistant bubble
    } finally {
      setStreaming(false)
      inputRef.current?.focus()
    }
  }, [input, streaming, siteId, messages])

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  const selectedSite = sites.find(s => s.id === siteId)

  return (
    <div className="flex flex-col h-full bg-white rounded-xl shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 flex-shrink-0">
        <div className="flex-1">
          <h2 className="text-sm font-semibold text-slate-700">Store Assistant</h2>
          {selectedSite && (
            <p className="text-xs text-slate-400">{selectedSite.name}</p>
          )}
        </div>
        <select
          value={siteId ?? ''}
          onChange={e => { setSiteId(Number(e.target.value)); setError('') }}
          className="text-sm border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-[#2387a6] max-w-48"
        >
          <option value="">— select a store —</option>
          {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        {messages.length > 0 && (
          <button
            onClick={() => { setMessages([]); setError(''); if (siteId) localStorage.removeItem(`chat_messages_${siteId}`) }}
            className="text-xs text-slate-400 hover:text-slate-600 px-2 py-1 rounded hover:bg-slate-100"
            title="Clear conversation"
          >
            Clear
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {!siteId && (
          <div className="h-full flex items-center justify-center">
            <p className="text-slate-400 text-sm">Select a store to start chatting</p>
          </div>
        )}
        {siteId && messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center gap-4 text-center">
            <p className="text-slate-400 text-sm">Ask anything about products, orders, or customers.</p>
            <div className="flex flex-wrap gap-2 justify-center max-w-sm">
              {[
                'Show me all hoodies',
                'What orders are pending?',
                'Find customer Jane Smith',
                'What are my top products?',
              ].map(suggestion => (
                <button
                  key={suggestion}
                  onClick={() => { setInput(suggestion); inputRef.current?.focus() }}
                  className="text-xs px-3 py-1.5 rounded-full border border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((msg, i) => <MessageBubble key={i} msg={msg} />)}
        {error && (
          <div className="mx-auto max-w-sm mt-2 px-3 py-2 bg-red-50 text-red-600 text-xs rounded-lg text-center">
            {error}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="flex items-end gap-2 px-4 py-3 border-t border-slate-100 flex-shrink-0">
        <textarea
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={siteId ? 'Ask about products, orders, customers… (Enter to send)' : 'Select a store first'}
          disabled={!siteId || streaming}
          rows={1}
          className="flex-1 px-3 py-2 border border-slate-200 rounded-xl text-sm resize-none focus:outline-none focus:border-[#2387a6] disabled:bg-slate-50 disabled:text-slate-400"
          style={{ maxHeight: '120px', overflowY: 'auto' }}
        />
        <button
          onClick={send}
          disabled={!siteId || !input.trim() || streaming}
          className="px-4 py-2 bg-[#692a77] text-white text-sm font-medium rounded-xl hover:bg-[#5a2368] disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
        >
          {streaming ? '…' : 'Send'}
        </button>
      </div>
    </div>
  )
}
