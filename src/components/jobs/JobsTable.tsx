'use client'

import { useState } from 'react'
import { Job } from './types'
import { StatusBadge, ModeBadge } from './JobBadge'
import { ConfirmModal } from '@/components/modals/ConfirmModal'

interface Props {
  jobs: Job[]
  selectedId: string | null
  onSelect: (id: string) => void
  onRefresh: () => void
}

function duration(start: string | null, end: string | null) {
  if (!start) return '—'
  const s = (new Date(end ?? Date.now()).getTime() - new Date(start).getTime()) / 1000
  if (s < 60) return `${Math.round(s)}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}

function fmt(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString()
}

export function JobsTable({ jobs, selectedId, onSelect, onRefresh }: Props) {
  const [confirmJob, setConfirmJob] = useState<Job | null>(null)
  const [confirmType, setConfirmType] = useState<'remove' | 'cancel' | 'fix'>('remove')

  function ask(job: Job, type: typeof confirmType) {
    setConfirmJob(job)
    setConfirmType(type)
  }

  async function handleConfirm() {
    if (!confirmJob) return
    if (confirmType === 'remove' || confirmType === 'cancel') {
      await fetch(`/api/jobs/${confirmJob.id}`, { method: 'DELETE' })
    } else if (confirmType === 'fix') {
      await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId: confirmJob.siteId, mode: 'fix', fromAuditJob: confirmJob.id }),
      })
    }
    setConfirmJob(null)
    onRefresh()
  }

  async function replay(job: Job) {
    const params = JSON.parse(job.params)
    await fetch('/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteId: params.siteId, mode: params.mode, storeId: params.storeId ?? '', force: params.force ?? false, fromAuditJob: params.fromAuditJob ?? '' }),
    })
    onRefresh()
  }

  const confirmConfig = {
    remove: { title: 'Remove job', message: 'Remove this job from the list? This cannot be undone.', label: 'Remove', danger: true },
    cancel: { title: 'Cancel job', message: 'Are you sure you want to cancel this running job?', label: 'Cancel job', danger: true },
    fix:    { title: 'Fix issues', message: 'Start a fix job using this audit report? It will delete and re-upload all incomplete products.', label: 'Start Fix', danger: false },
  }[confirmType]

  return (
    <>
      <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100">
              {['Started', 'Site', 'Mode', 'Status', 'Duration', 'Actions'].map(h => (
                <th key={h} className={`px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide ${h === 'Actions' ? 'text-right' : 'text-left'}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {jobs.length === 0 && (
              <tr><td colSpan={6} className="text-center py-12 text-slate-400 text-sm">No jobs yet.</td></tr>
            )}
            {jobs.map(j => {
              const running = j.status === 'running' || j.status === 'pending'
              return (
                <tr
                  key={j.id}
                  onClick={() => onSelect(j.id)}
                  className={`border-b border-slate-50 cursor-pointer transition-colors ${j.id === selectedId ? 'bg-[#f3eaf5]' : 'hover:bg-slate-50'}`}
                >
                  <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">{fmt(j.startedAt ?? j.createdAt)}</td>
                  <td className="px-3 py-2.5 font-medium">{j.siteId}</td>
                  <td className="px-3 py-2.5"><ModeBadge mode={j.mode} /></td>
                  <td className="px-3 py-2.5"><StatusBadge status={j.status} /></td>
                  <td className="px-3 py-2.5 text-slate-500">{duration(j.startedAt, j.finishedAt)}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex justify-end items-center gap-1" onClick={e => e.stopPropagation()}>
                      {j.hasReport && (
                        <button onClick={() => onSelect(j.id)} className="text-xs px-2 py-1 bg-slate-100 rounded hover:bg-slate-200">Report</button>
                      )}
                      {j.mode === 'audit' && j.status === 'complete' && j.hasIssues && (
                        <button onClick={() => ask(j, 'fix')} className="text-xs px-2 py-1 bg-amber-100 text-amber-800 rounded hover:bg-amber-200 font-medium">Fix Issues</button>
                      )}
                      <a href={`/api/jobs/${j.id}/log?download=1`} className="text-xs px-2 py-1 bg-slate-100 rounded hover:bg-slate-200" onClick={e => e.stopPropagation()}>Log ↓</a>
                      {j.hasReport && (
                        <a href={`/api/jobs/${j.id}/report?download=1`} className="text-xs px-2 py-1 bg-slate-100 rounded hover:bg-slate-200" onClick={e => e.stopPropagation()}>Report ↓</a>
                      )}
                      {!running && (
                        <button onClick={() => replay(j)} title="Replay" className="text-[#2387a6] hover:bg-[#e8f4f8] px-1.5 py-1 rounded text-base leading-none">↻</button>
                      )}
                      {running
                        ? <button onClick={() => ask(j, 'cancel')} className="text-xs px-2 py-1 bg-red-600 text-white rounded hover:bg-red-700">Cancel</button>
                        : <button onClick={() => ask(j, 'remove')} title="Remove" className="text-red-500 hover:bg-red-50 px-1.5 py-1 rounded text-base leading-none">✕</button>
                      }
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <ConfirmModal
        open={!!confirmJob}
        title={confirmConfig.title}
        message={confirmConfig.message}
        confirmLabel={confirmConfig.label}
        danger={confirmConfig.danger}
        onConfirm={handleConfirm}
        onCancel={() => setConfirmJob(null)}
      />
    </>
  )
}
