import 'dotenv/config'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('[migrate] DATABASE_URL is not set')
  process.exit(1)
}
const sql = postgres(url, { max: 1, onnotice: () => {} })
const db = drizzle(sql)
const LOCK_KEY = 728934123 // app-wide advisory lock: only one migrator runs at a time

async function main() {
  await sql`SELECT pg_advisory_lock(${LOCK_KEY})`
  try {
    await migrate(db, { migrationsFolder: './drizzle' })
    console.log('[migrate] done')
  } finally {
    await sql`SELECT pg_advisory_unlock(${LOCK_KEY})`
    await sql.end({ timeout: 5 })
  }
}
main().then(
  () => process.exit(0),
  (err) => {
    console.error('[migrate] FAILED:', err)
    process.exit(1)
  },
)
