'use client'

import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react'
import { useEffect, useState } from 'react'

export interface SiteRecord {
  id?: number
  slug: string
  sku: string
  name: string
  domain: string
  url: string
  key: string
  secret: string
  app_user: string
  app_pass: string
}

const EMPTY: SiteRecord = { slug: '', sku: '', name: '', domain: '', url: '', key: '', secret: '', app_user: '', app_pass: '' }

interface Props {
  open: boolean
  initial?: SiteRecord | null
  copyFrom?: SiteRecord | null
  onSave: (data: SiteRecord) => void
  onCancel: () => void
}

const fields: { key: keyof SiteRecord; label: string; type?: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'slug', label: 'Slug' },
  { key: 'sku', label: 'SKU' },
  { key: 'domain', label: 'Domain' },
  { key: 'url', label: 'URL' },
  { key: 'key', label: 'WC Key' },
  { key: 'secret', label: 'WC Secret', type: 'password' },
  { key: 'app_user', label: 'App User' },
  { key: 'app_pass', label: 'App Password', type: 'password' },
]

export function SiteModal({ open, initial, copyFrom, onSave, onCancel }: Props) {
  const [form, setForm] = useState<SiteRecord>(EMPTY)

  useEffect(() => {
    if (open) setForm(initial ?? copyFrom ?? EMPTY)
  }, [open, initial, copyFrom])

  const isEdit = !!initial?.id

  function set(key: keyof SiteRecord, value: string) {
    setForm(f => ({ ...f, [key]: value }))
  }

  return (
    <Dialog open={open} onClose={onCancel} className="relative z-50">
      <div className="fixed inset-0 bg-black/40" aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
          <DialogTitle className="text-base font-semibold text-slate-900 mb-4">
            {isEdit ? 'Edit Site' : 'Add Site'}
          </DialogTitle>

          <div className="grid grid-cols-2 gap-3">
            {fields.map(({ key, label, type }) => (
              <div key={key} className="col-span-2 sm:col-span-1">
                <label className="block text-xs font-medium text-slate-500 mb-1">{label}</label>
                <input
                  type={type ?? 'text'}
                  value={String(form[key] ?? '')}
                  onChange={e => set(key, e.target.value)}
                  readOnly={isEdit && key === 'slug'}
                  className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-slate-50 focus:outline-none focus:border-[#2387a6] focus:bg-white read-only:bg-slate-100 read-only:text-slate-400"
                />
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-2 mt-5">
            <button onClick={onCancel} className="px-4 py-2 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200">
              Cancel
            </button>
            <button onClick={() => onSave(form)} className="px-4 py-2 rounded-lg bg-[#692a77] text-white text-sm font-medium hover:bg-[#5a2368]">
              {isEdit ? 'Save' : 'Add Site'}
            </button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  )
}
