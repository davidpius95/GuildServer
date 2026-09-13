"use client"

import { useEffect, useState } from "react"
import { trpc } from "@/components/trpc-provider"
import {
  CheckCircle2,
  Clock,
  AlertCircle,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  CreditCard,
  ShieldCheck,
  X,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

function formatMoney(amountCents: number, currency = "USD") {
  const code = (currency || "USD").toUpperCase()
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(amountCents / 100)
  } catch {
    return `${code} ${(amountCents / 100).toFixed(2)}`
  }
}

function timeAgo(date: string | Date | null | undefined) {
  if (!date) return "—"
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000)
  if (seconds < 60) return "Just now"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function PaymentActivity({ organizationId }: { organizationId: string }) {
  const utils = trpc.useUtils()
  const [returnId, setReturnId] = useState<string | null>(null)
  const [dismissedBanner, setDismissedBanner] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)

  // Extract payment id from return redirect URL
  useEffect(() => {
    if (typeof window !== "undefined") {
      const id = new URLSearchParams(window.location.search).get("payment")
      if (id) setReturnId(id)
    }
  }, [])

  const paymentsQuery = trpc.billing.listPaymentTransactions.useQuery(
    { organizationId, limit: 25 },
    {
      enabled: !!organizationId,
      refetchInterval: (data: any) => {
        // Poll more frequently (every 4s) if a transaction is pending or user just returned
        const hasActive =
          !!returnId ||
          (Array.isArray(data) && data.some((p: any) => p.status === "pending" || p.status === "processing"))
        return hasActive ? 4000 : 30000
      },
    }
  )

  const verifyMutation = trpc.billing.verifyPaymentTransaction.useMutation({
    onSuccess: (updated) => {
      void utils.billing.listPaymentTransactions.invalidate()
      if (updated.status === "succeeded") {
        void utils.billing.getCurrentPlan.invalidate()
        void utils.billing.getInvoices.invalidate()
        void utils.billing.listReceipts.invalidate()
      }
    },
  })

  // Trigger immediate verification check upon returning from Flutterwave
  useEffect(() => {
    if (returnId && organizationId) {
      verifyMutation.mutate({
        organizationId,
        paymentTransactionId: returnId,
      })
    }
  }, [returnId, organizationId])

  const returnPayment = (paymentsQuery.data as any[])?.find((p: any) => p.id === returnId)

  // Invalidate billing queries when return payment succeeds
  useEffect(() => {
    if (returnPayment?.status === "succeeded") {
      void utils.billing.getCurrentPlan.invalidate()
      void utils.billing.getInvoices.invalidate()
      void utils.billing.listReceipts.invalidate()
    }
  }, [returnPayment?.status, utils])

  if (paymentsQuery.isError) {
    return (
      <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-600 dark:text-red-400">
        Unable to load recent payment transactions.
      </div>
    )
  }

  const transactions = paymentsQuery.data || []
  if (transactions.length === 0 && !returnId) return null

  const visibleTransactions = isExpanded ? transactions : transactions.slice(0, 3)

  return (
    <div className="space-y-4">
      {/* Return from Checkout Status Banner */}
      {returnId && !dismissedBanner && (
        <div
          role="status"
          aria-live="polite"
          className={`rounded-xl border p-4 shadow-sm transition-all ${
            returnPayment?.status === "succeeded"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200"
              : ["failed", "expired", "canceled"].includes(returnPayment?.status || "")
              ? "border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200"
              : "border-primary/30 bg-primary/5 text-foreground"
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              {returnPayment?.status === "succeeded" ? (
                <CheckCircle2 className="h-5 w-5 mt-0.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              ) : ["failed", "expired", "canceled"].includes(returnPayment?.status || "") ? (
                <AlertCircle className="h-5 w-5 mt-0.5 text-amber-600 dark:text-amber-400 shrink-0" />
              ) : (
                <RefreshCw className="h-5 w-5 mt-0.5 text-primary animate-spin shrink-0" />
              )}
              <div className="space-y-1">
                <p className="font-semibold text-sm">
                  {returnPayment?.status === "succeeded"
                    ? "Payment Successful!"
                    : ["failed", "expired", "canceled"].includes(returnPayment?.status || "")
                    ? "Payment Not Completed"
                    : "Confirming Your Payment…"}
                </p>
                <p className="text-xs opacity-90 leading-relaxed">
                  {returnPayment?.status === "succeeded"
                    ? "Your invoice has been settled and receipt issued. Your plan limits and features are now active."
                    : ["failed", "expired", "canceled"].includes(returnPayment?.status || "")
                    ? "The checkout attempt was not completed. You can re-attempt payment at any time from Documents."
                    : "Connecting to Flutterwave to synchronize your payment status. If you completed a transfer, this will update automatically."}
                </p>
              </div>
            </div>

            <button
              onClick={() => setDismissedBanner(true)}
              className="text-muted-foreground hover:text-foreground p-1"
              aria-label="Dismiss banner"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Payment Activity List */}
      <section className="rounded-xl border bg-card p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <CreditCard className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">Payment Activity</h3>
          </div>
          {transactions.length > 3 && (
            <button
              type="button"
              onClick={() => setIsExpanded(!isExpanded)}
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              {isExpanded ? (
                <>
                  Show fewer <ChevronUp className="h-3 w-3" />
                </>
              ) : (
                <>
                  View all ({transactions.length}) <ChevronDown className="h-3 w-3" />
                </>
              )}
            </button>
          )}
        </div>

        <div className="divide-y border-t">
          {visibleTransactions.map((tx: any) => {
            const isSucceeded = tx.status === "succeeded"
            const isPending = tx.status === "pending" || tx.status === "processing"
            const isFailed = ["failed", "expired", "canceled"].includes(tx.status || "")

            return (
              <div
                key={tx.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                      isSucceeded
                        ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                        : isPending
                        ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {isSucceeded ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : isPending ? (
                      <Clock className="h-4 w-4" />
                    ) : (
                      <AlertCircle className="h-4 w-4" />
                    )}
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-sm tabular-nums">
                        {formatMoney(tx.amountCents, tx.currency || "USD")}
                      </p>
                      <Badge
                        variant={isSucceeded ? "default" : isPending ? "secondary" : "outline"}
                        className={`text-[10px] px-1.5 py-0 capitalize ${
                          isSucceeded
                            ? "bg-emerald-600 hover:bg-emerald-600 text-white"
                            : isPending
                            ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                            : "text-muted-foreground"
                        }`}
                      >
                        {isSucceeded ? "Paid" : tx.status}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground truncate font-mono mt-0.5">
                      {tx.flutterwaveTxRef || tx.id}
                    </p>
                  </div>
                </div>

                <div className="text-right">
                  <span className="text-xs text-muted-foreground block">
                    {timeAgo(tx.createdAt)}
                  </span>
                  {isPending && tx.checkoutUrl && (
                    <a
                      href={tx.checkoutUrl}
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline font-medium mt-0.5"
                    >
                      Resume checkout <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}
