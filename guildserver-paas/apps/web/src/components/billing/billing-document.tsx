"use client"

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { trpc } from "@/components/trpc-provider"
import { useState } from "react"
import {
  Download,
  CreditCard,
  CheckCircle2,
  FileText,
  Clock,
  AlertCircle,
  Loader2,
} from "lucide-react"

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

function formatDate(value: string | number | Date | null | undefined) {
  if (!value) return "—"
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))
}

export function BillingDocument({
  document,
  kind,
  organizationId,
  onClose,
  onPay,
}: {
  document: any
  kind: "quote" | "invoice" | "receipt"
  organizationId: string
  onClose: () => void
  onPay: (invoice: any) => void
}) {
  const utils = trpc.useUtils()
  const [error, setError] = useState("")

  const invoiceQuery = trpc.billing.getInvoice.useQuery(
    {
      organizationId,
      invoiceId: kind === "receipt" ? document.invoiceId : document.id,
    },
    { enabled: kind !== "quote" && !!(kind === "receipt" ? document.invoiceId : document.id) }
  )

  const acceptMutation = trpc.billing.acceptQuote.useMutation()

  const lines = kind === "quote" ? document.lineItems : invoiceQuery.data?.lineItems || []
  const currency = (document.currency || "USD").toUpperCase()

  const isExpired =
    kind === "quote" &&
    document.status !== "accepted" &&
    document.validUntil &&
    new Date(document.validUntil).getTime() <= Date.now()

  const totalCents =
    kind === "quote"
      ? document.totalCents
      : kind === "receipt"
      ? document.amountCents
      : document.amountDueCents || 0

  const remainingCents =
    kind === "invoice"
      ? Math.max((document.amountDueCents || 0) - (document.amountPaidCents || 0), 0)
      : totalCents

  async function handleAcceptQuote() {
    try {
      const invoice = await acceptMutation.mutateAsync({
        organizationId,
        quoteId: document.id,
      })
      await utils.billing.invalidate()
      onPay(invoice)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Quote could not be accepted.")
    }
  }

  function handleDownloadHtml() {
    const escape = (val: unknown) =>
      String(val ?? "").replace(/[&<>"']/g, (c) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[c]!))

    const title = `${kind.toUpperCase()} - ${document.number || document.id}`
    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escape(title)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #111827; max-width: 800px; margin: 40px auto; padding: 24px; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #e5e7eb; padding-bottom: 20px; }
    .logo { font-size: 24px; font-weight: bold; color: #0f172a; }
    .badge { display: inline-block; padding: 4px 10px; border-radius: 9999px; font-size: 12px; font-weight: 600; text-transform: uppercase; background: #f3f4f6; color: #374151; }
    .badge.paid { background: #d1fae5; color: #065f46; }
    .badge.open { background: #dbeafe; color: #1e40af; }
    .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 24px 0; font-size: 14px; }
    .meta dt { color: #6b7280; font-weight: 500; }
    .meta dd { margin: 0; font-weight: 600; color: #111827; }
    table { width: 100%; border-collapse: collapse; margin: 24px 0; }
    th { text-align: left; padding: 12px; background: #f9fafb; border-bottom: 1px solid #e5e7eb; font-size: 13px; text-transform: uppercase; color: #4b5563; }
    td { padding: 12px; border-bottom: 1px solid #f3f4f6; font-size: 14px; }
    .text-right { text-align: right; }
    .total-box { margin-top: 24px; border-top: 2px solid #e5e7eb; padding-top: 16px; text-align: right; }
    .total-amount { font-size: 24px; font-weight: bold; color: #0f172a; }
    footer { margin-top: 48px; border-top: 1px solid #e5e7eb; padding-top: 16px; font-size: 12px; color: #9ca3af; text-align: center; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="logo">GuildServer</div>
      <p style="margin: 4px 0 0 0; color: #6b7280; font-size: 14px;">Cloud Infrastructure & PaaS</p>
    </div>
    <div style="text-align: right;">
      <h2 style="margin: 0; text-transform: uppercase; font-size: 20px;">${escape(kind)}</h2>
      <p style="margin: 4px 0; font-family: monospace; font-size: 14px;">${escape(document.number || document.id)}</p>
      <span class="badge ${document.status === "paid" ? "paid" : document.status === "open" ? "open" : ""}">${escape(isExpired ? "expired" : document.status)}</span>
    </div>
  </div>

  <div class="meta">
    <div>
      <dt>Organization</dt>
      <dd>${escape(organizationId)}</dd>
    </div>
    <div>
      <dt>Date Issued</dt>
      <dd>${escape(formatDate(document.issuedAt || document.createdAt))}</dd>
    </div>
    ${document.validUntil ? `<div><dt>Valid Until</dt><dd>${escape(formatDate(document.validUntil))}</dd></div>` : ""}
    ${document.paymentTransactionId ? `<div><dt>Transaction Reference</dt><dd style="font-family: monospace;">${escape(document.paymentTransactionId)}</dd></div>` : ""}
  </div>

  <table>
    <thead>
      <tr>
        <th>Description</th>
        <th class="text-right">Qty</th>
        <th class="text-right">Unit Price</th>
        <th class="text-right">Amount</th>
      </tr>
    </thead>
    <tbody>
      ${(lines || [])
        .map(
          (l: any) => `<tr>
            <td><strong>${escape(l.description)}</strong></td>
            <td class="text-right">${escape(l.quantity)}</td>
            <td class="text-right">${escape(formatMoney(l.unitAmountCents, currency))}</td>
            <td class="text-right font-medium">${escape(formatMoney(l.totalCents, currency))}</td>
          </tr>`
        )
        .join("")}
    </tbody>
  </table>

  <div class="total-box">
    <div style="color: #6b7280; font-size: 14px; margin-bottom: 4px;">${kind === "receipt" ? "Amount Paid" : "Total Due"}</div>
    <div class="total-amount">${escape(formatMoney(totalCents, currency))}</div>
  </div>

  <footer>
    GuildServer Technologies • Billed in ${escape(currency)} • Thank you for your business.
  </footer>
</body>
</html>`

    const blob = new Blob([html], { type: "text/html;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const link = window.document.createElement("a")
    link.href = url
    link.download = `${document.number || kind}.html`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1500)
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl p-6">
        <DialogHeader className="text-left space-y-2 pb-4 border-b">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" />
              <DialogTitle className="capitalize text-xl font-bold">
                {kind} {document.number}
              </DialogTitle>
            </div>
            <Badge
              variant={
                document.status === "paid" || document.status === "accepted"
                  ? "default"
                  : isExpired
                  ? "destructive"
                  : "secondary"
              }
              className="uppercase text-xs"
            >
              {isExpired ? "Expired" : document.status}
            </Badge>
          </div>
          <DialogDescription className="text-xs text-muted-foreground">
            Issued {formatDate(document.issuedAt || document.createdAt)} • All amounts in {currency}
          </DialogDescription>
        </DialogHeader>

        {invoiceQuery.isLoading && kind !== "quote" ? (
          <div className="py-12 flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4 pt-2">
            {/* Items Table */}
            <div className="rounded-xl border bg-muted/10 divide-y">
              {lines?.map((line: any) => (
                <div
                  key={line.id || line.description}
                  className="p-4 flex items-start justify-between gap-4 text-sm"
                >
                  <div>
                    <p className="font-semibold text-foreground">{line.description}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Quantity: {line.quantity} × {formatMoney(line.unitAmountCents, currency)}
                    </p>
                    {line.taxCents > 0 && (
                      <p className="text-xs text-muted-foreground">
                        Tax: {formatMoney(line.taxCents, currency)}
                      </p>
                    )}
                    {line.discountCents > 0 && (
                      <p className="text-xs text-emerald-600 dark:text-emerald-400">
                        Discount: -{formatMoney(line.discountCents, currency)}
                      </p>
                    )}
                  </div>
                  <span className="font-semibold tabular-nums text-foreground">
                    {formatMoney(line.totalCents, currency)}
                  </span>
                </div>
              ))}

              <div className="p-4 bg-muted/20 flex items-center justify-between">
                <div>
                  <span className="text-sm font-semibold">
                    {kind === "receipt" ? "Amount Received" : "Total"}
                  </span>
                  {kind === "invoice" && remainingCents > 0 && remainingCents !== totalCents && (
                    <p className="text-xs text-muted-foreground">
                      Remaining balance: {formatMoney(remainingCents, currency)}
                    </p>
                  )}
                </div>
                <span className="text-xl font-bold tabular-nums">
                  {formatMoney(totalCents, currency)}
                </span>
              </div>
            </div>

            {error && (
              <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-xs text-red-600 dark:text-red-400 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Actions */}
            <div className="flex flex-wrap gap-2 pt-2">
              <Button
                variant="outline"
                className="gap-1.5"
                onClick={handleDownloadHtml}
              >
                <Download className="h-4 w-4" />
                Download / Print
              </Button>

              {kind === "quote" &&
                !isExpired &&
                ["draft", "sent"].includes(document.status) && (
                  <Button
                    className="flex-1 gap-1.5 font-semibold"
                    disabled={acceptMutation.isPending}
                    onClick={handleAcceptQuote}
                  >
                    {acceptMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <CreditCard className="h-4 w-4" />
                    )}
                    {acceptMutation.isPending ? "Accepting Quote…" : "Accept Quote & Pay"}
                  </Button>
                )}

              {kind === "invoice" &&
                document.status === "open" &&
                remainingCents > 0 && (
                  <Button
                    className="flex-1 gap-1.5 font-semibold"
                    onClick={() => {
                      onPay(document)
                      onClose()
                    }}
                  >
                    <CreditCard className="h-4 w-4" />
                    Pay Invoice ({formatMoney(remainingCents, currency)})
                  </Button>
                )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
