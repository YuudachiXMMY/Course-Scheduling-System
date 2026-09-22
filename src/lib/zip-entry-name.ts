// F3: sanitize a free-text name (e.g. a student's) into a safe ZIP entry folder. Pure + dependency-free
// so it is directly unit-testable. Strips path separators, Windows-reserved chars, AND collapses any run
// of ≥2 dots so no segment can form a `..` parent-directory traversal. This is DEFENSE-IN-DEPTH, not the
// sole guard: archiver@8's sanitizePath already strips a leading `../` from entry names, so the original
// Zip-Slip concern here is not actually exploitable — this keeps the no-traversal invariant explicit and
// local rather than relying on the archive library's behavior. Falls back to a stable label if nothing
// meaningful survives (empty, all-separators, or a lone `.`).
export function safeZipEntryName(name: string, fallback = 'student'): string {
  const cleaned = name
    .replace(/[/\\:*?"<>|]/g, '_') // path separators + Windows-reserved chars
    .replace(/\.{2,}/g, '_') // any `..` (or longer dot run) → never a traversal segment
    .trim()
  return cleaned.length > 0 && cleaned !== '.' ? cleaned : fallback
}
