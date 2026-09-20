import { afterEach, describe, expect, it, vi } from 'vitest'

// H1: the health route must reflect DB reachability. It probes on its OWN single-use `postgres` client
// (isolated from the app pool) and force-closes it in `finally`, so we mock `postgres` to drive the
// probe's success / failure / timeout branches without touching a real Postgres. `end` is asserted so a
// regression that stops force-closing the hung connection (the CHANGES_REQUESTED finding) is caught.
const { query, end } = vi.hoisted(() => ({ query: vi.fn(), end: vi.fn() }))
vi.mock('postgres', () => {
  const sqlFn = (...args: unknown[]) => query(...args)
  ;(sqlFn as unknown as { end: typeof end }).end = end
  return { default: vi.fn(() => sqlFn) }
})

// Imported after the mock is registered so the route binds to the mocked driver.
const { GET } = await import('@/app/api/health/route')

afterEach(() => {
  query.mockReset()
  end.mockReset()
  vi.useRealTimers()
})

describe('GET /api/health', () => {
  it('returns 200 { ok: true } when the DB responds', async () => {
    query.mockResolvedValueOnce([{ '?column?': 1 }])
    end.mockResolvedValue(undefined)
    const res = await GET()
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ ok: true, db: 'up' })
    expect(end).toHaveBeenCalled() // connection always released
  })

  it('returns 503 { ok: false } when the DB query rejects', async () => {
    query.mockRejectedValueOnce(new Error('connection refused'))
    end.mockResolvedValue(undefined)
    const res = await GET()
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ ok: false, db: 'down' })
    expect(end).toHaveBeenCalled()
  })

  it('returns 503 AND force-closes the connection when the probe hangs past the timeout', async () => {
    vi.useFakeTimers()
    query.mockReturnValueOnce(new Promise(() => {})) // never settles
    end.mockResolvedValue(undefined)
    const pending = GET()
    await vi.advanceTimersByTimeAsync(3000)
    const res = await pending
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ ok: false })
    // The core of the fix: a hung probe must tear its connection down (end with timeout 0) rather than
    // leak it — Promise.race alone would abandon the query and strand the connection.
    expect(end).toHaveBeenCalledWith({ timeout: 0 })
  })
})
