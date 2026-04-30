import { NextResponse } from 'next/server'

const GQL_URL = (process.env.ORDERBOARD_API_URL ?? 'https://orderboard.mlswebstores.com') + '/api/graphql'

export async function GET() {
  const email = process.env.ORDERBOARD_EMAIL ?? ''
  const password = process.env.ORDERBOARD_PASSWORD ?? ''

  if (!email || !password) {
    return NextResponse.json(
      { error: 'ORDERBOARD_EMAIL and ORDERBOARD_PASSWORD must be set' },
      { status: 400 },
    )
  }

  try {
    const loginRes = await fetch(GQL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'mutation Login($e:String!,$p:String!){login(email:$e,password:$p){token}}',
        variables: { e: email, p: password },
      }),
    })
    const { data: loginData } = await loginRes.json()
    const token: string = loginData.login.token

    const storesRes = await fetch(GQL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ query: '{ stores { id name } }' }),
    })
    const { data } = await storesRes.json()
    const stores = [...data.stores].sort((a: { name: string }, b: { name: string }) =>
      a.name.localeCompare(b.name),
    )
    return NextResponse.json(stores)
  } catch (err) {
    return NextResponse.json({ error: `Could not fetch stores: ${err}` }, { status: 502 })
  }
}
