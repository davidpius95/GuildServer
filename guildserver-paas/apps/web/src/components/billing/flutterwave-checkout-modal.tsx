"use client"

import { useEffect, useState } from "react"
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
import {
  Loader2,
  CreditCard,
  Building2,
  ArrowRight,
  ShieldCheck,
  FileText,
  CheckCircle2,
  AlertCircle,
  Clock,
  RotateCcw,
  Sparkles,
} from "lucide-react"

type Currency = "USD" | "NGN"
type Interval = "monthly" | "yearly"
type PaymentMethod = "card" | "bank_transfer"

function formatCurrency(amountCents: number, currency: string) {
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

export function FlutterwaveCheckoutModal(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  organizationId: string
  purpose?: "subscription" | "instance" | "topup" | "invoice"
  invoiceId?: string
  planSlug?: "starter" | "pro"
  planName?: string
  fixedAmountCents?: number
  fixedCurrency?: string
}) {
  const { open, onOpenChange, organizationId, invoiceId, planSlug, planName } = props

  const [currency, setCurrency] = useState<Currency>("USD")
  const [interval, setInterval] = useState<Interval>("monthly")
  const [method, setMethod] = useState<PaymentMethod>("card")
  const [quote, setQuote] = useState<any>(null)
  const [acceptedInvoice, setAcceptedInvoice] = useState<any>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(Date.now())

  const utils = trpc.useUtils()
  const plansQuery = trpc.billing.getPlans.useQuery(undefined, {
    enabled: open && !!planSlug,
  })
  const providersQuery = trpc.billing.getPaymentProviders.useQuery(undefined, {
    enabled: open,
  })
  const invoiceDetail = trpc.billing.getInvoice.useQuery(
    { organizationId, invoiceId: invoiceId || "" },
    { enabled: open && !!invoiceId }
  )

  const createQuoteMutation = trpc.billing.createPlanQuote.useMutation()
  const acceptQuoteMutation = trpc.billing.acceptQuote.useMutation()
  const paymentMutation = trpc.billing.payInvoiceWithFlutterwave.useMutation()

  // Reset state on modal open / target changes
  useEffect(() => {
    if (open) {
      setQuote(null)
      setAcceptedInvoice(null)
      setError("")
      setCurrency((props.fixedCurrency?.toUpperCase() as Currency) || "USD")
      setMethod("card")
      setBusy(false)
    }
  }, [open, invoiceId, planSlug, props.fixedCurrency])

  // Live timer for quote expiration
  useEffect(() => {
    if (!open) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [open])

  const targetInvoice = acceptedInvoice || invoiceDetail.data
  const selectedPlan = plansQuery.data?.find((p) => p.slug === planSlug)
  const configuredPrice = selectedPlan?.prices?.[currency]?.[interval]

  const activeCurrency = (
    targetInvoice?.currency ||
    quote?.currency ||
    currency
  ).toUpperCase()

  const remainingBalance = targetInvoice
    ? Math.max(
        (targetInvoice.amountDueCents || 0) -
          (targetInvoice.amountPaidCents || 0),
        0
      )
    : quote?.totalCents ?? configuredPrice ?? 0

  const lineItems = targetInvoice?.lineItems || quote?.lineItems || []
  const quoteExpiresAt = quote?.validUntil
    ? new Date(quote.validUntil).getTime()
    : null
  const isQuoteExpired =
    quote && !targetInvoice && quoteExpiresAt !== null && quoteExpiresAt <= now

  const secondsLeft = quoteExpiresAt
    ? Math.max(0, Math.floor((quoteExpiresAt - now) / 1000))
    : null

  const isReviewing = !!quote || !!invoiceId
  const isFlutterwaveUnavailable =
    providersQuery.isError ||
    (providersQuery.data && !providersQuery.data.flutterwave)

  async function handleCreateQuote() {
    if (!planSlug) return
    setBusy(true)
    setError("")
    try {
      const created = await createQuoteMutation.mutateAsync({
        organizationId,
        planSlug,
        currency,
        interval,
      })
      setQuote(created)
      await utils.billing.listQuotes.invalidate()
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Unable to prepare quote. Please try again."
      )
    } finally {
      setBusy(false)
    }
  }

  async function handlePay() {
    setBusy(true)
    setError("")
    try {
      let invoiceToPay = targetInvoice

      // Step: accept quote first if not yet accepted
      if (!invoiceToPay && quote) {
        invoiceToPay = await acceptQuoteMutation.mutateAsync({
          organizationId,
          quoteId: quote.id,
        })
        setAcceptedInvoice(invoiceToPay)
        await utils.billing.invalidate()
      }

      if (!invoiceToPay) {
        throw new Error("Please select a plan and generate a quote first.")
      }

      const activeMethod: PaymentMethod =
        activeCurrency === "USD" ? "card" : method

      const result = await paymentMutation.mutateAsync({
        organizationId,
        invoiceId: invoiceToPay.id,
        paymentMethod: activeMethod,
      })

      const action = result.nextAction as any
      const url = action?.redirect_url?.url || action?.redirect_url

      if (typeof url !== "string" || !url) {
        throw new Error(
          "Payment checkout session could not be established. Please check your billing dashboard or try again."
        )
      }

      // Ensure valid URL destination
      try {
        const dest = new URL(url)
        if (
          dest.protocol !== "https:" ||
          (!dest.hostname.endsWith("flutterwave.com") &&
            !dest.hostname.includes("flutterwave"))
        ) {
          throw new Error("Checkout destination is invalid. Please contact support.")
        }
      } catch (err: any) {
        if (err?.message?.includes("destination is invalid")) throw err
      }

      window.location.assign(url)
    } catch (e: any) {
      setError(
        e?.message ||
          "Could not open Flutterwave checkout. Please verify details and try again."
      )
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!busy) onOpenChange(value)
      }}
    >
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg p-0 gap-0 border-border/80 shadow-2xl">
        {/* Header */}
        <div className="p-6 border-b bg-muted/20">
          <div className="flex items-center justify-between gap-3 mb-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <FileText className="h-5 w-5" />
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span
                className={`flex h-6 items-center px-2 rounded-full font-medium ${
                  !isReviewing
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                1. Plan
              </span>
              <span>→</span>
              <span
                className={`flex h-6 items-center px-2 rounded-full font-medium ${
                  isReviewing
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                2. Review & Pay
              </span>
            </div>
          </div>

          <DialogHeader className="text-left">
            <DialogTitle className="text-xl font-semibold tracking-tight">
              {invoiceId
                ? "Pay Invoice"
                : isReviewing
                ? "Review & Confirm Quote"
                : `Choose ${planName || "Plan"} Billing`}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground mt-1">
              {invoiceId
                ? "Review invoice details and continue to secure payment."
                : isReviewing
                ? "Locked-in price for 30 minutes. Proceed to Flutterwave hosted checkout."
                : "Select your preferred currency and billing cycle to generate a quote."}
            </DialogDescription>
          </DialogHeader>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-5">
          {/* STEP 1: Configure Plan (When not reviewing existing quote/invoice) */}
          {!isReviewing && planSlug && (
            <div className="space-y-4">
              {/* Currency & Interval Selectors */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">
                    Currency
                  </label>
                  <select
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value as Currency)}
                    className="h-10 w-full rounded-lg border bg-background px-3 text-sm font-medium focus:ring-2 focus:ring-primary focus:outline-none"
                  >
                    <option value="USD">USD ($ - US Dollar)</option>
                    <option value="NGN">NGN (₦ - Nigerian Naira)</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">
                    Billing Cycle
                  </label>
                  <select
                    value={interval}
                    onChange={(e) => setInterval(e.target.value as Interval)}
                    className="h-10 w-full rounded-lg border bg-background px-3 text-sm font-medium focus:ring-2 focus:ring-primary focus:outline-none"
                  >
                    <option value="monthly">Monthly</option>
                    <option value="yearly">Yearly (2 Months Free)</option>
                  </select>
                </div>
              </div>

              {/* Price Preview Card */}
              {plansQuery.isLoading ? (
                <div className="flex items-center justify-center p-8 rounded-xl border bg-muted/20">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground mr-2" />
                  <span className="text-sm text-muted-foreground">Loading pricing details…</span>
                </div>
              ) : configuredPrice == null ? (
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-700 dark:text-amber-400">
                  <p className="font-medium">Pricing unavailable</p>
                  <p className="text-xs mt-1 text-muted-foreground">
                    {currency} pricing is not configured for this plan yet. Switch to USD or contact support.
                  </p>
                </div>
              ) : (
                <div className="rounded-xl border bg-card p-4 space-y-2">
                  <div className="flex items-baseline justify-between">
                    <div>
                      <h4 className="text-sm font-semibold">{planName} Plan</h4>
                      <p className="text-xs text-muted-foreground capitalize">
                        {interval} billing {interval === "yearly" ? "• 2 months included free" : ""}
                      </p>
                    </div>
                    <div className="text-right">
                      <span className="text-2xl font-bold tracking-tight">
                        {formatCurrency(configuredPrice, currency)}
                      </span>
                      <span className="text-xs text-muted-foreground ml-1">
                        /{interval === "yearly" ? "yr" : "mo"}
                      </span>
                    </div>
                  </div>

                  {interval === "yearly" && (
                    <div className="inline-flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                      <Sparkles className="h-3.5 w-3.5" />
                      Annual savings discount applied automatically
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Loading invoice */}
          {invoiceId && invoiceDetail.isLoading && (
            <div className="flex items-center justify-center p-8 rounded-xl border bg-muted/20">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground mr-2" />
              <span className="text-sm text-muted-foreground">Loading invoice details…</span>
            </div>
          )}

          {/* STEP 2: Review Quote or Invoice */}
          {isReviewing && (targetInvoice || quote) && (
            <div className="space-y-4">
              <div className="rounded-xl border bg-muted/10 p-4 space-y-3">
                <div className="flex items-center justify-between border-b pb-2.5">
                  <span className="font-mono text-xs font-semibold text-muted-foreground">
                    {targetInvoice?.number || quote?.number}
                  </span>
                  <div className="flex items-center gap-2">
                    {quote && !targetInvoice && secondsLeft !== null && (
                      <Badge
                        variant="secondary"
                        className={`text-xs gap-1 font-mono ${
                          isQuoteExpired
                            ? "bg-red-500/10 text-red-600"
                            : "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                        }`}
                      >
                        <Clock className="h-3 w-3" />
                        {isQuoteExpired
                          ? "Expired"
                          : `Expires in ${Math.floor(secondsLeft / 60)}:${String(
                              secondsLeft % 60
                            ).padStart(2, "0")}`}
                      </Badge>
                    )}
                    {targetInvoice && (
                      <Badge variant="outline" className="text-xs uppercase">
                        {targetInvoice.status}
                      </Badge>
                    )}
                  </div>
                </div>

                {/* Line items */}
                <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                  {lineItems.map((line: any) => (
                    <div
                      key={line.id || line.description}
                      className="flex items-start justify-between gap-4 text-xs"
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-foreground truncate">
                          {line.description}
                        </p>
                        <p className="text-muted-foreground">
                          Qty {line.quantity} × {formatCurrency(line.unitAmountCents, activeCurrency)}
                        </p>
                      </div>
                      <span className="font-medium tabular-nums shrink-0">
                        {formatCurrency(line.totalCents, activeCurrency)}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Total Balance */}
                <div className="border-t pt-3 flex items-center justify-between">
                  <div>
                    <span className="text-sm font-semibold">
                      {targetInvoice ? "Amount Due" : "Total Due"}
                    </span>
                    <p className="text-xs text-muted-foreground">
                      Billed in {activeCurrency}
                    </p>
                  </div>
                  <span className="text-2xl font-bold tracking-tight tabular-nums">
                    {formatCurrency(remainingBalance, activeCurrency)}
                  </span>
                </div>
              </div>

              {/* Payment Method Selector */}
              {remainingBalance > 0 && (
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
                    Select Payment Method
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setMethod("card")}
                      className={`p-3 rounded-xl border text-left transition-all ${
                        method === "card"
                          ? "border-primary bg-primary/5 ring-1 ring-primary"
                          : "hover:bg-muted/50 border-border"
                      }`}
                    >
                      <CreditCard className="h-5 w-5 mb-1.5 text-primary" />
                      <p className="text-sm font-semibold">Debit / Credit Card</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Visa, Mastercard, Verve
                      </p>
                    </button>

                    {activeCurrency === "NGN" ? (
                      <button
                        type="button"
                        onClick={() => setMethod("bank_transfer")}
                        className={`p-3 rounded-xl border text-left transition-all ${
                          method === "bank_transfer"
                            ? "border-primary bg-primary/5 ring-1 ring-primary"
                            : "hover:bg-muted/50 border-border"
                        }`}
                      >
                        <Building2 className="h-5 w-5 mb-1.5 text-primary" />
                        <p className="text-sm font-semibold">Bank Transfer</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Virtual account via Flutterwave
                        </p>
                      </button>
                    ) : (
                      <div className="p-3 rounded-xl border border-dashed text-left opacity-50 cursor-not-allowed">
                        <Building2 className="h-5 w-5 mb-1.5 text-muted-foreground" />
                        <p className="text-sm font-medium">Bank Transfer</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Available for NGN currency
                        </p>
                      </div>
                    )}
                  </div>

                  <p className="text-xs text-muted-foreground mt-1">
                    {method === "bank_transfer"
                      ? "A dedicated Nigerian bank account number will be generated on the checkout page for instant transfer."
                      : "You will be redirected to Flutterwave's secure hosted payment page to complete your payment."}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Error Message */}
          {(error || invoiceDetail.error || plansQuery.error) && (
            <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-3.5 flex items-start gap-2.5 text-sm text-red-600 dark:text-red-400">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <div className="flex-1">
                <p className="font-medium text-xs">Payment issue encountered</p>
                <p className="text-xs mt-0.5">
                  {error || invoiceDetail.error?.message || plansQuery.error?.message}
                </p>
              </div>
            </div>
          )}

          {/* Expired Quote Warning */}
          {isQuoteExpired && (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 flex items-center justify-between text-xs text-amber-700 dark:text-amber-400">
              <span>This quote has expired. Generate a fresh quote to proceed.</span>
              <Button
                size="sm"
                variant="outline"
                onClick={handleCreateQuote}
                disabled={busy}
                className="h-7 text-xs gap-1"
              >
                <RotateCcw className="h-3 w-3" />
                Refresh
              </Button>
            </div>
          )}

          {/* Availability Alert */}
          {isFlutterwaveUnavailable && (
            <p className="text-xs text-muted-foreground">
              Payment gateway is temporarily unavailable. Please try again in a few moments.
            </p>
          )}

          {/* Action Buttons */}
          <div className="space-y-2 pt-2">
            {isReviewing ? (
              <div className="flex gap-2">
                {quote && !targetInvoice && (
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      setQuote(null)
                      setError("")
                    }}
                    className="flex-1"
                  >
                    Back to options
                  </Button>
                )}
                <Button
                  className="flex-[2] h-10 font-medium"
                  disabled={
                    busy ||
                    isFlutterwaveUnavailable ||
                    !!isQuoteExpired ||
                    !(remainingBalance > 0) ||
                    (invoiceId ? !targetInvoice : !quote)
                  }
                  onClick={handlePay}
                >
                  {busy ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Connecting to Checkout…
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="mr-2 h-4 w-4" />
                      {remainingBalance === 0
                        ? "Paid in Full"
                        : targetInvoice
                        ? "Continue to Payment"
                        : "Accept Quote & Pay"}
                    </>
                  )}
                </Button>
              </div>
            ) : (
              <Button
                className="w-full h-10 font-medium"
                disabled={busy || !configuredPrice || !planSlug || plansQuery.isError}
                onClick={handleCreateQuote}
              >
                {busy ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Preparing Quote…
                  </>
                ) : (
                  <>
                    Continue to Review
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>
            )}

            <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground pt-1">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
              <span>Secured by Flutterwave • Automatic receipt on settlement</span>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
