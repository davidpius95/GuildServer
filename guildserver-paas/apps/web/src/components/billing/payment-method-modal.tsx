"use client"
import { ErrorState } from "@/components/error-state"

import { useState } from "react"
import { trpc } from "@/components/trpc-provider"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { CreditCard, Landmark, Wallet, Loader2, ArrowRight } from "lucide-react"
import { CryptoCheckoutPanel } from "./crypto-checkout-panel"

const FLUTTERWAVE_CURRENCIES = [
  { code: "NGN", label: "Nigerian Naira (₦)" },
  { code: "GHS", label: "Ghanaian Cedi (₵)" },
  { code: "KES", label: "Kenyan Shilling (KSh)" },
  { code: "ZAR", label: "South African Rand (R)" },
  { code: "USD", label: "US Dollar ($)" },
]

type Method = "stripe" | "flutterwave" | "crypto" | null

export function PaymentMethodModal({
  open,
  onOpenChange,
  organizationId,
  planSlug,
  billingInterval = "monthly",
  priceLabel,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  organizationId: string
  planSlug: "pro" | "enterprise"
  billingInterval?: "monthly" | "yearly"
  priceLabel: string
}) {
  const [method, setMethod] = useState<Method>(null)
  const [currency, setCurrency] = useState("NGN")
  const [chainId, setChainId] = useState<number | null>(null)
  const [tokenSymbol, setTokenSymbol] = useState<string | null>(null)

  const providersQuery = trpc.billing.getAvailablePaymentProviders.useQuery(undefined, { enabled: open })
  const stripeCheckout = trpc.billing.createCheckoutSession.useMutation({
    onSuccess: (data) => { window.location.href = data.url },
  })
  const flutterwaveCheckout = trpc.billing.createFlutterwaveSubscriptionCheckout.useMutation({
    onSuccess: (data) => { window.location.href = data.checkoutUrl },
  })

  const providers = providersQuery.data
  const cryptoOptions = providers?.crypto

  const reset = () => {
    setMethod(null)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upgrade to {planSlug === "pro" ? "Pro" : "Enterprise"}</DialogTitle>
          <DialogDescription>{priceLabel} — choose how you&apos;d like to pay.</DialogDescription>
        </DialogHeader>

        {providersQuery.isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !method ? (
          <div className="space-y-2">
            {providers?.stripe && (
              <MethodOption
                icon={<CreditCard className="h-5 w-5" />}
                title="Card"
                subtitle="Visa, Mastercard, Amex via Stripe"
                onClick={() => stripeCheckout.mutate({ organizationId, planSlug, billingInterval })}
                loading={stripeCheckout.isPending}
              />
            )}
            {providers?.flutterwave && (
              <MethodOption
                icon={<Landmark className="h-5 w-5" />}
                title="Card, Bank Transfer & Mobile Money"
                subtitle="Naira cards, bank transfer, USSD, mobile money — via Flutterwave"
                onClick={() => setMethod("flutterwave")}
              />
            )}
            {cryptoOptions && cryptoOptions.length > 0 && (
              <MethodOption
                icon={<Wallet className="h-5 w-5" />}
                title="Crypto Wallet"
                subtitle="Pay with USDC, USDT, ETH, and more via WalletConnect"
                onClick={() => setMethod("crypto")}
              />
            )}
            {!providers?.stripe && !providers?.flutterwave && !cryptoOptions && (
              <p className="text-sm text-muted-foreground text-center py-6">
                No payment methods are configured yet. Contact your administrator.
              </p>
            )}
          </div>
        ) : method === "flutterwave" ? (
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Currency</label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FLUTTERWAVE_CURRENCIES.map((c) => (
                    <SelectItem key={c.code} value={c.code}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              className="w-full"
              onClick={() =>
                flutterwaveCheckout.mutate({
                  organizationId,
                  planSlug,
                  billingInterval,
                  currency,
                  redirectUrl: `${window.location.origin}/dashboard/billing?checkout=success`,
                })
              }
              disabled={flutterwaveCheckout.isPending}
            >
              {flutterwaveCheckout.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Continue to payment <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
            {flutterwaveCheckout.error && (
              <ErrorState error={flutterwaveCheckout.error} compact />
            )}
            <button onClick={() => setMethod(null)} className="text-xs text-muted-foreground hover:underline">
              ← Back
            </button>
          </div>
        ) : method === "crypto" ? (
          <div className="space-y-4">
            {!chainId || !tokenSymbol ? (
              <div className="space-y-3">
                {cryptoOptions?.map((opt: any) => (
                  <div key={opt.chainId}>
                    <p className="text-xs font-medium text-muted-foreground mb-1.5">{opt.chainName}</p>
                    <div className="flex flex-wrap gap-2">
                      {opt.tokens.map((t: string) => (
                        <button
                          key={t}
                          onClick={() => { setChainId(opt.chainId); setTokenSymbol(t) }}
                          className="px-3 py-1.5 rounded-md border text-sm hover:border-primary hover:bg-primary/5"
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                <button onClick={() => setMethod(null)} className="text-xs text-muted-foreground hover:underline">
                  ← Back
                </button>
              </div>
            ) : (
              <>
                <CryptoCheckoutPanel
                  organizationId={organizationId}
                  planSlug={planSlug}
                  billingInterval={billingInterval}
                  chainId={chainId}
                  tokenSymbol={tokenSymbol}
                  onDone={() => { reset(); window.location.reload() }}
                />
                <button onClick={() => { setChainId(null); setTokenSymbol(null) }} className="text-xs text-muted-foreground hover:underline">
                  ← Choose a different token
                </button>
              </>
            )}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function MethodOption({
  icon,
  title,
  subtitle,
  onClick,
  loading,
}: {
  icon: React.ReactNode
  title: string
  subtitle: string
  onClick: () => void
  loading?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className={cn(
        "w-full flex items-center gap-3 p-4 rounded-lg border text-left transition-colors",
        "hover:border-primary hover:bg-primary/5 disabled:opacity-60"
      )}
    >
      <div className="text-primary">{loading ? <Loader2 className="h-5 w-5 animate-spin" /> : icon}</div>
      <div className="flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
      <ArrowRight className="h-4 w-4 text-muted-foreground" />
    </button>
  )
}
