'use client'

import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react'
import { useState, useEffect } from 'react'

interface Product {
  sku: string
  name: string
}

interface Props {
  open: boolean
  products: Product[]
  loading: boolean
  onConfirm: (selectedSkus: string[]) => void
  onCancel: () => void
}

export function ProductPickerModal({ open, products, loading, onConfirm, onCancel }: Props) {
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (open) {
      setSearch('')
      setSelected(new Set())
    }
  }, [open])

  const filtered = products.filter(p => {
    if (!search) return true
    const q = search.toLowerCase()
    return p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)
  })

  const allFilteredSelected = filtered.length > 0 && filtered.every(p => selected.has(p.sku))

  function toggleAll() {
    if (allFilteredSelected) {
      setSelected(s => {
        const next = new Set(s)
        filtered.forEach(p => next.delete(p.sku))
        return next
      })
    } else {
      setSelected(s => {
        const next = new Set(s)
        filtered.forEach(p => next.add(p.sku))
        return next
      })
    }
  }

  function toggle(sku: string) {
    setSelected(s => {
      const next = new Set(s)
      next.has(sku) ? next.delete(sku) : next.add(sku)
      return next
    })
  }

  return (
    <Dialog open={open} onClose={onCancel} className="relative z-50">
      <div className="fixed inset-0 bg-black/40" aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="bg-white rounded-xl shadow-xl w-full max-w-xl flex flex-col max-h-[85vh]">
          <div className="p-5 border-b border-slate-100">
            <DialogTitle className="text-base font-semibold text-slate-900 mb-3">
              Select Products to Upload
            </DialogTitle>
            <input
              placeholder="Search by name or SKU…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-slate-50 focus:outline-none focus:border-[#2387a6]"
              autoFocus
            />
          </div>

          <div className="overflow-y-auto flex-1">
            {loading ? (
              <div className="flex items-center justify-center py-16 text-slate-400 text-sm">
                Fetching products…
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex items-center justify-center py-16 text-slate-400 text-sm">
                No products found.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white border-b border-slate-100">
                  <tr>
                    <th className="px-4 py-2 w-8">
                      <input
                        type="checkbox"
                        checked={allFilteredSelected}
                        onChange={toggleAll}
                        className="rounded"
                      />
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Name</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">SKU</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(p => (
                    <tr
                      key={p.sku}
                      onClick={() => toggle(p.sku)}
                      className="border-b border-slate-50 hover:bg-slate-50 cursor-pointer"
                    >
                      <td className="px-4 py-2">
                        <input
                          type="checkbox"
                          checked={selected.has(p.sku)}
                          onChange={() => toggle(p.sku)}
                          onClick={e => e.stopPropagation()}
                          className="rounded"
                        />
                      </td>
                      <td className="px-3 py-2 font-medium text-slate-800">{p.name}</td>
                      <td className="px-3 py-2 text-slate-400 font-mono text-xs">{p.sku}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="p-4 border-t border-slate-100 flex items-center justify-between">
            <span className="text-sm text-slate-500">
              {selected.size} of {products.length} selected
            </span>
            <div className="flex gap-2">
              <button
                onClick={onCancel}
                className="px-4 py-2 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200"
              >
                Cancel
              </button>
              <button
                onClick={() => onConfirm(Array.from(selected))}
                disabled={selected.size === 0}
                className="px-4 py-2 rounded-lg bg-[#692a77] text-white text-sm font-medium hover:bg-[#5a2368] disabled:opacity-50"
              >
                Upload {selected.size > 0 ? `${selected.size} Product${selected.size > 1 ? 's' : ''}` : 'Selected'}
              </button>
            </div>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  )
}
