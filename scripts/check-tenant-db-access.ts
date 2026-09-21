// H5 — tenant-isolation CI guard (transitional mitigation while Postgres RLS is deferred, see
// docs/adr/0001-tenant-isolation-rls.md). Tenant isolation currently rests on the discipline that every
// tenant-scoped read/write goes through `forTenant(ctx)` (src/db/tenant.ts). A stray `db.select().from(
// tenantTable)` / `db.insert(tenantTable)` anywhere else would silently cross tenants — the vitest
// tenant-isolation suite is a behavioural regression test and CANNOT catch a NEW bypass route that no
// test exercises. This guard closes that gap mechanically: it fails CI if any file OUTSIDE a small,
// audited allowlist reaches for the raw `db` handle's CRUD verbs.
//
// Scope: raw `db.{select,insert,update,delete}(` only — deliberately NOT `db.transaction` (the atomic-tx
// pattern that then scopes work via `forTenant(ctx, tx)` inside) and NOT `tx.*` (a tx handle passed into
// forTenant is fine). This mirrors the exact recon vector the production audit flagged (H5).
//
// Run: `npx tsx scripts/check-tenant-db-access.ts` (wired into .github/workflows/ci.yml). Exit 1 on any
// violation, 0 when clean. The pure matchers are exported for tests/tenant-db-guard.test.ts.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

// Files where raw `db` CRUD is legitimate and REVIEWED (audited against the production audit's H5 finding
// — none touch a tenant app table without either being an auth-owned table, a token-scoped public read,
// or an explicit-tenantId exception). Adding to this list is a conscious security decision, not a rubber
// stamp: state per entry WHY forTenant does not apply.
export const ALLOWLIST: readonly string[] = [
  // ── The forTenant spine itself — the ONE sanctioned place that builds tenant-scoped queries on `db`.
  'src/db/tenant.ts',

  // ── Auth-owned tables (member/user/session/account/organization): these are Better Auth tables, NOT
  // tenant app tables, so forTenant() does not apply. Each scopes by organizationId / user id directly.
  'src/auth/auth.ts',
  'src/auth/context.ts',
  'src/auth/mcp-context.ts',
  'src/auth/password.ts',
  'src/auth/provision.ts',
  'src/auth/staff.ts',
  'src/app/dashboard/courses/data.ts', // member↔user join (roster), scoped by organizationId
  'src/app/dashboard/courses/actions.ts', // one member lookup; ALL tenant tables here use forTenant
  'src/app/dashboard/users/data.ts', // member↔user join; portalLink/student go through forTenant
  'src/lib/report-consent.ts', // reads/writes organization.metadata (auth table) in a tx
  'src/app/api/cron/reminders/route.ts', // cross-tenant cron: iterates the organization table

  // ── Public token reads: resolve a capability token to its row WITHOUT an AuthContext, then read
  // STRICTLY scoped by that token-resolved tenant/section/student — never by a request param. forTenant
  // needs an AuthContext that does not exist on these public routes.
  'src/lib/share.ts',
  'src/lib/ical-feed.ts',
  'src/app/api/calendar/[token]/route.ts',
  'src/app/s/[token]/page.tsx',
  'src/app/sec/[token]/page.tsx',

  // ── Documented forTenant bulk-write exceptions: forTenant has no bulk/upsert helper, so these use raw
  // db writes that FORCE an explicit tenantId in every row + the conflict target, so the write can never
  // touch another tenant's row (see the comment at each call site).
  'src/lib/materialize.ts', // bulk lesson insert, onConflictDoNothing, tenantId: ctx.tenantId per row
  'src/lib/push-core.ts', // push_subscription upsert, tenantId: ctx.tenantId in values + conflict target
]

// Raw CRUD / raw-SQL on the `db` handle. `\s*` spans newlines so a chained `db\n  .insert(` (push-core's
// shape) is caught. `db.execute(` (raw SQL) is included; `db.transaction` is NOT (the atomic-tx pattern
// that scopes work via forTenant(ctx, tx) inside).
const RAW_DB_CALL = /\bdb\s*\.\s*(?:select|insert|update|delete|execute)\s*\(/
// Drizzle's relational query API (`db.query.<table>.findMany()`) is another tenant-table read path.
const RAW_DB_QUERY = /\bdb\s*\.\s*query\b/

// A `/` in code position starts a REGEX literal (not division) when the previous significant char is an
// operator/opener/`(`/`,`/`=`/etc., or it starts the input. Classic regex-vs-division disambiguation; the
// codebase's regexes all sit in value position (`.replace(/…/g, …)`, `= /…/`, `.test(/…/)`) so this
// covers them. Worst case (a regex right after a keyword like `return`, which ends in a letter → treated
// as division) is a false NEGATIVE (a missed strip), never a false positive that reddens CI wrongly.
const REGEX_PRECEDERS = new Set('([{,;:=!&|?+-*/%^~<>'.split(''))
const regexAllowed = (prev: string | undefined): boolean =>
  prev === undefined || REGEX_PRECEDERS.has(prev)

// Blank out comments, string/template literals AND regex literals so the matcher never trips on the
// pattern appearing inside one (e.g. the ADR note in tenant.ts, the doc comments in provision.ts /
// push-core.ts). Modelling regex literals is REQUIRED for correctness: a `"`/`'` inside a char class
// (e.g. `/[/\\:*?"<>|]/g`, used by the export routes) would otherwise flip a naive scanner into string
// mode and silently swallow real code until the next quote — blinding the guard mid-file.
// LIMITATION (documented, not silently assumed): this catches the literal identifier `db.` only. It does
// NOT follow aliasing (`import { db as x }`, `const y = db`) — those remain possible bypasses. This guard
// is a transitional mechanical backstop for the COMMON mistake (`db.select().from(tenantTable)`);
// Postgres RLS (ADR 0001) is the complete control.
export function stripCommentsAndStrings(src: string): string {
  let out = ''
  let mode: 'code' | 'line' | 'block' | 'sq' | 'dq' | 'tpl' | 'regex' = 'code'
  let prevSig: string | undefined // last significant (non-whitespace) char emitted in code mode
  let inClass = false // inside a regex [...] character class, where `/` does not terminate the literal
  for (let i = 0; i < src.length; ) {
    const c = src[i]
    const d = src[i + 1]
    if (mode === 'code') {
      if (c === '/' && d === '/') {
        mode = 'line'
        i += 2
        continue
      }
      if (c === '/' && d === '*') {
        mode = 'block'
        i += 2
        continue
      }
      if (c === '/' && regexAllowed(prevSig)) {
        mode = 'regex'
        inClass = false
        i += 1
        continue
      }
      if (c === "'") {
        mode = 'sq'
        i += 1
        continue
      }
      if (c === '"') {
        mode = 'dq'
        i += 1
        continue
      }
      if (c === '`') {
        mode = 'tpl'
        i += 1
        continue
      }
      out += c
      if (c.trim() !== '') prevSig = c
      i += 1
      continue
    }
    if (mode === 'line') {
      if (c === '\n') {
        mode = 'code'
        out += c
      }
      i += 1
      continue
    }
    if (mode === 'block') {
      if (c === '*' && d === '/') {
        mode = 'code'
        i += 2
        continue
      }
      // preserve newlines so line numbers in any future reporting stay roughly aligned
      if (c === '\n') out += c
      i += 1
      continue
    }
    if (mode === 'regex') {
      if (c === '\\') {
        i += 2 // escaped char (incl. \/) is part of the literal
        continue
      }
      if (c === '\n') {
        // a regex literal cannot span an unescaped newline — recover defensively
        mode = 'code'
        prevSig = undefined
        i += 1
        continue
      }
      if (c === '[') inClass = true
      else if (c === ']') inClass = false
      else if (c === '/' && !inClass) {
        mode = 'code'
        prevSig = 'x' // regex is a value; a following `/` is division (flags are plain code)
      }
      i += 1
      continue
    }
    // inside a string/template: honour escapes, then look for the matching terminator
    if (c === '\\') {
      i += 2
      continue
    }
    if (mode === 'sq' && c === "'") {
      mode = 'code'
      prevSig = 'x'
    } else if (mode === 'dq' && c === '"') {
      mode = 'code'
      prevSig = 'x'
    } else if (mode === 'tpl' && c === '`') {
      mode = 'code'
      prevSig = 'x'
    }
    i += 1
  }
  return out
}

// True iff `src` reaches for raw tenant-bypassing db access — `db.{select,insert,update,delete,execute}(`
// or the `db.query.*` relational API — outside comments/strings/regex.
export function hasRawTenantDbAccess(src: string): boolean {
  const stripped = stripCommentsAndStrings(src)
  return RAW_DB_CALL.test(stripped) || RAW_DB_QUERY.test(stripped)
}

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name)
    const st = statSync(abs)
    if (st.isDirectory()) {
      out.push(...walk(abs))
    } else if (/\.tsx?$/.test(name)) {
      out.push(abs)
    }
  }
  return out
}

// Scan `src/` under `root` and return the repo-relative (posix) paths that reach for raw `db` CRUD and are
// NOT allowlisted. Exported so the test can assert the current tree is clean (guard is green on main).
export function findViolations(root: string = process.cwd()): string[] {
  const allow = new Set<string>(ALLOWLIST)
  const srcRoot = join(root, 'src')
  if (!existsSync(srcRoot)) return []
  const violations: string[] = []
  for (const abs of walk(srcRoot)) {
    const rel = relative(root, abs).split(sep).join('/')
    if (allow.has(rel)) continue
    if (hasRawTenantDbAccess(readFileSync(abs, 'utf8'))) violations.push(rel)
  }
  return violations.sort()
}

function main(): void {
  const root = process.cwd()
  // Fail loudly if the allowlist rots (a listed file was moved/renamed) — a stale entry silently weakens
  // the guard by allowlisting nothing while looking intentional.
  const stale = ALLOWLIST.filter((f) => !existsSync(join(root, f)))
  if (stale.length > 0) {
    console.error('[check-tenant-db-access] ALLOWLIST entries no longer exist (update the list):')
    for (const f of stale) console.error(`  - ${f}`)
    process.exit(1)
  }
  const violations = findViolations(root)
  if (violations.length > 0) {
    console.error(
      '[check-tenant-db-access] raw `db.{select,insert,update,delete}(` found OUTSIDE the tenant-isolation allowlist:',
    )
    for (const f of violations) console.error(`  - ${f}`)
    console.error(
      '\nTenant-scoped reads/writes MUST go through `forTenant(ctx)` (src/db/tenant.ts) so tenant_id can never\n' +
        'be forgotten. If this access is genuinely tenant-safe (a non-tenant/auth table, or a reviewed\n' +
        'forTenant exception with an EXPLICIT tenantId), add the file to ALLOWLIST in this script WITH a\n' +
        'one-line justification. See docs/adr/0001-tenant-isolation-rls.md (H5).',
    )
    process.exit(1)
  }
  console.log('[check-tenant-db-access] OK — no raw tenant db access outside the allowlist')
  process.exit(0)
}

// Run only when executed directly (node/tsx), NOT when imported by the unit test.
const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) main()
