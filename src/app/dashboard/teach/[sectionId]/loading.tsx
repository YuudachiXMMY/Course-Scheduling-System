export default function SectionLoading() {
  return (
    <div className="flex flex-col gap-3" aria-hidden>
      <div className="h-5 w-32 animate-pulse rounded bg-neutral-100" />
      <div className="h-8 w-full max-w-sm animate-pulse rounded bg-neutral-100" />
      <div className="h-40 animate-pulse rounded-lg bg-neutral-100" />
    </div>
  )
}
