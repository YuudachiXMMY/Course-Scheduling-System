// Shared constants for the portal reports feature. Kept in its OWN module with NO `server-only` and no
// db/@/auth imports, so the client list (reports-list.tsx) can import the VALUE below without dragging
// data.ts's `import 'server-only'` dependency chain (postgres-js driver, @/auth/portal) into the client
// bundle — a client value-import from a server-only module fails `next build` (server-only poison-pill +
// unresolved Node core modules like tls/net/fs). data.ts re-uses this same constant.

// Non-empty sentinel for the whole-schedule (sectionId === null) filter bucket. MUST stay non-empty so
// it never collides with the reports-list "全部课程" (show-all) `<option value="">` — an empty key there
// would short-circuit the filter and make 「全程」 behave identically to 「全部课程」.
export const WHOLE_SCHEDULE_KEY = '__whole__'
