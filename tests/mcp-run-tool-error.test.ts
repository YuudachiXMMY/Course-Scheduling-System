import { describe, expect, it, vi } from 'vitest'
import { runTool } from '@/mcp/register-tools'
import { AuthError } from '@/auth/context'
import { BusinessError } from '@/lib/errors'

// CWE-209: the MCP tool error wrapper must not echo raw internal errors (a Drizzle/Postgres message
// leaks table/column/constraint names) to the connected model. Known, safe errors keep their curated
// messages; anything else is logged server-side and returned as a single generic line.
type ToolResult = Awaited<ReturnType<typeof runTool>>
const text = (r: ToolResult) => r.content[0]?.text ?? ''
const isError = (r: ToolResult) => 'isError' in r && r.isError === true

describe('runTool error mapping', () => {
  it('redacts a raw database error (SQLSTATE code + routine) and never leaks schema names', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    // Shaped like a `postgres` driver error: instanceof Error, plus a SQLSTATE code and routine.
    const dbError = Object.assign(
      new Error('duplicate key value violates unique constraint "student_pkey"'),
      { code: '23505', routine: '_bt_check_unique', severity: 'ERROR' },
    )
    const res = await runTool(async () => {
      throw dbError
    })
    expect(isError(res)).toBe(true)
    expect(text(res)).toBe('操作失败，请稍后再试')
    expect(text(res)).not.toContain('student_pkey')
    expect(text(res)).not.toContain('constraint')
    spy.mockRestore()
  })

  it('redacts the REAL runtime shape: a DrizzleQueryError (query+params) wrapping a pg error on .cause', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    // drizzle-orm wraps every query error like this: message embeds the full SQL + params, and the raw
    // driver error (the only object carrying code/routine) is on .cause — NOT the top-level object.
    const drizzleError = Object.assign(
      new Error(
        'Failed query: insert into "lesson" ("tenant_id","section_id","start_at") values ($1,$2,$3)\nparams: org_x,sec_y,2026-01-01',
      ),
      {
        query: 'insert into "lesson" ("tenant_id","section_id","start_at") values ($1,$2,$3)',
        params: ['org_x', 'sec_y', '2026-01-01'],
        cause: Object.assign(
          new Error('null value in column "start_at" violates not-null constraint'),
          {
            code: '23502',
            routine: 'ExecConstraints',
          },
        ),
      },
    )
    const res = await runTool(async () => {
      throw drizzleError
    })
    expect(isError(res)).toBe(true)
    expect(text(res)).toBe('操作失败，请稍后再试')
    expect(text(res)).not.toContain('lesson')
    expect(text(res)).not.toContain('tenant_id')
    expect(text(res)).not.toContain('params')
    spy.mockRestore()
  })

  it('passes an intentional BusinessError message through (e.g. 班级不存在)', async () => {
    const res = await runTool(async () => {
      throw new BusinessError('班级不存在')
    })
    expect(isError(res)).toBe(true)
    expect(text(res)).toBe('班级不存在')
  })

  it('redacts a plain non-curated Error (a bug) — its raw message must NOT leak to the model', async () => {
    // L-cwe209 narrowing: only a BusinessError is surfaced. A stray `new Error(...)` / TypeError from an
    // unexpected code path is an INTERNAL fault whose message could reveal internals, so it collapses to
    // the generic line and is logged server-side — closing the old `fail(e.message)` catch-all.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await runTool(async () => {
      throw new TypeError("Cannot read properties of null (reading 'foo')")
    })
    expect(isError(res)).toBe(true)
    expect(text(res)).toBe('操作失败，请稍后再试')
    expect(text(res)).not.toContain('null')
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('keeps the curated message for a known AuthError', async () => {
    const res = await runTool(async () => {
      throw new AuthError('FORBIDDEN')
    })
    expect(isError(res)).toBe(true)
    expect(text(res)).toBe('无权限执行该操作')
  })

  it('passes a successful result through unchanged', async () => {
    const res = await runTool(async () => ({ content: [{ type: 'text' as const, text: 'ok' }] }))
    expect(isError(res)).toBe(false)
    expect(text(res)).toBe('ok')
  })
})
