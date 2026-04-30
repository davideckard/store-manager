import Link from 'next/link'
import { auth, signOut } from '@/auth'
import NavLinks from './NavLinks'

export default async function Nav() {
  const session = await auth()

  return (
    <header className="bg-[#692a77] text-white shadow-md">
      <div className="flex items-center gap-6 px-5 py-3">
        <span className="font-semibold text-lg tracking-tight">Store Manager</span>
        <NavLinks />
        <div className="ml-auto flex items-center gap-3">
          {session?.user?.email && (
            <span className="text-sm text-white/60">{session.user.email}</span>
          )}
          <form
            action={async () => {
              'use server'
              await signOut({ redirectTo: '/login' })
            }}
          >
            <button
              type="submit"
              className="text-sm font-medium px-3 py-1.5 rounded hover:bg-white/10 transition-colors"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  )
}
