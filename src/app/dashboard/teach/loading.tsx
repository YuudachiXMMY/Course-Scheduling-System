export default function TeachLoading() {
  return (
    <div className="flex flex-col gap-3" aria-hidden>
      <div className="h-6 w-40 animate-pulse rounded bg-neutral-100" />
      <div className="h-9 w-full max-w-md animate-pulse rounded bg-neutral-100" />
      <div className="h-40 animate-pulse rounded-lg bg-neutral-100" />
    </div>
  )
}
