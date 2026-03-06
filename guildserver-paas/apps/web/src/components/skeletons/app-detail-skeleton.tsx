"use client"

import { Skeleton } from "@/components/ui/skeleton"

export function AppDetailSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading application details">
      {/* Back button */}
      <Skeleton className="h-5 w-20" />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Skeleton className="h-12 w-12 rounded-lg" />
          <div>
            <Skeleton className="h-7 w-48 mb-2" />
            <div className="flex gap-2">
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="h-5 w-14 rounded-full" />
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-10 w-24 rounded-md" />
          <Skeleton className="h-10 w-24 rounded-md" />
          <Skeleton className="h-10 w-20 rounded-md" />
        </div>
      </div>

      {/* Metrics row */}
      <div className="grid gap-4 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border bg-card p-4 space-y-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-6 w-16" />
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="space-y-4">
        <div className="flex gap-4 border-b pb-2">
          {["Deployments", "Build Logs", "Configuration", "Domains", "Settings"].map((tab) => (
            <Skeleton key={tab} className="h-8 w-24 rounded-md" />
          ))}
        </div>

        {/* Tab content — deployment rows */}
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="rounded-lg border bg-card p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Skeleton className="h-8 w-8 rounded-full" />
                <div>
                  <Skeleton className="h-4 w-32 mb-1" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
              <div className="flex items-center gap-4">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-8 w-20 rounded-md" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
