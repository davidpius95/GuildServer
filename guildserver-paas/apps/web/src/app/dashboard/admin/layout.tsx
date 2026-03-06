"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useCurrentUser } from "@/hooks/use-auth"
import { Loader2, ShieldAlert } from "lucide-react"

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const router = useRouter()
  const { isAdmin, isLoading, user } = useCurrentUser()

  useEffect(() => {
    // Once loaded, if user exists but is not admin, redirect
    if (!isLoading && user && !isAdmin) {
      router.replace("/dashboard")
    }
  }, [isLoading, user, isAdmin, router])

  // Still loading user data
  if (isLoading || !user) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" />
          <p className="text-sm">Checking permissions...</p>
        </div>
      </div>
    )
  }

  // Not admin — show brief message before redirect
  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <ShieldAlert className="h-10 w-10" />
          <p className="text-sm font-medium">Admin access required</p>
          <p className="text-xs">Redirecting to dashboard...</p>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
