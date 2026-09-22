// L-auth: single source of truth for the minimum password length across every credential entry point
// (staff provisioning, portal provisioning, self-service change, admin reset, and Better Auth's own
// emailAndPassword guard). The audit flagged an 8-char floor as too weak given login has no per-account
// lockout; 12 is a low-friction hardening. The superadmin ADMIN_PASSWORD stays at its own ≥16 floor
// (env.ts) — this constant is the floor for everyone else.
export const MIN_PASSWORD_LENGTH = 12
export const PASSWORD_MIN_MESSAGE = `密码至少 ${MIN_PASSWORD_LENGTH} 位`
