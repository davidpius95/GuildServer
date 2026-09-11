import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

const STYLES: Record<string, string> = {
  running: "border-green-500/40 text-green-600 dark:text-green-400",
  healthy: "border-green-500/40 text-green-600 dark:text-green-400",
  deploying: "border-blue-500/40 text-blue-600 dark:text-blue-400",
  starting: "border-blue-500/40 text-blue-600 dark:text-blue-400",
  pending: "border-blue-500/40 text-blue-600 dark:text-blue-400",
  degraded: "border-amber-500/40 text-amber-600 dark:text-amber-400",
  restarting: "border-amber-500/40 text-amber-600 dark:text-amber-400",
  unhealthy: "border-red-500/40 text-red-600 dark:text-red-400",
  failed: "border-red-500/40 text-red-600 dark:text-red-400",
  missing: "border-red-500/40 text-red-600 dark:text-red-400",
  dead: "border-red-500/40 text-red-600 dark:text-red-400",
}

/** Status of a stack, one of its containers, or a stack deployment. */
export function StackStatusBadge({ status, className }: { status?: string | null; className?: string }) {
  const value = status || "unknown"
  return (
    <Badge variant="outline" className={cn("capitalize", STYLES[value] ?? "text-muted-foreground", className)}>
      {value}
    </Badge>
  )
}
