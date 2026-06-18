import { cn } from "@/lib/utils"

interface PageHeaderProps {
  title: string
  description?: string
  /** Right-aligned actions (buttons, etc.) — wraps below the title on mobile */
  actions?: React.ReactNode
  className?: string
  children?: React.ReactNode
}

/**
 * Consistent dashboard page header: title + optional description on the left,
 * actions on the right. Stacks vertically on small screens.
 */
export function PageHeader({ title, description, actions, className, children }: PageHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 pb-6 sm:flex-row sm:items-center sm:justify-between",
        className
      )}
    >
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        {description && (
          <p className="text-sm text-muted-foreground sm:text-base">{description}</p>
        )}
      </div>
      {(actions || children) && (
        <div className="flex flex-wrap items-center gap-2">{actions ?? children}</div>
      )}
    </div>
  )
}
