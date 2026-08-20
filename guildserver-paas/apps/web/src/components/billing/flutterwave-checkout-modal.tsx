"use client"
import { ErrorState } from "@/components/error-state"

import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { trpc } from "@/components/trpc-provider"
import { Loader2, CreditCard, Building2, Smartphone, Hash } from "lucide-react"

type Method = "card" | "bank_transfer" | "mobile_money" | "ussd"

const METHODS: Array<{ id: Method; label: string; hint: string; Icon: typeof CreditCard }> = [
  { id: "card", label: "Card", hint: "Visa, Mastercard, Verve", Icon: CreditCard },
  { id: "bank_transfer", label: "Bank transfer", hint: "Pay from any bank account", Icon: Building2 },
  { id: "mobile_money", label: "Mobile money", hint: "MTN, Airtel, M-Pesa and more", Icon: Smartphone },
  { id: "ussd", label: "USSD", hint: "Dial a code on your phone", Icon: Hash },
]

// Currencies Flutterwave settles, with the sub-unit rule we apply client-side
// purely for display. The server is the authority on conversion.
const CURRENCIES = ["NGN", "USD", "GHS", "KES", "ZAR", "UGX", "TZS", "EUR", "GBP"]

export function FlutterwaveCheckoutModal({
  open,
  onOpenChange,
  organizationId,
  purpose = "topup",
  invoiceId,
  fixedAmountCents,
  fixedCurrency,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  organizationId: string
  purpose?: "subscription" | "instance" | "topup" | "invoice"
  invoiceId?: string
  fixedAmountCents?: number
  fixedCurrency?: string
}) {
  const [method, setMethod] = useState<Method | null>(null)
  const [amount, setAmount] = useState("")
  const [currency, setCurrency] = useState(fixedCurrency || "NGN")
  const [network, setNetwork] = useState("MTN")
  const [phone, setPhone] = useState("")
  const [result, setResult] = useState<any>(null)

  const providers = trpc.billing.getPaymentProviders.useQuery(undefined, { enabled: open })

  const charge = trpc.billing.createFlutterwaveCharge.useMutation({
    onSuccess: (data) => {
      setResult(data)
      // Card and USSD flows hand back a redirect the payer must complete.
      const redirect =
        (data?.nextAction as any)?.redirect_url ?? (data?.nextAction as any)?.url ?? null
      if (redirect) window.location.href = redirect
    },
  })
  const invoiceCharge = trpc.billing.payInvoiceWithFlutterwave.useMutation({
    onSuccess: (data) => {
      setResult(data)
      const redirect =
        (data?.nextAction as any)?.redirect_url ?? (data?.nextAction as any)?.url ?? null
      if (redirect) window.location.href = redirect
    },
  })

  // Amount is entered in major units; the API contract is minor units.
  const amountCents = (() => {
    if (fixedAmountCents) return fixedAmountCents
    const n = Number(amount)
    if (!Number.isFinite(n) || n <= 0) return 0
    return Math.round(n * 100)
  })()

  const canSubmit =
    !!method &&
    amountCents > 0 &&
    (method !== "mobile_money" || (network.trim() !== "" && phone.trim() !== "")) &&
    !charge.isPending &&
    !invoiceCharge.isPending

  function submit() {
    if (!method) return
    const redirectUrl = typeof window !== "undefined" ? `${window.location.origin}/dashboard/billing` : undefined
    const mobileMoney = method === "mobile_money"
      ? { mobileMoney: { network, phoneNumber: phone, countryCode: currency === "GHS" ? "GH" : "NG" } }
      : {}

    if (invoiceId) {
      invoiceCharge.mutate({
        organizationId,
        invoiceId,
        paymentMethod: method,
        redirectUrl,
        ...mobileMoney,
      })
      return
    }

    charge.mutate({
      organizationId,
      amountCents,
      currency,
      purpose,
      paymentMethod: method,
      redirectUrl,
      ...mobileMoney,
    })
  }

  const unavailable = providers.data && !providers.data.flutterwave

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{invoiceId ? "Pay invoice" : "Add funds"}</DialogTitle>
          <DialogDescription>Pay by card, bank transfer, mobile money, or USSD.</DialogDescription>
        </DialogHeader>

        {unavailable ? (
          <p className="text-sm text-muted-foreground">
            Payments are not configured for this environment yet.
          </p>
        ) : result && !charge.isPending ? (
          // Bank transfer and USSD return details to act on rather than a redirect.
          <div className="space-y-3 text-sm">
            <p className="font-medium">Payment started</p>
            <p className="text-muted-foreground">
              Reference <span className="font-mono">{result.reference}</span>
            </p>
            <pre className="max-h-56 overflow-auto rounded-md bg-muted p-3 text-xs">
              {JSON.stringify(result.nextAction ?? { status: result.status }, null, 2)}
            </pre>
            <Button variant="outline" className="w-full" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              {METHODS.map(({ id, label, hint, Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setMethod(id)}
                  className={`rounded-lg border p-3 text-left transition ${
                    method === id ? "border-primary ring-1 ring-primary" : "hover:bg-muted/50"
                  }`}
                >
                  <Icon className="mb-1 h-4 w-4" />
                  <div className="text-sm font-medium">{label}</div>
                  <div className="text-xs text-muted-foreground">{hint}</div>
                </button>
              ))}
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2">
                <Label htmlFor="flw-amount">Amount</Label>
                {fixedAmountCents ? (
                  <div className="flex h-10 items-center rounded-md border bg-muted px-3 text-sm font-medium">
                    {(fixedAmountCents / 100).toFixed(2)}
                  </div>
                ) : (
                  <Input
                    id="flw-amount"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                )}
              </div>
              <div>
                <Label htmlFor="flw-currency">Currency</Label>
                <select
                  id="flw-currency"
                  className="h-10 w-full rounded-md border bg-background px-2 text-sm"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  disabled={!!fixedCurrency}
                >
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {method === "mobile_money" && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label htmlFor="flw-network">Network</Label>
                  <Input id="flw-network" value={network} onChange={(e) => setNetwork(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="flw-phone">Phone number</Label>
                  <Input
                    id="flw-phone"
                    inputMode="tel"
                    placeholder="080..."
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </div>
              </div>
            )}

            {(charge.error || invoiceCharge.error) && <ErrorState error={charge.error || invoiceCharge.error} compact />}

            <Button className="w-full" disabled={!canSubmit} onClick={submit}>
              {(charge.isPending || invoiceCharge.isPending) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {amountCents > 0 ? `Pay ${currency} ${(amountCents / 100).toFixed(2)}` : "Continue"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
