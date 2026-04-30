import { Job } from './types'

const statusClasses: Record<Job['status'], string> = {
  pending:  'bg-slate-100 text-slate-500',
  running:  'bg-[#e8f4f8] text-[#2387a6] animate-pulse',
  complete: 'bg-green-100 text-green-700',
  failed:   'bg-red-100 text-red-700',
}

const modeClasses: Record<Job['mode'], string> = {
  upload: 'bg-yellow-100 text-yellow-800',
  audit:  'bg-sky-100 text-sky-800',
  fix:    'bg-pink-100 text-pink-800',
}

export function StatusBadge({ status }: { status: Job['status'] }) {
  return <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full uppercase tracking-wide ${statusClasses[status]}`}>{status}</span>
}

export function ModeBadge({ mode }: { mode: Job['mode'] }) {
  return <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded uppercase tracking-wide ${modeClasses[mode]}`}>{mode}</span>
}
