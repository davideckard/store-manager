import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/apiAuth'

interface ProductItem {
  sku: string
  name: string
}

async function graphql(url: string, token: string, query: string, variables: Record<string, unknown>) {
  const res = await fetch(`${url}/api/graphql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ query, variables }),
  })
  if (!res.ok) throw new Error(`GraphQL request failed: ${res.status} ${res.statusText}`)
  const data = await res.json()
  if (data.errors) throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`)
  return data.data
}

export async function POST(req: NextRequest) {
  const deny = await requireAuth(req)
  if (deny) return deny

  const body = await req.json()
  const storeId: string = body.storeId
  const orderboardUrl: string = body.orderboardUrl || process.env.ORDERBOARD_API_URL || ''
  if (!storeId)
    return NextResponse.json({ error: 'storeId is required' }, { status: 400 })
  if (!orderboardUrl)
    return NextResponse.json({ error: 'orderboardUrl is required (or set ORDERBOARD_API_URL)' }, { status: 400 })

  const email = process.env.ORDERBOARD_EMAIL
  const password = process.env.ORDERBOARD_PASSWORD
  if (!email || !password)
    return NextResponse.json({ error: 'ORDERBOARD_EMAIL / ORDERBOARD_PASSWORD not configured' }, { status: 500 })

  try {
    const loginData = await graphql(orderboardUrl, '', `
      mutation Login($email: String!, $password: String!) {
        login(email: $email, password: $password) { token }
      }
    `, { email, password })
    const token: string = loginData.login.token

    const data = await graphql(orderboardUrl, token, `
      query GetProductList($storeId: ID!) {
        store(id: $storeId) { skuPrefix }
        designGroups(storeId: $storeId) { id name sku }
        designerProducts(storeId: $storeId) { id name sku }
        designGroupProductMappings(storeId: $storeId) { designGroupId designerProductId }
        products(storeId: $storeId) { id name productSku }
      }
    `, { storeId })

    const skuPrefix: string = data.store?.skuPrefix ?? ''
    const groupById: Record<string, { name: string; sku: string }> = {}
    for (const g of data.designGroups ?? []) groupById[g.id] = g
    const productById: Record<string, { name: string; sku: string }> = {}
    for (const p of data.designerProducts ?? []) productById[p.id] = p

    const products: ProductItem[] = []
    const designerSkus = new Set<string>()

    for (const mapping of data.designGroupProductMappings ?? []) {
      const group = groupById[mapping.designGroupId]
      const product = productById[mapping.designerProductId]
      if (!group || !product) continue
      const groupSkuPart = group.sku || group.name
      const sku = `${skuPrefix}-${groupSkuPart}-${product.sku}`
      designerSkus.add(sku.trim().toUpperCase())
      products.push({ sku, name: `${group.name} ${product.name}` })
    }

    for (const mp of data.products ?? []) {
      if (!mp.productSku) continue
      if (designerSkus.has(mp.productSku.trim().toUpperCase())) continue
      products.push({ sku: mp.productSku, name: mp.name || mp.productSku })
    }

    products.sort((a, b) => a.name.localeCompare(b.name))
    return NextResponse.json(products)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
