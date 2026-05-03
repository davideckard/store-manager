'use client'

import { Dialog, DialogPanel } from '@headlessui/react'
import { useEffect, useState, useCallback } from 'react'
import { SiteRecord } from './SiteModal'
import { ConfirmModal } from './ConfirmModal'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface WCImage { id: number; src: string; alt: string }
interface WCAttribute { id: number; name: string; option: string }
interface WCCategory { id: number; name: string }
interface WCMeta { id: number; key: string; value: unknown }

interface WCProduct {
  id: number
  name: string
  sku: string
  status: string
  type: string
  price: string
  regular_price: string
  stock_status: string
  images: WCImage[]
  categories: WCCategory[]
  variations: number[]
  meta_data: WCMeta[]
}

interface WCVariation {
  id: number
  sku: string
  price: string
  regular_price: string
  stock_status: string
  attributes: WCAttribute[]
  image?: WCImage
  meta_data: WCMeta[]
}

type Selection =
  | { type: 'product'; product: WCProduct }
  | { type: 'variation'; product: WCProduct; variation: WCVariation }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function attrLabel(v: WCVariation) {
  return v.attributes.map(a => a.option).join(' / ') || `Variation #${v.id}`
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    publish: 'bg-green-100 text-green-700',
    draft: 'bg-slate-100 text-slate-500',
    private: 'bg-yellow-100 text-yellow-700',
    instock: 'bg-green-100 text-green-700',
    outofstock: 'bg-red-100 text-red-600',
  }
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${map[status] ?? 'bg-slate-100 text-slate-500'}`}>
      {status}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Settings form (inline, mirrors SiteModal fields)
// ---------------------------------------------------------------------------
const SITE_FIELDS: { key: keyof SiteRecord; label: string; type?: string }[] = [
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

// ---------------------------------------------------------------------------
// Detail panel (Page 2 within the modal)
// ---------------------------------------------------------------------------
function DetailPanel({
  selection,
  onBack,
}: {
  selection: Selection
  onBack: () => void
}) {
  const isVar = selection.type === 'variation'
  const item = isVar ? selection.variation : selection.product
  const image = isVar
    ? (selection.variation as WCVariation).image
    : (selection.product as WCProduct).images?.[0]

  function row(label: string, value: React.ReactNode) {
    return (
      <tr key={label} className="border-b border-slate-50">
        <td className="py-1.5 pr-4 text-xs font-medium text-slate-500 w-36 align-top">{label}</td>
        <td className="py-1.5 text-sm text-slate-800">{value}</td>
      </tr>
    )
  }

  const blankMeta = item.meta_data?.find(m => m.key === 'blank')?.value as Record<string, string> | undefined

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 mb-4">
        <button onClick={onBack} className="text-[#692a77] text-sm hover:underline">← Back</button>
        <span className="text-slate-400">/</span>
        <span className="text-sm font-medium text-slate-700">
          {isVar ? `${selection.product.name} — ${attrLabel(selection.variation)}` : (selection.product as WCProduct).name}
        </span>
      </div>

      <div className="flex gap-5 overflow-auto flex-1">
        {image && (
          <img src={image.src} alt={image.alt || ''} className="w-36 h-36 object-cover rounded-lg border border-slate-100 flex-shrink-0" />
        )}
        <div className="flex-1 overflow-auto">
          <table className="w-full">
            <tbody>
              {row('ID', `#${item.id}`)}
              {row('SKU', item.sku || '—')}
              {row('Price', item.price ? `$${item.price}` : '—')}
              {row('Stock', statusBadge((item as WCVariation).stock_status ?? 'unknown'))}
              {!isVar && row('Status', statusBadge((item as WCProduct).status))}
              {!isVar && row('Type', (item as WCProduct).type)}
              {!isVar && row('Variations', String((item as WCProduct).variations?.length ?? 0))}
              {!isVar && (item as WCProduct).categories?.length > 0 &&
                row('Categories', (item as WCProduct).categories.map(c => c.name).join(', '))}
              {isVar && (selection.variation as WCVariation).attributes?.length > 0 &&
                row('Attributes', (selection.variation as WCVariation).attributes.map(a => `${a.name}: ${a.option}`).join(', '))}
              {blankMeta && (
                <>
                  {blankMeta.brandName && row('Brand', blankMeta.brandName)}
                  {blankMeta.description && row('Style', blankMeta.description)}
                  {blankMeta.color && row('Color', blankMeta.color)}
                  {blankMeta.id && row('Style #', blankMeta.id)}
                  {blankMeta.size && row('Size', blankMeta.size)}
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Products page
// ---------------------------------------------------------------------------
function ProductsPage({
  siteId,
  onViewDetails,
}: {
  siteId: number
  onViewDetails: (sel: Selection) => void
}) {
  const [products, setProducts] = useState<WCProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [variations, setVariations] = useState<Record<number, WCVariation[]>>({})
  const [loadingVars, setLoadingVars] = useState<Set<number>>(new Set())
  const [selected, setSelected] = useState<Selection | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Selection | null>(null)
  const [deleting, setDeleting] = useState(false)

  const PER_PAGE = 50

  const load = useCallback(async (p: number, q: string) => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ page: String(p), per_page: String(PER_PAGE), ...(q ? { search: q } : {}) })
      const res = await fetch(`/api/sites/${siteId}/wc-products?${params}`)
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? res.statusText) }
      const data: WCProduct[] = await res.json()
      setProducts(prev => p === 1 ? data : [...prev, ...data])
      setHasMore(data.length === PER_PAGE)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [siteId])

  useEffect(() => { setPage(1); load(1, search) }, [search, load])

  async function toggleExpand(product: WCProduct) {
    const id = product.id
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
    if (!variations[id] && product.variations?.length > 0) {
      setLoadingVars(prev => new Set(prev).add(id))
      try {
        const res = await fetch(`/api/sites/${siteId}/wc-products/${id}?type=variations`)
        if (res.ok) {
          const data: WCVariation[] = await res.json()
          setVariations(prev => ({ ...prev, [id]: data }))
        }
      } finally {
        setLoadingVars(prev => { const n = new Set(prev); n.delete(id); return n })
      }
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const { type, product } = deleteTarget
      const url = type === 'variation'
        ? `/api/sites/${siteId}/wc-products/${product.id}?variationId=${(deleteTarget as Extract<Selection, { type: 'variation' }>).variation.id}`
        : `/api/sites/${siteId}/wc-products/${product.id}`
      const res = await fetch(url, { method: 'DELETE' })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? res.statusText) }

      if (type === 'product') {
        setProducts(prev => prev.filter(p => p.id !== product.id))
        setExpanded(prev => { const n = new Set(prev); n.delete(product.id); return n })
      } else {
        const varId = (deleteTarget as Extract<Selection, { type: 'variation' }>).variation.id
        setVariations(prev => ({
          ...prev,
          [product.id]: (prev[product.id] ?? []).filter(v => v.id !== varId),
        }))
      }
      if (selected && selected.type === type &&
        (type === 'product' ? selected.product.id === product.id : (selected as Extract<Selection, { type: 'variation' }>).variation.id === (deleteTarget as Extract<Selection, { type: 'variation' }>).variation.id)
      ) setSelected(null)
    } catch (e) {
      setError(String(e))
    } finally {
      setDeleting(false)
      setDeleteTarget(null)
    }
  }

  function selectProduct(p: WCProduct) {
    setSelected(prev =>
      prev?.type === 'product' && prev.product.id === p.id ? null : { type: 'product', product: p }
    )
  }

  function selectVariation(p: WCProduct, v: WCVariation) {
    setSelected(prev =>
      prev?.type === 'variation' && (prev as Extract<Selection, { type: 'variation' }>).variation.id === v.id
        ? null
        : { type: 'variation', product: p, variation: v }
    )
  }

  const isProductSelected = (id: number) => selected?.type === 'product' && selected.product.id === id
  const isVarSelected = (id: number) => selected?.type === 'variation' && (selected as Extract<Selection, { type: 'variation' }>).variation.id === id

  return (
    <div className="flex flex-col h-full">
      {/* Search */}
      <div className="flex items-center gap-2 mb-3">
        <input
          placeholder="Search products…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 px-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-[#2387a6]"
        />
        {selected && (
          <div className="flex gap-2">
            <button
              onClick={() => onViewDetails(selected)}
              className="px-3 py-1.5 text-sm font-medium bg-[#2387a6] text-white rounded-lg hover:bg-[#1d7491]"
            >
              View Details
            </button>
            <button
              onClick={() => setDeleteTarget(selected)}
              className="px-3 py-1.5 text-sm font-medium bg-red-50 text-red-600 rounded-lg hover:bg-red-100"
            >
              Delete
            </button>
          </div>
        )}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto border border-slate-100 rounded-lg">
        {loading && products.length === 0 && (
          <div className="text-center py-10 text-slate-400 text-sm">Loading products…</div>
        )}
        {error && (
          <div className="m-3 px-3 py-2 bg-red-50 text-red-600 text-sm rounded-lg">{error}</div>
        )}
        {!loading && !error && products.length === 0 && (
          <div className="text-center py-10 text-slate-400 text-sm">No products found.</div>
        )}

        {products.map(product => {
          const isExpanded = expanded.has(product.id)
          const isSelected = isProductSelected(product.id)
          const varList = variations[product.id] ?? []
          const loadingV = loadingVars.has(product.id)

          return (
            <div key={product.id} className="border-b border-slate-100 last:border-0">
              {/* Product row */}
              <div
                className={`flex items-center gap-2 px-3 py-2 cursor-pointer select-none ${isSelected ? 'bg-purple-50' : 'hover:bg-slate-50'}`}
                onClick={() => selectProduct(product)}
                onDoubleClick={() => onViewDetails({ type: 'product', product })}
              >
                {/* Expand toggle */}
                <button
                  onClick={e => { e.stopPropagation(); toggleExpand(product) }}
                  className="w-5 h-5 flex items-center justify-center text-slate-400 hover:text-slate-600 flex-shrink-0"
                  title={product.variations?.length ? `${product.variations.length} variations` : 'No variations'}
                >
                  {product.variations?.length > 0
                    ? (isExpanded ? '▾' : '▸')
                    : <span className="w-2 h-2 rounded-full bg-slate-200 inline-block" />}
                </button>

                {/* Thumbnail */}
                {product.images?.[0]
                  ? <img src={product.images[0].src} alt="" className="w-8 h-8 object-cover rounded flex-shrink-0" />
                  : <div className="w-8 h-8 bg-slate-100 rounded flex-shrink-0" />}

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">{product.name}</p>
                  <p className="text-xs text-slate-400">{product.sku}</p>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  {product.variations?.length > 0 && (
                    <span className="text-xs text-slate-400">{product.variations.length} vars</span>
                  )}
                  {statusBadge(product.status)}
                  {product.price && <span className="text-xs text-slate-600">${product.price}</span>}
                </div>
              </div>

              {/* Variations */}
              {isExpanded && (
                <div className="bg-slate-50 border-t border-slate-100">
                  {loadingV && (
                    <p className="text-xs text-slate-400 px-10 py-2">Loading variations…</p>
                  )}
                  {varList.map(v => {
                    const vSelected = isVarSelected(v.id)
                    return (
                      <div
                        key={v.id}
                        className={`flex items-center gap-2 pl-10 pr-3 py-1.5 cursor-pointer select-none border-b border-slate-100 last:border-0 ${vSelected ? 'bg-purple-50' : 'hover:bg-white'}`}
                        onClick={e => { e.stopPropagation(); selectVariation(product, v) }}
                        onDoubleClick={() => onViewDetails({ type: 'variation', product, variation: v })}
                      >
                        {v.image
                          ? <img src={v.image.src} alt="" className="w-6 h-6 object-cover rounded flex-shrink-0" />
                          : <div className="w-6 h-6 bg-slate-200 rounded flex-shrink-0" />}
                        <p className="flex-1 text-xs text-slate-700 truncate">{attrLabel(v)}</p>
                        <span className="text-xs text-slate-400">{v.sku}</span>
                        {v.price && <span className="text-xs text-slate-600">${v.price}</span>}
                        {statusBadge(v.stock_status)}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}

        {hasMore && !loading && (
          <button
            onClick={() => { const next = page + 1; setPage(next); load(next, search) }}
            className="w-full py-3 text-sm text-[#2387a6] hover:bg-slate-50"
          >
            Load more…
          </button>
        )}
        {loading && products.length > 0 && (
          <p className="text-center py-3 text-xs text-slate-400">Loading…</p>
        )}
      </div>

      <ConfirmModal
        open={!!deleteTarget}
        title={deleteTarget?.type === 'variation' ? 'Delete variation' : 'Delete product'}
        message={
          deleteTarget?.type === 'variation'
            ? `Delete variation "${attrLabel((deleteTarget as Extract<Selection, { type: 'variation' }>).variation)}" from "${deleteTarget.product.name}"? This cannot be undone.`
            : `Delete product "${deleteTarget?.product.name}"? All its variations will also be deleted. This cannot be undone.`
        }
        confirmLabel={deleting ? 'Deleting…' : 'Delete'}
        danger
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Settings page
// ---------------------------------------------------------------------------
function SettingsPage({
  site,
  onSave,
}: {
  site: SiteRecord
  onSave: (data: SiteRecord) => void
}) {
  const [form, setForm] = useState<SiteRecord>(site)

  function set(key: keyof SiteRecord, value: string) {
    setForm(f => ({ ...f, [key]: value }))
  }

  return (
    <div className="flex flex-col h-full">
      <div className="grid grid-cols-2 gap-3 overflow-y-auto flex-1">
        {SITE_FIELDS.map(({ key, label, type }) => (
          <div key={key} className="col-span-2 sm:col-span-1">
            <label className="block text-xs font-medium text-slate-500 mb-1">{label}</label>
            <input
              type={type ?? 'text'}
              value={String(form[key] ?? '')}
              onChange={e => set(key, e.target.value)}
              readOnly={key === 'slug'}
              className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-slate-50 focus:outline-none focus:border-[#2387a6] focus:bg-white read-only:bg-slate-100 read-only:text-slate-400"
            />
          </div>
        ))}
      </div>
      <div className="flex justify-end pt-4">
        <button
          onClick={() => onSave(form)}
          className="px-4 py-2 rounded-lg bg-[#692a77] text-white text-sm font-medium hover:bg-[#5a2368]"
        >
          Save Settings
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main StoreModal
// ---------------------------------------------------------------------------
interface StoreModalProps {
  open: boolean
  site: SiteRecord | null
  onSave: (data: SiteRecord) => void
  onClose: () => void
}

type Tab = 'products' | 'settings'
type View = 'list' | 'detail'

export function StoreModal({ open, site, onSave, onClose }: StoreModalProps) {
  const [tab, setTab] = useState<Tab>('products')
  const [view, setView] = useState<View>('list')
  const [detailSelection, setDetailSelection] = useState<Selection | null>(null)

  useEffect(() => {
    if (open) { setTab('products'); setView('list'); setDetailSelection(null) }
  }, [open])

  function handleViewDetails(sel: Selection) {
    setDetailSelection(sel)
    setView('detail')
  }

  if (!site) return null

  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      <div className="fixed inset-0 bg-black/40" aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="bg-white rounded-xl shadow-xl w-full max-w-3xl flex flex-col" style={{ height: '85vh' }}>
          {/* Header */}
          <div className="flex items-center justify-between px-6 pt-5 pb-0 flex-shrink-0">
            <h2 className="text-base font-semibold text-slate-900">{site.name}</h2>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg leading-none">×</button>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 px-6 mt-3 border-b border-slate-100 flex-shrink-0">
            {(['products', 'settings'] as Tab[]).map(t => (
              <button
                key={t}
                onClick={() => { setTab(t); setView('list') }}
                className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors capitalize ${
                  tab === t
                    ? 'border-[#692a77] text-[#692a77]'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          {/* Body */}
          <div className="flex-1 overflow-hidden px-6 py-4">
            {tab === 'products' && view === 'list' && (
              <ProductsPage siteId={site.id!} onViewDetails={handleViewDetails} />
            )}
            {tab === 'products' && view === 'detail' && detailSelection && (
              <DetailPanel selection={detailSelection} onBack={() => setView('list')} />
            )}
            {tab === 'settings' && (
              <SettingsPage site={site} onSave={onSave} />
            )}
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  )
}
