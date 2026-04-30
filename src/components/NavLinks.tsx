'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const links = [
  { href: '/sites', label: 'WooCommerce Stores' },
  { href: '/jobs', label: 'Upload Store' },
  
]

export default function NavLinks() {
  const pathname = usePathname()
  return (
    <nav className="flex gap-1">
      {links.map(l => (
        <Link
          key={l.href}
          href={l.href}
          className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
            pathname.startsWith(l.href)
              ? 'bg-white/25'
              : 'hover:bg-white/10'
          }`}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  )
}
