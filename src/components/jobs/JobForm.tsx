'use client'

import { useState, useEffect } from 'react'
import { Site, Store, Job } from './types'
import { ProductPickerModal } from '@/components/modals/ProductPickerModal'
import { UploadSettingsModal, UploadSettings } from '@/components/modals/UploadSettingsModal'

interface Props {
  onSubmitted: (id: string) => void
  auditJobs: Job[]
}

interface Product {
  sku: string
  name: string
}

const DEFAULT_SETTINGS: UploadSettings = { force: false, squarePad: true }

export function JobForm({ onSubmitted, auditJobs }: Props) {
  const [sites, setSites] = useState<Site[]>([])
  const [stores, setStores] = useState<Store[]>([])
  const [siteId, setSiteId] = useState('')
  const [mode, setMode] = useState<'upload' | 'audit' | 'fix'>('upload')
  const [storeId, setStoreId] = useState('')
  const [settings, setSettings] = useState<UploadSettings>(DEFAULT_SETTINGS)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [fromAuditJob, setFromAuditJob] = useState('')
  const [selectProducts, setSelectProducts] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerProducts, setPickerProducts] = useState<Product[]>([])
  const [pickerLoading, setPickerLoading] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    fetch('/api/sites').then(r => r.json()).then(data => {
      if (Array.isArray(data)) setSites(data)
    })
    fetch('/api/stores').then(r => r.json()).then(data => {
      if (Array.isArray(data)) setStores(data)
    })
  }, [])

  useEffect(() => {
    if (mode !== 'upload') setSelectProducts(false)
  }, [mode])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!siteId) { setError('Please select a site.'); return }

    if (selectProducts && mode === 'upload') {
      if (!storeId) { setError('Please select a store to use product selection.'); return }

      setSubmitting(true)
      setPickerLoading(true)
      setPickerProducts([])
      setPickerOpen(true)

      const res = await fetch('/api/jobs/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId }),
      })
      setSubmitting(false)
      setPickerLoading(false)

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setPickerOpen(false)
        setError(data.error ?? res.statusText)
        return
      }
      const products = await res.json()
      setPickerProducts(products)
      return
    }

    await doSubmit()
  }

  async function doSubmit(filterSkus?: string[]) {
    setSubmitting(true)
    const res = await fetch('/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        siteId, mode, storeId, fromAuditJob, filterSkus,
        force: settings.force,
        squarePad: settings.squarePad,
      }),
    })
    setSubmitting(false)

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? res.statusText)
      return
    }
    const { id } = await res.json()
    onSubmitted(id)
  }

  function handlePickerConfirm(selectedSkus: string[]) {
    setPickerOpen(false)
    doSubmit(selectedSkus)
  }

  const activeSettings = Object.values(settings).filter(Boolean).length

  return (
    <>
      <form onSubmit={submit} className="bg-white rounded-xl shadow-sm p-5">
        <h2 className="text-sm font-semibold text-slate-700 mb-4">Submit Job</h2>

        {error && <p className="mb-3 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

        <label className="block text-xs font-medium text-slate-500 mb-1">Site</label>
        <select value={siteId} onChange={e => setSiteId(e.target.value)} className="w-full mb-3 px-3 py-2 border border-slate-200 rounded-lg text-sm bg-slate-50 focus:outline-none focus:border-[#2387a6]">
          <option value="">— select a site —</option>
          {sites.map(s => <option key={s.id} value={s.slug}>{s.name} ({s.slug})</option>)}
        </select>

        <label className="block text-xs font-medium text-slate-500 mb-1">Mode</label>
        <select value={mode} onChange={e => setMode(e.target.value as typeof mode)} className="w-full mb-3 px-3 py-2 border border-slate-200 rounded-lg text-sm bg-slate-50 focus:outline-none focus:border-[#2387a6]">
          <option value="upload">Upload</option>
          <option value="audit">Audit</option>
          <option value="fix">Fix</option>
        </select>

        <label className="block text-xs font-medium text-slate-500 mb-1">Store (orderboard)</label>
        <select value={storeId} onChange={e => setStoreId(e.target.value)} className="w-full mb-3 px-3 py-2 border border-slate-200 rounded-lg text-sm bg-slate-50 focus:outline-none focus:border-[#2387a6]">
          <option value="">— select a store —</option>
          {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>

        {mode === 'upload' && storeId && (
          <label className="flex items-center gap-2 mb-3 text-sm text-slate-600 cursor-pointer">
            <input type="checkbox" checked={selectProducts} onChange={e => setSelectProducts(e.target.checked)} className="rounded" />
            Select individual products
          </label>
        )}

        {mode === 'fix' && auditJobs.length > 0 && (
          <>
            <label className="block text-xs font-medium text-slate-500 mb-1">Seed from audit job</label>
            <select value={fromAuditJob} onChange={e => setFromAuditJob(e.target.value)} className="w-full mb-3 px-3 py-2 border border-slate-200 rounded-lg text-sm bg-slate-50 focus:outline-none focus:border-[#2387a6]">
              <option value="">(none)</option>
              {auditJobs.map(j => (
                <option key={j.id} value={j.id}>{j.siteId} — {j.mode} — {new Date(j.createdAt).toLocaleString()}</option>
              ))}
            </select>
          </>
        )}

        <div className="flex gap-2 mt-1">
          <button type="submit" disabled={submitting} className="flex-1 py-2 bg-[#692a77] text-white text-sm font-medium rounded-lg hover:bg-[#5a2368] disabled:opacity-60">
            {submitting ? (selectProducts ? 'Fetching products…' : 'Submitting…') : (selectProducts ? 'Fetch & Select Products' : 'Submit Job')}
          </button>
          {mode === 'upload' && (
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
                activeSettings > 0
                  ? 'bg-[#f3eaf5] border-[#692a77] text-[#692a77]'
                  : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
              }`}
              title="Upload settings"
            >
              ⚙{activeSettings > 0 ? ` (${activeSettings})` : ''}
            </button>
          )}
        </div>
      </form>

      <UploadSettingsModal
        open={settingsOpen}
        settings={settings}
        onChange={setSettings}
        onClose={() => setSettingsOpen(false)}
      />

      <ProductPickerModal
        open={pickerOpen}
        products={pickerProducts}
        loading={pickerLoading}
        onConfirm={handlePickerConfirm}
        onCancel={() => setPickerOpen(false)}
      />
    </>
  )
}
