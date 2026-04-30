require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const { PrismaPg } = require('@prisma/adapter-pg')
const bcrypt = require('bcryptjs')

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

async function main() {
  const email = process.argv[2]
  const password = process.argv[3]
  const name = process.argv[4]

  if (!email || !password) {
    console.error('Usage: node scripts/create-user.cjs <email> <password> [name]')
    process.exit(1)
  }

  const hash = await bcrypt.hash(password, 12)

  const user = await prisma.user.create({
    data: { email, password: hash, name: name ?? null },
  })

  console.log(`Created user: ${user.email} (${user.id})`)
}

main().catch(console.error).finally(() => prisma.$disconnect())
