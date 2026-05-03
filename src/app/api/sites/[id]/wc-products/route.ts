import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/apiAuth'

async function wcFetch(site: { url: string; key: string; secret: string }, path: string) {
  const credentials = Buffer.from(`${site.key}:${site.secret}`).toString('base64')
  const res = await fetch(`${site.url.replace(/\/$/, '')}/wp-json/wc/v3${path}`, {
    headers: { Authorization: `Basic ${credentials}` },
  })
  if (!res.ok) throw new Error(`WooCommerce API error: ${res.status} ${res.statusText}`)
  return res.json()
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const deny = await requireAuth(req)
  if (deny) return deny
  try {
    const { id } = await params
    const site = await prisma.mLS_Webstore.findUnique({ where: { id: Number(id) } })
    if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 })

    const url = new URL(req.url)
    const page = url.searchParams.get('page') ?? '1'
    const perPage = url.searchParams.get('per_page') ?? '50'
    const search = url.searchParams.get('search') ?? ''

    const query = new URLSearchParams({ page, per_page: perPage, ...(search ? { search } : {}) })
    const products = await wcFetch(site, `/products?${query}`)
    return NextResponse.json(products)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 })
  }
}
