import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'
import {
  findRoomOverlapPairs,
  resolveOverlapLosers,
  roomOverlapConstraintSettled,
  type RoomOverlapPair,
} from '../scripts/cleanup-room-overlaps'

// B2 (orch-review HIGH — test gap): cleanup-room-overlaps.ts is wired into the container entrypoint to run
// BEFORE migrate on every boot; it is the ONLY guard preventing the 0015 EXCLUDE-constraint migration from
// crash-looping an existing DB that holds room overlaps. Its sibling (cleanup-orphan-tenants.ts) is tested;
// this pins the equivalent properties here:
//  1. the overlap self-join finds true overlapping pairs and spares non-overlapping / null-location /
//     canceled / cross-tenant rows (exercised against a temp fixture, mirroring cleanup-orphan-tenants);
//  2. the later-lesson tie-break de-dupes and cancels the correct lesson (pure function);
//  3. the idempotent fast-path is a no-op once the 0015 constraint exists.
const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is not set (tests load it via dotenv/config)')

let sql: ReturnType<typeof postgres>
beforeAll(() => {
  sql = postgres(url, { max: 1, onnotice: () => {} })
})
afterAll(async () => {
  await sql.end({ timeout: 5 })
})

const iso = (h: number, m = 0) => new Date(Date.UTC(2026, 2, 10, h, m)).toISOString()

describe('findRoomOverlapPairs (the overlap self-join predicate)', () => {
  it('returns only genuinely overlapping same-tenant, same-location, non-canceled, non-null pairs', async () => {
    await sql.begin(async (tx) => {
      // Same shape as `lesson` for the columns the self-join touches; ON COMMIT DROP → auto-cleaned.
      await tx`
        CREATE TEMP TABLE _probe_lessons (
          id text, tenant_id text, location text,
          start_at timestamptz, end_at timestamptz, status text
        ) ON COMMIT DROP`
      await tx`
        INSERT INTO _probe_lessons (id, tenant_id, location, start_at, end_at, status) VALUES
          -- t1/roomA: l1 & l2 overlap → the ONE expected pair
          ('l1', 't1', 'roomA', ${iso(10)},    ${iso(11)},    'scheduled'),
          ('l2', 't1', 'roomA', ${iso(10, 30)}, ${iso(11, 30)}, 'scheduled'),
          -- l3 is adjacent to l2's end ([10:30,11:30) vs [11:30,12:30) — half-open, so NOT overlapping)
          ('l3', 't1', 'roomA', ${iso(11, 30)}, ${iso(12, 30)}, 'scheduled'),
          -- canceled overlapper is excluded even though it overlaps l1
          ('l4', 't1', 'roomA', ${iso(10, 15)}, ${iso(10, 45)}, 'canceled'),
          -- null location (no room assigned) is exempt
          ('l5', 't1', ${null}, ${iso(10)},    ${iso(11)},    'scheduled'),
          -- different room, overlapping time → not a pair
          ('l6', 't1', 'roomB', ${iso(10)},    ${iso(11)},    'scheduled'),
          -- different tenant, same room/time → never cross-tenant
          ('l7', 't2', 'roomA', ${iso(10)},    ${iso(11)},    'scheduled')`

      const pairs = await findRoomOverlapPairs(tx, '_probe_lessons')
      expect(pairs).toHaveLength(1)
      expect(pairs[0]!.a_id).toBe('l1')
      expect(pairs[0]!.b_id).toBe('l2')
      expect(pairs[0]!.tenant_id).toBe('t1')
      expect(pairs[0]!.location).toBe('roomA')
    })
  })

  it('finds zero pairs when nothing overlaps (idempotent shape)', async () => {
    await sql.begin(async (tx) => {
      await tx`
        CREATE TEMP TABLE _probe_lessons (
          id text, tenant_id text, location text,
          start_at timestamptz, end_at timestamptz, status text
        ) ON COMMIT DROP`
      await tx`
        INSERT INTO _probe_lessons (id, tenant_id, location, start_at, end_at, status) VALUES
          ('a', 't1', 'roomA', ${iso(9)},  ${iso(10)}, 'scheduled'),
          ('b', 't1', 'roomA', ${iso(10)}, ${iso(11)}, 'scheduled')`
      const pairs = await findRoomOverlapPairs(tx, '_probe_lessons')
      expect(pairs).toHaveLength(0)
    })
  })
})

describe('resolveOverlapLosers (the tie-break)', () => {
  const pair = (
    a_id: string,
    b_id: string,
    aH: number,
    bH: number,
  ): RoomOverlapPair => ({
    tenant_id: 't1',
    location: 'roomA',
    a_id,
    a_start: new Date(Date.UTC(2026, 2, 10, aH)),
    a_end: new Date(Date.UTC(2026, 2, 10, aH + 1)),
    b_id,
    b_start: new Date(Date.UTC(2026, 2, 10, bH)),
    b_end: new Date(Date.UTC(2026, 2, 10, bH + 1)),
  })

  it('cancels the later-starting lesson of each pair', () => {
    expect(resolveOverlapLosers([pair('a', 'b', 10, 11)])).toEqual(['b']) // b starts later
    expect(resolveOverlapLosers([pair('c', 'd', 12, 11)])).toEqual(['c']) // a(=c) starts later
  })

  it('on an equal start cancels the higher id (b_id, since the query guarantees a.id < b.id)', () => {
    expect(resolveOverlapLosers([pair('e', 'f', 10, 10)])).toEqual(['f'])
  })

  it('de-dupes a lesson that loses several pairs (cancel each at most once)', () => {
    // g is the later lesson in both pairs → appears once.
    const losers = resolveOverlapLosers([pair('a', 'g', 9, 12), pair('b', 'g', 10, 12)])
    expect(losers).toEqual(['g'])
  })
})

describe('roomOverlapConstraintSettled (idempotent fast-path)', () => {
  it('is true on the migrated DB (0015 lesson_no_room_overlap constraint present) — a no-op boot', async () => {
    expect(await roomOverlapConstraintSettled(sql)).toBe(true)
  })
})
