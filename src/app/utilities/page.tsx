'use client'

import { useState, useEffect, useCallback } from 'react'
import { ConfirmModal } from '@/components/modals/ConfirmModal'
import { AddUserModal } from '@/components/modals/AddUserModal'
import { ResetPasswordModal } from '@/components/modals/ResetPasswordModal'

interface User {
  id: string
  email: string
  name: string | null
}

export default function UtilitiesPage() {
  const [users, setUsers] = useState<User[]>([])
  const [addOpen, setAddOpen] = useState(false)
  const [resetTarget, setResetTarget] = useState<User | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null)

  const load = useCallback(async () => {
    const res = await fetch('/api/users')
    if (res.ok) setUsers(await res.json())
  }, [])

  useEffect(() => { load() }, [load])

  async function addUser(email: string, password: string, name: string): Promise<string | null> {
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name }),
    })
    if (!res.ok) {
      try { return (await res.json()).error ?? 'Failed to create user' } catch { return 'Failed to create user' }
    }
    setAddOpen(false)
    load()
    return null
  }

  async function resetPassword(password: string): Promise<string | null> {
    if (!resetTarget) return null
    const res = await fetch(`/api/users/${resetTarget.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })
    if (!res.ok) {
      try { return (await res.json()).error ?? 'Failed to reset password' } catch { return 'Failed to reset password' }
    }
    setResetTarget(null)
    return null
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

      <div className="bg-white rounded-xl shadow-sm">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-800">Users</h2>
          <button
            onClick={() => setAddOpen(true)}
            className="w-7 h-7 flex items-center justify-center rounded-lg bg-[#692a77] text-white text-lg font-medium hover:bg-[#5a2368] leading-none"
            title="Add user"
          >
            +
          </button>
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
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => setResetTarget(u)}
                      className="text-xs px-2 py-1 bg-slate-100 text-slate-700 rounded hover:bg-slate-200"
                    >
                      Reset Password
                    </button>
                    <button
                      onClick={() => setDeleteTarget(u)}
                      className="text-xs px-2 py-1 bg-red-50 text-red-600 rounded hover:bg-red-100"
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <AddUserModal open={addOpen} onSave={addUser} onCancel={() => setAddOpen(false)} />

      <ResetPasswordModal
        open={!!resetTarget}
        userName={resetTarget?.email ?? null}
        onSave={resetPassword}
        onCancel={() => setResetTarget(null)}
      />

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
