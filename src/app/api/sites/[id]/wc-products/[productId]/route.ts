import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/apiAuth'

async function wcFetch(
  site: { url: string; key: string; secret: string },
  path: string,
  method = 'GET',
  body?: object,
) {
  const credentials = Buffer.from(`${site.key}:${site.secret}`).toString('base64')
  const res = await fetch(`${site.url.replace(/\/$/, '')}/wp-json/wc/v3${path}`, {
    method,
    headers: {
      Authorization: `Basic ${credentials}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  if (!res.ok) throw new Error(`WooCommerce API error: ${res.status} ${res.statusText}`)
  return res.json()
}

async function getSite(id: string) {
  return prisma.mLS_Webstore.findUnique({ where: { id: Number(id) } })
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; productId: string }> },
) {
  const deny = await requireAuth(req)
  if (deny) return deny
  try {
    const { id, productId } = await params
    const site = await getSite(id)
    if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 })

    const url = new URL(req.url)
    const type = url.searchParams.get('type') ?? 'product'

    if (type === 'variations') {
      const data = await wcFetch(site, `/products/${productId}/variations?per_page=100`)
      return NextResponse.json(data)
    }

    const data = await wcFetch(site, `/products/${productId}`)
    return NextResponse.json(data)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 })
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; productId: string }> },
) {
  const deny = await requireAuth(req)
  if (deny) return deny
  try {
    const { id, productId } = await params
    const site = await getSite(id)
    if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 })

    const url = new URL(req.url)
    const variationId = url.searchParams.get('variationId')

    if (variationId) {
      const data = await wcFetch(
        site,
        `/products/${productId}/variations/${variationId}?force=true`,
        'DELETE',
      )
      return NextResponse.json(data)
    }

    const data = await wcFetch(site, `/products/${productId}?force=true`, 'DELETE')
    return NextResponse.json(data)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 })
  }
}
