// L-ux: route-segment Suspense fallback for slow RSC navigations into /dashboard/* — without it a slow
// data fetch leaves the previous screen frozen with no feedback (feels stuck on mobile). Purely
// presentational skeleton.
export default function DashboardLoading() {
  return (
    <div className="flex flex-col gap-4" aria-hidden>
      <div className="h-6 w-40 animate-pulse rounded bg-neutral-200" />
      <div className="h-24 animate-pulse rounded-lg bg-neutral-100" />
      <div className="h-24 animate-pulse rounded-lg bg-neutral-100" />
    </div>
  )
}
