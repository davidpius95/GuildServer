"use client"

import { Skeleton } from "@/components/ui/skeleton"

export function AppListSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading applications">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Skeleton className="h-9 w-44 mb-2" />
          <Skeleton className="h-5 w-64" />
        </div>
        <Skeleton className="h-10 w-40 rounded-md" />
      </div>

      {/* Search bar */}
      <Skeleton className="h-10 w-full max-w-sm rounded-md" />

      {/* App cards grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="rounded-xl border bg-card p-5 space-y-4"
          >
            {/* Card header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Skeleton className="h-10 w-10 rounded-lg" />
                <div>
                  <Skeleton className="h-5 w-28 mb-1" />
                  <div className="flex gap-2">
                    <Skeleton className="h-5 w-16 rounded-full" />
                    <Skeleton className="h-5 w-14 rounded-full" />
                  </div>
                </div>
              </div>
              <Skeleton className="h-8 w-8 rounded-md" />
            </div>

            {/* Card body */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Skeleton className="h-3 w-3 rounded-full" />
                <Skeleton className="h-3 w-48" />
              </div>
              <div className="flex items-center gap-2">
                <Skeleton className="h-3 w-3 rounded-full" />
                <Skeleton className="h-3 w-36" />
              </div>
            </div>

            {/* Card footer */}
            <div className="flex items-center justify-between pt-2 border-t">
              <Skeleton className="h-4 w-32" />
              <div className="flex gap-2">
                <Skeleton className="h-8 w-20 rounded-md" />
                <Skeleton className="h-8 w-8 rounded-md" />
                <Skeleton className="h-8 w-8 rounded-md" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
