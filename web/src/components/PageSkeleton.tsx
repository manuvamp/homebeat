import { Skeleton } from './ui'

export function PageSkeleton() {
  return (
    <div className="mx-auto max-w-[1120px] space-y-4 px-4 pt-6" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-9 w-56" />
      <Skeleton className="h-5 w-80 max-w-full" />
      <Skeleton className="mt-6 h-40 w-full rounded-[18px]" />
      <Skeleton className="h-24 w-full rounded-[18px]" />
      <Skeleton className="h-24 w-full rounded-[18px]" />
    </div>
  )
}
