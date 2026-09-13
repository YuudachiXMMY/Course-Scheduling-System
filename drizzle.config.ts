import 'dotenv/config'
import { defineConfig } from 'drizzle-kit'

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set')

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts', // barrel already re-exports ../auth-schema (R8)
  out: './drizzle',
  casing: 'snake_case', // R7 — must match the drizzle() client
  dbCredentials: { url: process.env.DATABASE_URL },
  migrations: { table: '__drizzle_migrations', schema: 'drizzle' },
  strict: true,
  verbose: true,
})
