import { afterEach, describe, expect, it, vi } from 'vitest'

// H1: the health route must reflect DB reachability. Mock @/db so we can drive the probe's success,
// failure, and timeout branches without touching a real Postgres.
const execute = vi.fn()
vi.mock('@/db', () => ({ db: { execute: (...args: unknown[]) => execute(...args) } }))

// Imported after the mock is registered so the route binds to the mocked db.
const { GET } = await import('@/app/api/health/route')

afterEach(() => {
  execute.mockReset()
  vi.useRealTimers()
})

describe('GET /api/health', () => {
  it('returns 200 { ok: true } when the DB responds', async () => {
    execute.mockResolvedValueOnce([{ '?column?': 1 }])
    const res = await GET()
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ ok: true, db: 'up' })
  })

  it('returns 503 { ok: false } when the DB query rejects', async () => {
    execute.mockRejectedValueOnce(new Error('connection refused'))
    const res = await GET()
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ ok: false, db: 'down' })
  })

  it('returns 503 when the DB probe hangs past the timeout', async () => {
    vi.useFakeTimers()
    execute.mockReturnValueOnce(new Promise(() => {})) // never settles
    const pending = GET()
    await vi.advanceTimersByTimeAsync(3000)
    const res = await pending
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ ok: false })
  })
})
