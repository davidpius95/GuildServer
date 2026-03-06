"use client"

import { Skeleton } from "@/components/ui/skeleton"

export function DeploymentListSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading deployments">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Skeleton className="h-9 w-44 mb-2" />
          <Skeleton className="h-5 w-56" />
        </div>
        <Skeleton className="h-10 w-10 rounded-md" />
      </div>

      {/* Filters row */}
      <div className="flex gap-3 flex-wrap">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-24 rounded-full" />
        ))}
        <div className="ml-auto flex gap-2">
          <Skeleton className="h-8 w-28 rounded-md" />
          <Skeleton className="h-8 w-32 rounded-md" />
        </div>
      </div>

      {/* Deployment rows */}
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="rounded-lg border bg-card p-4 flex items-center justify-between"
          >
            <div className="flex items-center gap-4">
              <Skeleton className="h-8 w-8 rounded-full" />
              <div>
                <Skeleton className="h-4 w-36 mb-1.5" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
            <div className="flex items-center gap-6">
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="h-4 w-14" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-8 w-20 rounded-md" />
            </div>
          </div>
        ))}
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-40" />
        <div className="flex gap-2">
          <Skeleton className="h-8 w-20 rounded-md" />
          <Skeleton className="h-8 w-20 rounded-md" />
        </div>
      </div>
    </div>
  )
}
