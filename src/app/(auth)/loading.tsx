// L-ux: Suspense fallback for the auth segment (login) so a slow first navigation shows feedback rather
// than a frozen blank. Purely presentational skeleton.
export default function AuthLoading() {
  return (
    <div className="flex flex-col gap-4" aria-hidden>
      <div className="h-6 w-24 animate-pulse rounded bg-neutral-200" />
      <div className="h-10 animate-pulse rounded bg-neutral-100" />
      <div className="h-10 animate-pulse rounded bg-neutral-100" />
    </div>
  )
}
