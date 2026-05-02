'use client'

import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react'
import { useState, useEffect } from 'react'

interface Props {
  open: boolean
  userName: string | null
  onSave: (password: string) => Promise<string | null>
  onCancel: () => void
}

export function ResetPasswordModal({ open, userName, onSave, onCancel }: Props) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) { setPassword(''); setConfirm(''); setError('') }
  }, [open])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) { setError('Passwords do not match'); return }
    if (password.length < 6) { setError('Password must be at least 6 characters'); return }
    setError('')
    setSaving(true)
    const err = await onSave(password)
    setSaving(false)
    if (err) setError(err)
  }

  return (
    <Dialog open={open} onClose={onCancel} className="relative z-50">
      <div className="fixed inset-0 bg-black/40" aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
          <DialogTitle className="text-base font-semibold text-slate-900 mb-1">Reset Password</DialogTitle>
          {userName && <p className="text-sm text-slate-500 mb-4">{userName}</p>}
          <form onSubmit={submit} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">New Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoFocus
                className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-slate-50 focus:outline-none focus:border-[#2387a6]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Confirm Password</label>
              <input
                type="password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                required
                className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-slate-50 focus:outline-none focus:border-[#2387a6]"
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={onCancel} className="px-4 py-2 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200">
                Cancel
              </button>
              <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg bg-[#692a77] text-white text-sm font-medium hover:bg-[#5a2368] disabled:opacity-50">
                {saving ? 'Saving…' : 'Reset Password'}
              </button>
            </div>
          </form>
        </DialogPanel>
      </div>
    </Dialog>
  )
}
