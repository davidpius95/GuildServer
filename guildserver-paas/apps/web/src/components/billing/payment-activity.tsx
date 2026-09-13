"use client"
import { useEffect, useState } from "react"
import { trpc } from "@/components/trpc-provider"
import { CheckCircle2, Clock, AlertCircle, ExternalLink } from "lucide-react"

export function PaymentActivity({ organizationId }: { organizationId: string }) {
  const utils = trpc.useUtils()
  const [returnId, setReturnId] = useState<string | null>(null)
  useEffect(() => { setReturnId(new URLSearchParams(window.location.search).get("payment")) }, [])
  const payments = trpc.billing.listPaymentTransactions.useQuery({ organizationId, limit: 20 }, { enabled: !!organizationId, refetchInterval: 5000 })
  const returnPayment = payments.data?.find(p => p.id === returnId)
  useEffect(() => {
    if (returnPayment?.status === "succeeded") {
      void utils.billing.getCurrentPlan.invalidate(); void utils.billing.getInvoices.invalidate(); void utils.billing.listReceipts.invalidate()
    }
  }, [returnPayment?.status, utils])
  if (payments.isError) return <p role="alert" className="text-sm text-destructive">Payment activity could not load. Refresh to try again.</p>
  if (!payments.data?.length && !returnId) return null
  return <section className="rounded-xl border bg-card p-5">
    {returnId && <div role="status" aria-live="polite" className={`mb-5 flex items-start gap-3 rounded-lg p-4 ${returnPayment?.status === "succeeded" ? "bg-emerald-500/10" : "bg-muted"}`}>
      {returnPayment?.status === "succeeded" ? <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-600" /> : <Clock className="mt-0.5 h-5 w-5" />}
      <div><p className="font-medium">{returnPayment?.status === "succeeded" ? "Payment confirmed" : ["failed", "expired", "canceled"].includes(returnPayment?.status || "") ? "Payment was not completed" : "Checking your payment"}</p><p className="mt-1 text-sm text-muted-foreground">{returnPayment?.status === "succeeded" ? "Your invoice and receipt have been updated." : "This page updates automatically. If you have transferred money, wait for confirmation before paying again."}</p></div>
    </div>}
    <h2 className="mb-4 text-sm font-semibold">Payment activity</h2>
    <div className="divide-y">{payments.data?.map(p => {
      const success = p.status === "succeeded", pending = ["pending", "processing"].includes(p.status || "")
      const action = (p as any).checkoutUrl
      return <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"><div className="flex min-w-0 items-center gap-3">{success ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" /> : pending ? <Clock className="h-4 w-4 shrink-0 text-amber-600" /> : <AlertCircle className="h-4 w-4 shrink-0 text-muted-foreground" />}<div><p className="font-medium tabular-nums">{new Intl.NumberFormat("en-NG", { style: "currency", currency: p.currency || "USD" }).format(p.amountCents / 100)}</p><p className="break-all text-xs text-muted-foreground">{p.flutterwaveTxRef || p.id}</p></div></div><div className="text-right"><p className="capitalize">{success ? "Paid" : p.status}</p>{pending && action && <a className="inline-flex items-center gap-1 text-xs text-primary underline" href={action}>Resume checkout<ExternalLink className="h-3 w-3" /></a>}</div></div>
    })}</div>
  </section>
}
