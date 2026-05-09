import { NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/apiAuth'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

type Site = { url: string; key: string; secret: string; name: string }

async function wcFetch(site: Site, path: string) {
  const credentials = Buffer.from(`${site.key}:${site.secret}`).toString('base64')
  const res = await fetch(`${site.url.replace(/\/$/, '')}/wp-json/wc/v3${path}`, {
    headers: { Authorization: `Basic ${credentials}` },
  })
  if (!res.ok) throw new Error(`WooCommerce error ${res.status}: ${res.statusText}`)
  return res.json()
}

// Slim down WC responses so they don't burn tokens
function summarizeProduct(p: Record<string, unknown>) {
  return {
    id: p.id, name: p.name, sku: p.sku, status: p.status, type: p.type,
    price: p.price, regular_price: p.regular_price, stock_status: p.stock_status,
    categories: (p.categories as { name: string }[] | undefined)?.map(c => c.name),
    variations: (p.variations as number[] | undefined)?.length ?? 0,
    image: (p.images as { src: string }[] | undefined)?.[0]?.src,
  }
}

function summarizeOrder(o: Record<string, unknown>) {
  return {
    id: o.id, status: o.status, date_created: o.date_created,
    total: o.total, currency: o.currency,
    customer_id: o.customer_id,
    billing: o.billing,
    payment_method_title: o.payment_method_title,
    line_items: (o.line_items as { name: string; quantity: number; total: string }[] | undefined)
      ?.map(i => ({ name: i.name, qty: i.quantity, total: i.total })),
  }
}

function summarizeCustomer(c: Record<string, unknown>) {
  return {
    id: c.id, email: c.email,
    first_name: c.first_name, last_name: c.last_name,
    username: c.username,
    orders_count: c.orders_count, total_spent: c.total_spent,
    date_created: c.date_created,
    billing: c.billing,
  }
}

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'search_products',
    description: 'Search for products in the WooCommerce store by name, SKU, or keyword.',
    input_schema: {
      type: 'object' as const,
      properties: {
        search: { type: 'string', description: 'Search term' },
        status: { type: 'string', description: 'Filter by status: publish, draft, private (omit for all)' },
        per_page: { type: 'number', description: 'Results per page, max 50 (default 10)' },
        page: { type: 'number', description: 'Page number (default 1)' },
      },
      required: ['search'],
    },
  },
  {
    name: 'get_product',
    description: 'Get full details for a specific product by its WooCommerce ID.',
    input_schema: {
      type: 'object' as const,
      properties: {
        product_id: { type: 'number', description: 'WooCommerce product ID' },
      },
      required: ['product_id'],
    },
  },
  {
    name: 'list_orders',
    description: 'List orders from the store. Can filter by status, customer, or date range.',
    input_schema: {
      type: 'object' as const,
      properties: {
        status: { type: 'string', description: 'Order status: pending, processing, on-hold, completed, cancelled, refunded, failed (omit for all)' },
        customer: { type: 'number', description: 'Filter by customer ID' },
        search: { type: 'string', description: 'Search by order number or customer name' },
        after: { type: 'string', description: 'ISO 8601 date — only orders after this date' },
        before: { type: 'string', description: 'ISO 8601 date — only orders before this date' },
        per_page: { type: 'number', description: 'Results per page, max 50 (default 10)' },
        page: { type: 'number', description: 'Page number (default 1)' },
      },
    },
  },
  {
    name: 'get_order',
    description: 'Get full details for a specific order by its WooCommerce order ID.',
    input_schema: {
      type: 'object' as const,
      properties: {
        order_id: { type: 'number', description: 'WooCommerce order ID' },
      },
      required: ['order_id'],
    },
  },
  {
    name: 'list_customers',
    description: 'Search for customers by name, email, or username.',
    input_schema: {
      type: 'object' as const,
      properties: {
        search: { type: 'string', description: 'Search term (name, email, or username)' },
        per_page: { type: 'number', description: 'Results per page, max 50 (default 10)' },
        page: { type: 'number', description: 'Page number (default 1)' },
      },
      required: ['search'],
    },
  },
  {
    name: 'get_customer',
    description: 'Get details for a specific customer and their recent orders.',
    input_schema: {
      type: 'object' as const,
      properties: {
        customer_id: { type: 'number', description: 'WooCommerce customer ID' },
      },
      required: ['customer_id'],
    },
  },
]

async function runTool(name: string, input: Record<string, unknown>, site: Site): Promise<unknown> {
  switch (name) {
    case 'search_products': {
      const q = new URLSearchParams({
        search: String(input.search),
        per_page: String(Math.min(Number(input.per_page ?? 10), 50)),
        page: String(input.page ?? 1),
        ...(input.status ? { status: String(input.status) } : {}),
      })
      const data: Record<string, unknown>[] = await wcFetch(site, `/products?${q}`)
      return data.map(summarizeProduct)
    }

    case 'get_product': {
      const data: Record<string, unknown> = await wcFetch(site, `/products/${input.product_id}`)
      return summarizeProduct(data)
    }

    case 'list_orders': {
      const params: Record<string, string> = {
        per_page: String(Math.min(Number(input.per_page ?? 10), 50)),
        page: String(input.page ?? 1),
      }
      if (input.status) params.status = String(input.status)
      if (input.customer) params.customer = String(input.customer)
      if (input.search) params.search = String(input.search)
      if (input.after) params.after = String(input.after)
      if (input.before) params.before = String(input.before)
      const data: Record<string, unknown>[] = await wcFetch(site, `/orders?${new URLSearchParams(params)}`)
      return data.map(summarizeOrder)
    }

    case 'get_order': {
      const data: Record<string, unknown> = await wcFetch(site, `/orders/${input.order_id}`)
      return summarizeOrder(data)
    }

    case 'list_customers': {
      const q = new URLSearchParams({
        search: String(input.search),
        per_page: String(Math.min(Number(input.per_page ?? 10), 50)),
        page: String(input.page ?? 1),
      })
      const data: Record<string, unknown>[] = await wcFetch(site, `/customers?${q}`)
      return data.map(summarizeCustomer)
    }

    case 'get_customer': {
      const [customer, orders]: [Record<string, unknown>, Record<string, unknown>[]] = await Promise.all([
        wcFetch(site, `/customers/${input.customer_id}`),
        wcFetch(site, `/orders?customer=${input.customer_id}&per_page=5`),
      ])
      return { ...summarizeCustomer(customer), recent_orders: orders.map(summarizeOrder) }
    }

    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}

const TOOL_LABELS: Record<string, string> = {
  search_products: 'Searching products…',
  get_product: 'Fetching product details…',
  list_orders: 'Looking up orders…',
  get_order: 'Fetching order details…',
  list_customers: 'Searching customers…',
  get_customer: 'Fetching customer details…',
}

export async function POST(req: NextRequest) {
  const deny = await requireAuth(req)
  if (deny) return deny

  const { messages, siteId } = await req.json()

  const site = await prisma.mLS_Webstore.findUnique({ where: { id: Number(siteId) } })
  if (!site) return new Response(JSON.stringify({ error: 'Site not found' }), { status: 404 })

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: object) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`))

      try {
        const conversationMessages: Anthropic.MessageParam[] = messages.map(
          (m: { role: string; content: string }) => ({ role: m.role as 'user' | 'assistant', content: m.content }),
        )

        const system = `You are a helpful assistant for the "${site.name}" WooCommerce store. \
You help users look up products, orders, and customers. \
Be concise and friendly. When listing multiple items, use a short table or bullet list. \
Always use the available tools to fetch live data — never make up IDs or prices.`

        // Agentic loop — run until end_turn or 8 iterations max
        for (let iter = 0; iter < 8; iter++) {
          const apiStream = anthropic.messages.stream({
            model: 'claude-sonnet-4-6',
            max_tokens: 2048,
            system,
            tools: TOOLS,
            messages: conversationMessages,
          })

          // Stream text deltas as they arrive
          for await (const event of apiStream) {
            if (
              event.type === 'content_block_delta' &&
              event.delta.type === 'text_delta'
            ) {
              send({ type: 'text', content: event.delta.text })
            }
          }

          const final = await apiStream.finalMessage()

          if (final.stop_reason === 'end_turn') break

          if (final.stop_reason === 'tool_use') {
            conversationMessages.push({ role: 'assistant', content: final.content })

            const toolResults: Anthropic.ToolResultBlockParam[] = []
            for (const block of final.content) {
              if (block.type !== 'tool_use') continue
              send({ type: 'tool', label: TOOL_LABELS[block.name] ?? block.name })
              try {
                const result = await runTool(block.name, block.input as Record<string, unknown>, site)
                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: block.id,
                  content: JSON.stringify(result),
                })
              } catch (e) {
                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: block.id,
                  content: `Error: ${e}`,
                  is_error: true,
                })
              }
            }
            conversationMessages.push({ role: 'user', content: toolResults })
          }
        }

        send({ type: 'done' })
      } catch (e) {
        send({ type: 'error', message: String(e) })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
