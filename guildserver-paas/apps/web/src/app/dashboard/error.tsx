"use client"

import { useEffect } from "react"
import { AlertTriangle, RefreshCw, LayoutDashboard } from "lucide-react"
import { Button } from "@/components/ui/button"
import Link from "next/link"

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("Dashboard error:", error)
  }, [error])

  return (
    <div className="flex items-center justify-center py-20 px-4" role="alert">
      <div className="text-center max-w-md">
        <div className="rounded-full bg-red-100 dark:bg-red-950 p-4 w-fit mx-auto mb-6">
          <AlertTriangle className="h-8 w-8 text-red-600 dark:text-red-400" />
        </div>
        <h2 className="text-xl font-bold mb-2">Failed to load dashboard</h2>
        <p className="text-muted-foreground mb-2">
          Something went wrong while loading this page. This could be a
          temporary connection issue.
        </p>
        {error.message && (
          <p className="text-xs text-muted-foreground mb-6 font-mono bg-muted rounded-md p-2">
            {error.message}
          </p>
        )}
        <div className="flex items-center justify-center gap-3">
          <Button onClick={reset} variant="default">
            <RefreshCw className="mr-2 h-4 w-4" />
            Try Again
          </Button>
          <Link href="/dashboard">
            <Button variant="outline">
              <LayoutDashboard className="mr-2 h-4 w-4" />
              Overview
            </Button>
          </Link>
        </div>
      </div>
    </div>
  )
}
