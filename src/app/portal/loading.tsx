// L-ux: Suspense fallback for slow RSC navigations into /portal/* — parents/students (the least
// technical users) otherwise see a frozen screen with no feedback. Purely presentational skeleton.
export default function PortalLoading() {
  return (
    <div className="flex flex-col gap-4" aria-hidden>
      <div className="h-6 w-40 animate-pulse rounded bg-neutral-200" />
      <div className="h-24 animate-pulse rounded-lg bg-neutral-100" />
      <div className="h-24 animate-pulse rounded-lg bg-neutral-100" />
    </div>
  )
}
