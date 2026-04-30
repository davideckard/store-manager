'use client'

import { useEffect, useRef, useState } from 'react'
import { Job } from './types'
import { JobArgsModal } from '@/components/modals/JobArgsModal'

interface Props {
  job: Job
  onClose: () => void
}

function fmt(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString()
}

function duration(start: string | null, end: string | null) {
  if (!start) return '—'
  const s = (new Date(end ?? Date.now()).getTime() - new Date(start).getTime()) / 1000
  if (s < 60) return `${Math.round(s)}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}

export function JobDetail({ job, onClose }: Props) {
  const [tab, setTab] = useState<'log' | 'report'>('log')
  const [argsOpen, setArgsOpen] = useState(false)
  const [content, setContent] = useState('Loading…')
  const preRef = useRef<HTMLPreElement>(null)
  const userScrolledUp = useRef(false)
  const running = job.status === 'running' || job.status === 'pending'

  useEffect(() => {
    setContent('Loading…')
    setTab('log')
    userScrolledUp.current = false
  }, [job.id])

  useEffect(() => {
    let cancelled = false
    async function load() {
      const url = tab === 'report' ? `/api/jobs/${job.id}/report` : `/api/jobs/${job.id}/log`
      const res = await fetch(url)
      if (cancelled) return
      const text = res.ok ? await res.text() : '(not available)'
      setContent(text || '(empty)')
    }
    load()
    if (running) {
      const t = setInterval(load, 2000)
      return () => { cancelled = true; clearInterval(t) }
    }
    return () => { cancelled = true }
  }, [job.id, tab, running])

  useEffect(() => {
    if (!running || userScrolledUp.current) return
    if (preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight
  }, [content, running])

  function handleScroll() {
    if (!preRef.current) return
    const el = preRef.current
    userScrolledUp.current = el.scrollHeight - el.scrollTop > el.clientHeight + 40
  }

  return (
    <div className="bg-white rounded-xl shadow-sm p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-800">{job.siteId} — {job.mode} — {job.status}</h3>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg leading-none">✕</button>
      </div>

      <div className="flex flex-wrap gap-4 text-xs text-slate-500 mb-4">
        <span><strong className="text-slate-700">ID:</strong> {job.id.slice(0, 8)}…</span>
        <span><strong className="text-slate-700">Created:</strong> {fmt(job.createdAt)}</span>
        <span><strong className="text-slate-700">Started:</strong> {fmt(job.startedAt)}</span>
        <span><strong className="text-slate-700">Finished:</strong> {fmt(job.finishedAt)}</span>
        <span><strong className="text-slate-700">Duration:</strong> {duration(job.startedAt, job.finishedAt)}</span>
        <span><strong className="text-slate-700">Exit code:</strong> {job.exitCode ?? '—'}</span>
      </div>

      <div className="flex gap-2 mb-3">
        <button onClick={() => setTab('log')} className={`px-3 py-1 rounded text-xs font-medium ${tab === 'log' ? 'bg-[#692a77] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>Log</button>
        {job.hasReport && (
          <button onClick={() => setTab('report')} className={`px-3 py-1 rounded text-xs font-medium ${tab === 'report' ? 'bg-[#692a77] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>Report</button>
        )}
        <button onClick={() => setArgsOpen(true)} className="px-3 py-1 rounded text-xs font-medium bg-slate-100 text-slate-600 hover:bg-slate-200">Args</button>
      </div>

      <JobArgsModal open={argsOpen} params={JSON.parse(job.params)} onClose={() => setArgsOpen(false)} />

      <pre ref={preRef} onScroll={handleScroll} className="bg-slate-900 text-slate-200 text-xs leading-relaxed p-4 rounded-lg overflow-auto max-h-96 whitespace-pre-wrap break-words">
        {content}
      </pre>
    </div>
  )
}
