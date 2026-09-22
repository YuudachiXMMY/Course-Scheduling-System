import { describe, it, expect } from 'vitest'
import { safeZipEntryName } from '@/lib/zip-entry-name'

// F3: defense-in-depth normalization for ZIP entry folder names (archiver@8 already strips a leading
// `../`, so this is not the sole guard — these lock the local no-traversal invariant).
describe('safeZipEntryName', () => {
  it('keeps a normal name unchanged', () => {
    expect(safeZipEntryName('张三')).toBe('张三')
    expect(safeZipEntryName('Li Hua')).toBe('Li Hua')
  })

  it('replaces path separators and Windows-reserved chars', () => {
    expect(safeZipEntryName('a/b\\c:d*e?f"g<h>i|j')).toBe('a_b_c_d_e_f_g_h_i_j')
  })

  it('collapses any `..` run so no entry can form a traversal segment', () => {
    expect(safeZipEntryName('..')).toBe('_')
    expect(safeZipEntryName('a..b')).toBe('a_b')
    expect(safeZipEntryName('....')).toBe('_')
    // The invariant that matters: the result carries neither a path separator nor a `..` sequence.
    const out = safeZipEntryName('../../etc/passwd')
    expect(out).not.toContain('..')
    expect(out).not.toContain('/')
  })

  it('falls back for empty / whitespace / lone-dot names', () => {
    expect(safeZipEntryName('')).toBe('student')
    expect(safeZipEntryName('   ')).toBe('student')
    expect(safeZipEntryName('.')).toBe('student')
    expect(safeZipEntryName('/')).toBe('_') // a separator survives as an underscore, not a fallback
  })

  it('honors a custom fallback', () => {
    expect(safeZipEntryName('', 'anon')).toBe('anon')
  })
})
