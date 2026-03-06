"use client"

import * as React from "react"
import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog"
import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"
import { AlertTriangle, Trash2, RotateCcw, Info } from "lucide-react"

// ── Low-level AlertDialog primitives (shadcn-style) ──────────────

const AlertDialog = AlertDialogPrimitive.Root
const AlertDialogTrigger = AlertDialogPrimitive.Trigger
const AlertDialogPortal = AlertDialogPrimitive.Portal

const AlertDialogOverlay = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Overlay
    className={cn(
      "fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    ref={ref}
    {...props}
  />
))
AlertDialogOverlay.displayName = AlertDialogPrimitive.Overlay.displayName

const AlertDialogContent = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Content>
>(({ className, ...props }, ref) => (
  <AlertDialogPortal>
    <AlertDialogOverlay />
    <AlertDialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed left-[50%] top-[50%] z-50 grid w-full max-w-md translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg",
        className
      )}
      {...props}
    />
  </AlertDialogPortal>
))
AlertDialogContent.displayName = AlertDialogPrimitive.Content.displayName

const AlertDialogTitle = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold", className)}
    {...props}
  />
))
AlertDialogTitle.displayName = AlertDialogPrimitive.Title.displayName

const AlertDialogDescription = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
AlertDialogDescription.displayName =
  AlertDialogPrimitive.Description.displayName

const AlertDialogAction = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Action>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Action>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Action
    ref={ref}
    className={cn(buttonVariants(), className)}
    {...props}
  />
))
AlertDialogAction.displayName = AlertDialogPrimitive.Action.displayName

const AlertDialogCancel = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Cancel>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Cancel>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Cancel
    ref={ref}
    className={cn(buttonVariants({ variant: "outline" }), className)}
    {...props}
  />
))
AlertDialogCancel.displayName = AlertDialogPrimitive.Cancel.displayName

// ── High-level ConfirmDialog component ───────────────────────────

type ConfirmVariant = "danger" | "warning" | "info"

interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: ConfirmVariant
  onConfirm: () => void
  loading?: boolean
}

const variantConfig: Record<ConfirmVariant, {
  icon: React.ReactNode
  iconBg: string
  buttonClass: string
}> = {
  danger: {
    icon: <Trash2 className="h-5 w-5 text-red-600" />,
    iconBg: "bg-red-100 dark:bg-red-950/50",
    buttonClass: "bg-red-600 text-white hover:bg-red-700 focus:ring-red-600",
  },
  warning: {
    icon: <RotateCcw className="h-5 w-5 text-amber-600" />,
    iconBg: "bg-amber-100 dark:bg-amber-950/50",
    buttonClass: "bg-amber-600 text-white hover:bg-amber-700 focus:ring-amber-600",
  },
  info: {
    icon: <Info className="h-5 w-5 text-blue-600" />,
    iconBg: "bg-blue-100 dark:bg-blue-950/50",
    buttonClass: "bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-600",
  },
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "danger",
  onConfirm,
  loading = false,
}: ConfirmDialogProps) {
  const config = variantConfig[variant]

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <div className="flex gap-4">
          {/* Icon */}
          <div
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
              config.iconBg
            )}
          >
            {config.icon}
          </div>

          {/* Text */}
          <div className="space-y-2">
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription>{description}</AlertDialogDescription>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 mt-2">
          <AlertDialogCancel disabled={loading}>
            {cancelLabel}
          </AlertDialogCancel>
          <AlertDialogAction
            className={cn(config.buttonClass)}
            onClick={(e) => {
              e.preventDefault() // prevent auto-close so loading state is visible
              onConfirm()
            }}
            disabled={loading}
          >
            {loading && (
              <svg
                className="mr-2 h-4 w-4 animate-spin"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
            {confirmLabel}
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// ── Hook for imperative usage ────────────────────────────────────

interface ConfirmState {
  open: boolean
  title: string
  description: string
  confirmLabel: string
  variant: ConfirmVariant
  onConfirm: () => void
}

const defaultState: ConfirmState = {
  open: false,
  title: "",
  description: "",
  confirmLabel: "Confirm",
  variant: "danger",
  onConfirm: () => {},
}

export function useConfirmDialog() {
  const [state, setState] = React.useState<ConfirmState>(defaultState)

  const confirm = React.useCallback(
    (opts: {
      title: string
      description: string
      confirmLabel?: string
      variant?: ConfirmVariant
      onConfirm: () => void
    }) => {
      setState({
        open: true,
        title: opts.title,
        description: opts.description,
        confirmLabel: opts.confirmLabel ?? "Confirm",
        variant: opts.variant ?? "danger",
        onConfirm: opts.onConfirm,
      })
    },
    []
  )

  const dialogProps = {
    open: state.open,
    onOpenChange: (open: boolean) => {
      if (!open) setState(defaultState)
    },
    title: state.title,
    description: state.description,
    confirmLabel: state.confirmLabel,
    variant: state.variant,
    onConfirm: () => {
      state.onConfirm()
      setState(defaultState)
    },
  }

  return { confirm, dialogProps }
}

export {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
}
