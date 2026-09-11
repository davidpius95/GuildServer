"use client"

import { Badge } from "@/components/ui/badge"
import { useOrganization } from "@/hooks/use-auth"

/** Native <select> styled like the other form controls. */
export const NATIVE_SELECT_CLASS =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"

/**
 * Whether the current user is an owner or admin of the current organization.
 * Only decides what the UI offers; the API enforces the same rule.
 */
export function useCanManage(): boolean {
  const { currentOrg } = useOrganization()
  const role = (currentOrg as { role?: string; memberRole?: string } | null)?.role ??
    (currentOrg as { memberRole?: string } | null)?.memberRole
  return role === "owner" || role === "admin"
}

export function formatWhen(value?: string | Date | null): string {
  if (!value) return "Never"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString()
}

export function humanizeEvent(event: string): string {
  const text = event.replace(/_/g, " ")
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export function DeliveryStatus({ ok, error, at }: { ok?: boolean | null; error?: string | null; at?: string | Date | null }) {
  if (ok === null || ok === undefined) {
    return <Badge variant="outline">Not used yet</Badge>
  }
  if (ok) {
    return (
      <Badge variant="outline" className="border-green-500/40 text-green-600 dark:text-green-400" title={`Last delivery ${formatWhen(at)}`}>
        Delivered
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="border-red-500/40 text-red-600 dark:text-red-400" title={error ?? undefined}>
      Failing
    </Badge>
  )
}
