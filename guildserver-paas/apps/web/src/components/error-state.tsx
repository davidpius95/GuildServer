"use client"

import { AlertCircle, Link2, LogIn, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { getFriendlyError } from "@/lib/errors"

/**
 * Consistent inline error presentation.
 *
 * Replaces ad-hoc `<p>{error.message}</p>` renders, which leaked raw provider
 * JSON into the UI and gave the user nothing to act on. Always shows a plain
 * headline, an actionable sentence, and — where one exists — the recovery
 * button for that failure.
 */
export function ErrorState({
  error,
  onRetry,
  onReconnect,
  className,
  compact,
}: {
  error: unknown
  onRetry?: () => void
  onReconnect?: () => void
  className?: string
  /** Single line, for tight spaces like under a form field. */
  compact?: boolean
}) {
  if (!error) return null
  const { title, message, action } = getFriendlyError(error)

  if (compact) {
    return (
      <p className={`text-xs text-destructive ${className ?? ""}`} role="alert">
        {message}
      </p>
    )
  }

  // Only offer an action we can actually perform.
  const showReconnect = action === "reconnect" && !!onReconnect
  const showRetry = action !== "reconnect" && !!onRetry
  const showSignIn = action === "signin"

  return (
    <div
      role="alert"
      className={`flex flex-col items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-6 text-center ${className ?? ""}`}
    >
      <AlertCircle className="h-5 w-5 text-destructive" aria-hidden />
      <div className="space-y-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>

      {showReconnect && (
        <Button type="button" size="sm" variant="outline" onClick={onReconnect}>
          <Link2 className="mr-1.5 h-3.5 w-3.5" />
          Reconnect
        </Button>
      )}
      {showRetry && (
        <Button type="button" size="sm" variant="outline" onClick={onRetry}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          Try again
        </Button>
      )}
      {showSignIn && (
        <Button type="button" size="sm" variant="outline" onClick={() => (window.location.href = "/auth/login")}>
          <LogIn className="mr-1.5 h-3.5 w-3.5" />
          Sign in
        </Button>
      )}
    </div>
  )
}
