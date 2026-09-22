import { afterEach, describe, expect, it } from 'vitest'
import { parseFlagValue, resolveActor } from '../scripts/purge-tenant'

// Pure CLI-layer helpers for the H8 purge tool — no DB, no process.exit. These pin the argument
// parsing and operator-identity resolution that back the two safety features added on review:
//   - `--confirm <organizationId>` re-confirmation gate for the irreversible COMMIT path;
//   - the actor recorded in every run's audit line (--actor / PURGE_ACTOR / OS user / 'unknown').

describe('parseFlagValue', () => {
  it('reads a `--name value` pair', () => {
    expect(parseFlagValue(['--commit', '--confirm', 'org_123'], '--confirm')).toBe('org_123')
  })

  it('reads a `--name=value` pair', () => {
    expect(parseFlagValue(['--confirm=org_123', '--commit'], '--confirm')).toBe('org_123')
  })

  it('returns undefined when the flag is absent (distinct from an empty value)', () => {
    expect(parseFlagValue(['--commit'], '--confirm')).toBeUndefined()
  })

  it('returns "" when the flag is present as the last token with no value', () => {
    expect(parseFlagValue(['--commit', '--confirm'], '--confirm')).toBe('')
  })

  it('does not match a different flag that shares a prefix', () => {
    expect(parseFlagValue(['--confirm-nothing', 'x'], '--confirm')).toBeUndefined()
  })
})

describe('resolveActor', () => {
  const originalActor = process.env.PURGE_ACTOR
  afterEach(() => {
    if (originalActor === undefined) delete process.env.PURGE_ACTOR
    else process.env.PURGE_ACTOR = originalActor
  })

  it('prefers an explicit --actor value over everything else', () => {
    process.env.PURGE_ACTOR = 'from-env'
    expect(resolveActor('alice')).toBe('alice')
  })

  it('trims surrounding whitespace on the --actor value', () => {
    expect(resolveActor('  bob  ')).toBe('bob')
  })

  it('falls back to PURGE_ACTOR when no --actor flag is given', () => {
    process.env.PURGE_ACTOR = 'ops-runner'
    expect(resolveActor(undefined)).toBe('ops-runner')
  })

  it('ignores a blank --actor and blank PURGE_ACTOR, resolving to a non-empty string', () => {
    process.env.PURGE_ACTOR = '   '
    // Falls through to the OS user (or 'unknown') — either way it must be a non-empty label.
    expect(resolveActor('   ').length).toBeGreaterThan(0)
  })
})
