'use client'

import { useState, useEffect, useCallback } from 'react'
import { ConfirmModal } from '@/components/modals/ConfirmModal'

interface User {
  id: string
  email: string
  name: string | null
}

export default function UtilitiesPage() {
  const [users, setUsers] = useState<User[]>([])
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null)

  const load = useCallback(async () => {
    const res = await fetch('/api/users')
    if (res.ok) setUsers(await res.json())
  }, [])

  useEffect(() => { load() }, [load])

  async function addUser(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSaving(true)
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name }),
    })
    setSaving(false)
    if (!res.ok) {
      const data = await res.json()
      setError(data.error ?? 'Failed to create user')
      return
    }
    setEmail('')
    setPassword('')
    setName('')
    load()
  }

  async function deleteUser() {
    if (!deleteTarget) return
    await fetch(`/api/users/${deleteTarget.id}`, { method: 'DELETE' })
    setDeleteTarget(null)
    load()
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h1 className="text-xl font-semibold text-slate-800">Utilities</h1>

      <div className="bg-white rounded-xl shadow-sm p-5">
        <h2 className="text-base font-semibold text-slate-800 mb-4">Add User</h2>
        <form onSubmit={addUser} className="grid grid-cols-2 gap-3">
          <div className="col-span-2 sm:col-span-1">
            <label className="block text-xs font-medium text-slate-500 mb-1">Name</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Optional"
              className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-slate-50 focus:outline-none focus:border-[#2387a6]"
            />
          </div>
          <div className="col-span-2 sm:col-span-1">
            <label className="block text-xs font-medium text-slate-500 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-slate-50 focus:outline-none focus:border-[#2387a6]"
            />
          </div>
          <div className="col-span-2 sm:col-span-1">
            <label className="block text-xs font-medium text-slate-500 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-slate-50 focus:outline-none focus:border-[#2387a6]"
            />
          </div>
          {error && <p className="col-span-2 text-sm text-red-600">{error}</p>}
          <div className="col-span-2 flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-[#692a77] text-white text-sm font-medium hover:bg-[#5a2368] disabled:opacity-50"
            >
              {saving ? 'Adding…' : 'Add User'}
            </button>
          </div>
        </form>
      </div>

      <div className="bg-white rounded-xl shadow-sm">
        <div className="px-4 py-3 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-800">Users</h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Name</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Email</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 && (
              <tr><td colSpan={3} className="text-center py-8 text-slate-400 text-sm">No users found.</td></tr>
            )}
            {users.map(u => (
              <tr key={u.id} className="border-b border-slate-50 hover:bg-slate-50">
                <td className="px-4 py-2 font-medium text-slate-800">{u.name ?? '—'}</td>
                <td className="px-4 py-2 text-slate-500">{u.email}</td>
                <td className="px-4 py-2 text-right">
                  <button
                    onClick={() => setDeleteTarget(u)}
                    className="text-xs px-2 py-1 bg-red-50 text-red-600 rounded hover:bg-red-100"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ConfirmModal
        open={!!deleteTarget}
        title="Delete user"
        message={`Delete "${deleteTarget?.email}"? They will no longer be able to log in.`}
        confirmLabel="Delete"
        danger
        onConfirm={deleteUser}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
