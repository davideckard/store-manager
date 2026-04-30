'use client'

import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react'

interface Props {
  open: boolean
  params: Record<string, unknown>
  onClose: () => void
}

function buildArgPreview(p: Record<string, unknown>): string[] {
  const args = ['python3', 'worker/upload.py', String(p.siteId ?? '')]
  if (p.storeId)       args.push('--store-id', String(p.storeId))
  if (p.orderboardUrl) args.push('--orderboard-url', String(p.orderboardUrl))
  if (p.mode === 'audit') args.push('--audit', '--audit-file', 'report.txt')
  if (p.mode === 'fix')   args.push('--fix',   '--fix-file',   'report.txt')
  if (p.force && p.mode === 'upload') args.push('--force')
  if (p.filterSkus && Array.isArray(p.filterSkus) && p.filterSkus.length > 0)
    args.push('--filter-skus', (p.filterSkus as string[]).join(','))
  if (p.fromAuditJob) args.push('--from-audit', `[report of job ${p.fromAuditJob}]`)
  return args
}

const LABELS: Record<string, string> = {
  siteId:        'Site ID',
  mode:          'Mode',
  storeId:       'Store ID',
  orderboardUrl: 'Orderboard URL',
  force:         'Force',
  fromAuditJob:  'From Audit Job',
  filterSkus:    'Filter SKUs',
}

export function JobArgsModal({ open, params, onClose }: Props) {
  const args = buildArgPreview(params)
  const rows = Object.entries(LABELS)
    .map(([key, label]) => ({ label, value: params[key] }))
    .filter(({ value }) => value !== undefined && value !== null && value !== '' && value !== false)

  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      <div className="fixed inset-0 bg-black/40" aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 max-h-[85vh] overflow-y-auto">
          <DialogTitle className="text-base font-semibold text-slate-900 mb-4">
            Job Arguments
          </DialogTitle>

          <p className="text-xs font-medium text-slate-500 mb-1">Command</p>
          <pre className="bg-slate-900 text-slate-200 text-xs rounded-lg p-3 mb-5 whitespace-pre-wrap break-all leading-relaxed">
            {args.join(' \\\n  ')}
          </pre>

          <p className="text-xs font-medium text-slate-500 mb-2">Parameters</p>
          <table className="w-full text-sm">
            <tbody>
              {rows.map(({ label, value }) => (
                <tr key={label} className="border-b border-slate-100 last:border-0">
                  <td className="py-1.5 pr-4 text-xs font-medium text-slate-500 whitespace-nowrap align-top">{label}</td>
                  <td className="py-1.5 text-slate-800 break-all">
                    {Array.isArray(value)
                      ? <span className="font-mono text-xs">{(value as string[]).join(', ')}</span>
                      : String(value)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="flex justify-end mt-5">
            <button onClick={onClose} className="px-4 py-2 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200">
              Close
            </button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  )
}
