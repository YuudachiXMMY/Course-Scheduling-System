import 'server-only'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema' // barrel (re-exports ../auth-schema too, per R8)

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL is not set')

// Cache across Next HMR or every save leaks a new pool until Postgres refuses connections.
const g = globalThis as unknown as { __pgClient?: ReturnType<typeof postgres> }
const client =
  g.__pgClient ??
  postgres(connectionString, { max: 10, idle_timeout: 20, connect_timeout: 10, prepare: true })
if (process.env.NODE_ENV !== 'production') g.__pgClient = client

export const db = drizzle(client, {
  schema,
  casing: 'snake_case',
  logger: process.env.NODE_ENV !== 'production',
})
export { schema }
