"use client"

import { useEffect, useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { trpc } from "@/components/trpc-provider"
import { Loader2, CreditCard, Building2, ArrowRight, ShieldCheck, FileText, CheckCircle2 } from "lucide-react"

type Currency = "NGN" | "USD"
const money = (amount: number, currency: string) => new Intl.NumberFormat("en-NG", { style: "currency", currency }).format(amount / 100)

export function FlutterwaveCheckoutModal(props: {
  open: boolean; onOpenChange: (open: boolean) => void; organizationId: string
  purpose?: "subscription" | "instance" | "topup" | "invoice"; invoiceId?: string
  planSlug?: "starter" | "pro"; planName?: string; fixedAmountCents?: number; fixedCurrency?: string
}) {
  const { open, onOpenChange, organizationId, invoiceId, planSlug, planName } = props
  const [currency, setCurrency] = useState<Currency>("USD")
  const [interval, setInterval] = useState<"monthly" | "yearly">("monthly")
  const [method, setMethod] = useState<"card" | "bank_transfer">("card")
  const [quote, setQuote] = useState<any>(null)
  const [acceptedInvoice, setAcceptedInvoice] = useState<any>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(Date.now())
  const utils = trpc.useUtils()
  const plans = trpc.billing.getPlans.useQuery(undefined, { enabled: open && !!planSlug })
  const providers = trpc.billing.getPaymentProviders.useQuery(undefined, { enabled: open })
  const detail = trpc.billing.getInvoice.useQuery({ organizationId, invoiceId: invoiceId || "" }, { enabled: open && !!invoiceId })
  const createQuote = trpc.billing.createPlanQuote.useMutation()
  const accept = trpc.billing.acceptQuote.useMutation()
  const payment = trpc.billing.payInvoiceWithFlutterwave.useMutation()
  useEffect(() => {
    if (open) { setQuote(null); setAcceptedInvoice(null); setError(""); setCurrency((props.fixedCurrency?.toUpperCase() as Currency) || "USD"); setMethod("card") }
  }, [open, invoiceId, planSlug, props.fixedCurrency])
  useEffect(() => { if (!open) return; const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [open])
  const invoice = acceptedInvoice || detail.data
  const plan = plans.data?.find(p => p.slug === planSlug)
  const price = plan?.prices[currency]?.[interval]
  const code = (invoice?.currency || quote?.currency || currency).toUpperCase()
  const total = invoice ? Math.max(invoice.amountDueCents - invoice.amountPaidCents, 0) : quote?.totalCents ?? price
  const lines = invoice?.lineItems || quote?.lineItems || []
  const expired = quote && !invoice && new Date(quote.validUntil).getTime() <= now
  const reviewing = !!quote || !!invoiceId
  const unavailable = providers.isError || !providers.data?.flutterwave
  async function review() {
    if (!planSlug) return
    setBusy(true); setError("")
    try { setQuote(await createQuote.mutateAsync({ organizationId, planSlug, currency, interval })); await utils.billing.listQuotes.invalidate() }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to prepare your quote. Please try again.") }
    finally { setBusy(false) }
  }
  async function pay() {
    setBusy(true); setError("")
    try {
      let target = invoice
      if (!target && quote) { target = await accept.mutateAsync({ organizationId, quoteId: quote.id }); setAcceptedInvoice(target); await utils.billing.invalidate() }
      if (!target) throw new Error("Choose a plan and review your quote first.")
      const result = await payment.mutateAsync({ organizationId, invoiceId: target.id, paymentMethod: code === "USD" ? "card" : method })
      const action = result.nextAction as any
      const url = action?.redirect_url?.url || action?.redirect_url
      if (typeof url !== "string") throw new Error("Your payment is pending. Check payment activity before trying again.")
      const destination = new URL(url)
      if (destination.protocol !== "https:" || !(destination.hostname === "flutterwave.com" || destination.hostname.endsWith(".flutterwave.com"))) throw new Error("Checkout returned an unexpected destination. Please contact support.")
      window.location.assign(url)
    } catch (e) { setError(e instanceof Error ? e.message : "Could not open checkout. Please try again."); setBusy(false) }
  }
  return <Dialog open={open} onOpenChange={value => { if (!busy) onOpenChange(value) }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
      <DialogHeader>
        <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary"><FileText className="h-5 w-5" /></div>
        <DialogTitle className="text-2xl tracking-tight">{invoiceId ? "Pay your invoice" : reviewing ? "Your quote, ready to review" : `Choose your ${planName || "plan"} billing`}</DialogTitle>
        <DialogDescription>{reviewing ? "Review the total before continuing to secure checkout." : "Choose a currency and billing period. Your quote locks the price for 30 minutes."}</DialogDescription>
      </DialogHeader>
      <div className="space-y-5">
        {!reviewing && planSlug && <>
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-2 text-sm font-medium">Currency<select aria-label="Billing currency" value={currency} onChange={e => setCurrency(e.target.value as Currency)} className="h-11 w-full rounded-lg border bg-background px-3"><option value="USD">USD · US Dollar</option><option value="NGN">NGN · Nigerian Naira</option></select></label>
            <label className="space-y-2 text-sm font-medium">Billing period<select aria-label="Billing period" value={interval} onChange={e => setInterval(e.target.value as typeof interval)} className="h-11 w-full rounded-lg border bg-background px-3"><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select></label>
          </div>
          {plans.isLoading ? <p role="status">Loading prices…</p> : price == null ? <p className="rounded-lg bg-muted p-4 text-sm">{currency} pricing is not available yet. Choose USD or contact support for a quote.</p> : <div className="rounded-xl border bg-muted/30 p-5"><p className="text-sm text-muted-foreground">{planName} · {interval === "yearly" ? "12 months" : "1 month"}</p><p className="mt-2 text-3xl font-semibold tracking-tight tabular-nums">{money(price, currency)}</p><p className="mt-2 text-xs text-muted-foreground">{interval === "yearly" ? "Full annual amount due at checkout." : "One month of service."} Renewal requires a new payment.</p></div>}
        </>}
        {invoiceId && detail.isLoading && <p role="status">Loading invoice…</p>}
        {reviewing && (invoice || quote) && <div className="rounded-xl border bg-muted/20 p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"><span className="font-mono">{invoice?.number || quote.number}</span><span>{invoice ? "Invoice" : `Valid until ${new Date(quote.validUntil).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}</span></div>
          <div className="space-y-3">{lines.map((line: any) => <div key={line.id} className="flex items-start justify-between gap-4 text-sm"><div><p className="font-medium">{line.description}</p><p className="text-xs text-muted-foreground">{line.quantity} × {money(line.unitAmountCents, code)}</p></div><span className="shrink-0 tabular-nums">{money(line.totalCents, code)}</span></div>)}</div>
          <div className="mt-5 flex items-center justify-between border-t pt-4"><span className="text-sm font-medium">{invoice ? "Remaining balance" : "Total due"}</span><span className="text-2xl font-semibold tabular-nums">{money(total || 0, code)}</span></div>
          <p className="mt-3 text-xs text-muted-foreground">Charged in {code}. Review any provider or card-issuer fees before confirming payment.</p>
        </div>}
        {reviewing && total > 0 && <fieldset className="space-y-2"><legend className="mb-2 text-sm font-medium">How would you like to pay?</legend><div className="grid grid-cols-2 gap-2">{([{ id: "card", title: "Card", hint: "Secure hosted checkout", Icon: CreditCard }, ...(code === "NGN" ? [{ id: "bank_transfer", title: "Bank transfer", hint: "Account details at checkout", Icon: Building2 }] : [])] as const).map(item => <button type="button" key={item.id} aria-pressed={method === item.id} onClick={() => setMethod(item.id as typeof method)} className={`rounded-xl border p-4 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${method === item.id ? "border-primary bg-primary/5" : "hover:bg-muted"}`}><item.Icon className="mb-3 h-5 w-5" /><p className="text-sm font-medium">{item.title}</p><p className="mt-1 text-xs text-muted-foreground">{item.hint}</p></button>)}</div><p className="text-xs text-muted-foreground">{method === "bank_transfer" ? "Select bank transfer on Flutterwave, then transfer the exact amount before the account expires. Return here to see confirmation." : "Enter your card details on Flutterwave. GuildServer never receives your full card details."}</p></fieldset>}
        {(error || detail.error || plans.error) && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error || detail.error?.message || plans.error?.message}</p>}
        {expired && <p role="alert" className="text-sm text-amber-600">This quote has expired. Get a fresh quote to continue.</p>}
        {unavailable && <p role="status" className="text-sm text-muted-foreground">{providers.isLoading ? "Checking payment availability…" : "Checkout is temporarily unavailable. Your invoice remains saved."}</p>}
        {reviewing ? <div className="flex gap-2">{quote && !invoice && <Button variant="outline" disabled={busy} onClick={() => { setQuote(null); setError("") }}>Edit quote</Button>}<Button className="h-11 flex-1" disabled={busy || unavailable || !!expired || !(total > 0) || (invoiceId ? !invoice : !quote)} onClick={pay}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}{total === 0 ? "Paid" : busy ? "Preparing checkout…" : invoice ? "Continue to payment" : "Accept quote & continue"}</Button></div> : <Button className="h-11 w-full" disabled={busy || !price || !planSlug || plans.isError} onClick={review}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRight className="mr-2 h-4 w-4" />}Review quote</Button>}
        <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground"><CheckCircle2 className="h-3.5 w-3.5" /> Your receipt appears after payment verification.</p>
      </div>
    </DialogContent>
  </Dialog>
}
