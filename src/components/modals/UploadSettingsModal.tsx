'use client'

import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react'

export interface UploadSettings {
  force: boolean
  squarePad: boolean
  randomizeImage: boolean
}

interface Props {
  open: boolean
  settings: UploadSettings
  onChange: (s: UploadSettings) => void
  onClose: () => void
}

export function UploadSettingsModal({ open, settings, onChange, onClose }: Props) {
  function set(patch: Partial<UploadSettings>) {
    onChange({ ...settings, ...patch })
  }

  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      <div className="fixed inset-0 bg-black/40" aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
          <DialogTitle className="text-base font-semibold text-slate-900 mb-4">Upload Settings</DialogTitle>

          <div className="space-y-4">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.force}
                onChange={e => set({ force: e.target.checked })}
                className="rounded mt-0.5"
              />
              <div>
                <p className="text-sm font-medium text-slate-700">Force delete &amp; re-create</p>
                <p className="text-xs text-slate-400 mt-0.5">Delete existing products before uploading instead of updating them in place.</p>
              </div>
            </label>

            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.squarePad}
                onChange={e => set({ squarePad: e.target.checked })}
                className="rounded mt-0.5"
              />
              <div>
                <p className="text-sm font-medium text-slate-700">Square Pad Images</p>
                <p className="text-xs text-slate-400 mt-0.5">
                  Center each image on a square canvas sized to its longest side before uploading.
                  e.g. an 800×1000 image becomes 1000×1000 with 100 px of transparent padding on each side.
                </p>
              </div>
            </label>

            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.randomizeImage}
                onChange={e => set({ randomizeImage: e.target.checked })}
                className="rounded mt-0.5"
              />
              <div>
                <p className="text-sm font-medium text-slate-700">Randomize Product Image</p>
                <p className="text-xs text-slate-400 mt-0.5">
                  Pick the product thumbnail from a random variation instead of always using the first.
                </p>
              </div>
            </label>
          </div>

          <div className="flex justify-end mt-6">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-[#692a77] text-white text-sm font-medium hover:bg-[#5a2368]"
            >
              Done
            </button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  )
}
