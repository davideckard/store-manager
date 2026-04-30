'use client'

import { useState, useEffect, useCallback } from 'react'
import { SiteModal, SiteRecord } from '@/components/modals/SiteModal'
import { ConfirmModal } from '@/components/modals/ConfirmModal'

type SortKey = 'name' | 'slug' | 'sku' | 'domain'

export function SitesTable() {
  const [sites, setSites] = useState<SiteRecord[]>([])
  const [filter, setFilter] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortAsc, setSortAsc] = useState(true)
  const [page, setPage] = useState(0)
  const [perPage, setPerPage] = useState(20)

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<SiteRecord | null>(null)
  const [copyFrom, setCopyFrom] = useState<SiteRecord | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<SiteRecord | null>(null)

  const load = useCallback(async () => {
    const res = await fetch('/api/sites')
    setSites(await res.json())
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = sites
    .filter(s => {
      if (!filter) return true
      const q = filter.toLowerCase()
      return s.name.toLowerCase().includes(q) || s.slug.toLowerCase().includes(q) || s.sku.toLowerCase().includes(q)
    })
    .sort((a, b) => {
      const av = a[sortKey] ?? ''
      const bv = b[sortKey] ?? ''
      return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av)
    })

  const paged = filtered.slice(page * perPage, page * perPage + perPage)
  const totalPages = Math.ceil(filtered.length / perPage)

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc(a => !a)
    else { setSortKey(key); setSortAsc(true) }
    setPage(0)
  }

  function SortTh({ col, label }: { col: SortKey; label: string }) {
    const active = sortKey === col
    return (
      <th
        onClick={() => toggleSort(col)}
        className="px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide cursor-pointer select-none hover:text-slate-700"
      >
        {label} {active ? (sortAsc ? '↑' : '↓') : ''}
      </th>
    )
  }

  async function save(data: SiteRecord) {
    if (data.id) {
      await fetch(`/api/sites/${data.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
    } else {
      await fetch('/api/sites', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
    }
    setModalOpen(false)
    setEditing(null)
    setCopyFrom(null)
    load()
  }

  async function deleteSite() {
    if (!deleteTarget?.id) return
    await fetch(`/api/sites/${deleteTarget.id}`, { method: 'DELETE' })
    setDeleteTarget(null)
    load()
  }

  return (
    <div className="bg-white rounded-xl shadow-sm">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
        <input
          placeholder="Search name, slug, SKU…"
          value={filter}
          onChange={e => { setFilter(e.target.value); setPage(0) }}
          className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm w-64 focus:outline-none focus:border-[#2387a6]"
        />
        <div className="flex items-center gap-2">
          <select
            value={perPage}
            onChange={e => { setPerPage(Number(e.target.value)); setPage(0) }}
            className="text-sm border border-slate-200 rounded-lg px-2 py-1.5"
          >
            {[10, 20, 50, 100].map(n => <option key={n} value={n}>{n} / page</option>)}
          </select>
          <button
            onClick={() => { setEditing(null); setCopyFrom(null); setModalOpen(true) }}
            className="px-3 py-1.5 bg-[#692a77] text-white text-sm font-medium rounded-lg hover:bg-[#5a2368]"
          >
            + Add Site
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100">
              <SortTh col="name" label="Name" />
              <SortTh col="slug" label="Slug" />
              <SortTh col="sku" label="SKU" />
              <SortTh col="domain" label="Domain" />
              <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">Actions</th>
            </tr>
          </thead>
          <tbody>
            {paged.length === 0 && (
              <tr><td colSpan={5} className="text-center py-10 text-slate-400 text-sm">No sites found.</td></tr>
            )}
            {paged.map(s => (
              <tr key={s.id} className="border-b border-slate-50 hover:bg-slate-50">
                <td className="px-3 py-2 font-medium">{s.name}</td>
                <td className="px-3 py-2 text-slate-500">{s.slug}</td>
                <td className="px-3 py-2 text-slate-500">{s.sku}</td>
                <td className="px-3 py-2 text-slate-500">{s.domain}</td>
                <td className="px-3 py-2">
                  <div className="flex justify-end gap-2">
                    <button onClick={() => { setCopyFrom(s); setEditing(null); setModalOpen(true) }} className="text-xs px-2 py-1 bg-slate-100 rounded hover:bg-slate-200">Copy</button>
                    <button onClick={() => { setEditing(s); setCopyFrom(null); setModalOpen(true) }} className="text-xs px-2 py-1 bg-slate-100 rounded hover:bg-slate-200">Edit</button>
                    <button onClick={() => setDeleteTarget(s)} className="text-xs px-2 py-1 bg-red-50 text-red-600 rounded hover:bg-red-100">Delete</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 text-sm text-slate-500">
          <span>{filtered.length} total</span>
          <div className="flex gap-1">
            <button disabled={page === 0} onClick={() => setPage(p => p - 1)} className="px-2 py-1 rounded disabled:opacity-30 hover:bg-slate-100">‹</button>
            <span className="px-2 py-1">{page + 1} / {totalPages}</span>
            <button disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)} className="px-2 py-1 rounded disabled:opacity-30 hover:bg-slate-100">›</button>
          </div>
        </div>
      )}

      <SiteModal open={modalOpen} initial={editing} copyFrom={copyFrom} onSave={save} onCancel={() => { setModalOpen(false); setEditing(null); setCopyFrom(null) }} />
      <ConfirmModal
        open={!!deleteTarget}
        title="Delete site"
        message={`Delete "${deleteTarget?.name}"? This cannot be undone.`}
        confirmLabel="Delete"
        danger
        onConfirm={deleteSite}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
