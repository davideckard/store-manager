import type { Metadata } from 'next'
import './globals.css'
import Nav from '@/components/Nav'
import { auth } from '@/auth'

export const metadata: Metadata = { title: 'Store Manager' }

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#f2f5f7] text-[#4e4e4e] flex flex-col antialiased font-sans">
        {session && <Nav />}
        <main className="flex-1 p-5">{children}</main>
      </body>
    </html>
  )
}
