"use client"

import { useState } from "react"
import { trpc } from "@/components/trpc-provider"
import { useOrganization } from "@/hooks/use-auth"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  CreditCard,
  Zap,
  BarChart3,
  FileText,
  Settings2,
  Loader2,
  ArrowUpRight,
  Check,
  Crown,
  Sparkles,
  HardDrive,
  Clock,
  Globe,
  Database,
  Rocket,
} from "lucide-react"

type Tab = "overview" | "plans" | "invoices" | "payment" | "spend"

export default function BillingPage() {
  const [activeTab, setActiveTab] = useState<Tab>("overview")
  const { currentOrg, orgId, isLoading: orgLoading } = useOrganization()

  const plansQuery = trpc.billing.getPlans.useQuery()
  const currentPlanQuery = trpc.billing.getCurrentPlan.useQuery(
    { organizationId: orgId },
    { enabled: !!orgId }
  )
  const usageQuery = trpc.billing.getUsage.useQuery(
    { organizationId: orgId },
    { enabled: !!orgId }
  )
  const invoicesQuery = trpc.billing.getInvoices.useQuery(
    { organizationId: orgId, limit: 20 },
    { enabled: !!orgId && activeTab === "invoices" }
  )
  const paymentMethodsQuery = trpc.billing.getPaymentMethods.useQuery(
    { organizationId: orgId },
    { enabled: !!orgId && activeTab === "payment" }
  )

  if (orgLoading || currentPlanQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const currentPlan = currentPlanQuery.data?.plan
  const subscription = currentPlanQuery.data?.subscription
  const usage = usageQuery.data?.metrics

  const tabs: { id: Tab; label: string; icon: any }[] = [
    { id: "overview", label: "Overview", icon: BarChart3 },
    { id: "plans", label: "Plans", icon: Crown },
    { id: "invoices", label: "Invoices", icon: FileText },
    { id: "payment", label: "Payment", icon: CreditCard },
    { id: "spend", label: "Spend", icon: Settings2 },
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold">Billing</h1>
        <p className="text-muted-foreground mt-1">
          Manage your subscription, usage, and payment methods.
        </p>
      </div>

      {/* Tabs */}
      <div className="border-b">
        <nav className="flex gap-4">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex items-center gap-2 px-1 py-3 text-sm font-medium border-b-2 transition-colors",
                activeTab === tab.id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === "overview" && (
        <OverviewTab
          currentPlan={currentPlan}
          subscription={subscription}
          usage={usage}
          orgId={orgId}
          onUpgrade={() => setActiveTab("plans")}
        />
      )}
      {activeTab === "plans" && (
        <PlansTab
          plans={plansQuery.data || []}
          currentSlug={currentPlan?.slug || "hobby"}
          orgId={orgId}
        />
      )}
      {activeTab === "invoices" && (
        <InvoicesTab invoices={invoicesQuery.data || []} isLoading={invoicesQuery.isLoading} />
      )}
      {activeTab === "payment" && (
        <PaymentTab
          methods={paymentMethodsQuery.data || []}
          isLoading={paymentMethodsQuery.isLoading}
          orgId={orgId}
        />
      )}
      {activeTab === "spend" && (
        <SpendTab
          subscription={subscription}
          currentPlan={currentPlan}
          orgId={orgId}
          onUpgrade={() => setActiveTab("plans")}
        />
      )}
    </div>
  )
}

// =====================
// OVERVIEW TAB
// =====================

function OverviewTab({
  currentPlan,
  subscription,
  usage,
  orgId,
  onUpgrade,
}: {
  currentPlan: any
  subscription: any
  usage: any
  orgId: string
  onUpgrade: () => void
}) {
  const cancelMutation = trpc.billing.cancelSubscription.useMutation({
    onSuccess: () => window.location.reload(),
  })
  const resumeMutation = trpc.billing.resumeSubscription.useMutation({
    onSuccess: () => window.location.reload(),
  })
  const portalMutation = trpc.billing.createPortalSession.useMutation({
    onSuccess: (data) => { window.location.href = data.url },
  })

  const isPaid = currentPlan?.slug === "pro" || currentPlan?.slug === "enterprise"
  const isCanceling = subscription?.cancelAtPeriodEnd

  return (
    <div className="grid gap-6 md:grid-cols-2">
      {/* Current Plan Card */}
      <div className="rounded-xl border bg-card p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Current Plan</h3>
          <PlanBadge slug={currentPlan?.slug || "hobby"} />
        </div>
        <div className="space-y-3">
          <div>
            <p className="text-3xl font-bold">
              {currentPlan?.priceMonthly === 0
                ? "Free"
                : currentPlan?.priceMonthly
                ? `$${(currentPlan.priceMonthly / 100).toFixed(0)}`
                : "Custom"}
              {currentPlan?.priceMonthly > 0 && (
                <span className="text-base font-normal text-muted-foreground">
                  /seat/month
                </span>
              )}
            </p>
          </div>
          {subscription?.currentPeriodEnd && (
            <p className="text-sm text-muted-foreground">
              {subscription.cancelAtPeriodEnd
                ? "Cancels on "
                : "Renews on "}
              {new Date(subscription.currentPeriodEnd).toLocaleDateString()}
            </p>
          )}
          {subscription?.status === "trialing" && subscription.trialEnd && (
            <p className="text-sm text-amber-600">
              Trial ends {new Date(subscription.trialEnd).toLocaleDateString()}
            </p>
          )}
        </div>

        {/* Action buttons */}
        <div className="mt-4 flex flex-wrap gap-2">
          {currentPlan?.slug === "hobby" && (
            <Button size="sm" onClick={onUpgrade}>
              <Sparkles className="h-4 w-4 mr-1" />
              Upgrade to Pro
            </Button>
          )}
          {isPaid && !isCanceling && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => portalMutation.mutate({ organizationId: orgId })}
                disabled={portalMutation.isPending}
              >
                {portalMutation.isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                Manage Billing
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950"
                onClick={() => cancelMutation.mutate({ organizationId: orgId })}
                disabled={cancelMutation.isPending}
              >
                {cancelMutation.isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                Cancel Plan
              </Button>
            </>
          )}
          {isPaid && isCanceling && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => resumeMutation.mutate({ organizationId: orgId })}
              disabled={resumeMutation.isPending}
            >
              {resumeMutation.isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
              Resume Subscription
            </Button>
          )}
        </div>
        {(cancelMutation.error || resumeMutation.error || portalMutation.error) && (
          <p className="text-xs text-red-500 mt-2">
            {cancelMutation.error?.message || resumeMutation.error?.message || portalMutation.error?.message}
          </p>
        )}
      </div>

      {/* Quick Stats Card */}
      <div className="rounded-xl border bg-card p-6">
        <h3 className="text-lg font-semibold mb-4">Quick Stats</h3>
        <div className="grid grid-cols-2 gap-4">
          <StatItem
            label="Seats"
            value={subscription?.seats || 1}
            icon={<Crown className="h-4 w-4" />}
          />
          <StatItem
            label="Status"
            value={subscription?.status || "active"}
            icon={<Zap className="h-4 w-4" />}
          />
        </div>
      </div>

      {/* Usage Section */}
      <div className="md:col-span-2 rounded-xl border bg-card p-6">
        <h3 className="text-lg font-semibold mb-4">Usage This Period</h3>
        {usage ? (
          <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-5">
            <UsageBar
              label="Applications"
              current={usage.applications.current}
              limit={usage.applications.limit}
              icon={<Rocket className="h-4 w-4" />}
            />
            <UsageBar
              label="Databases"
              current={usage.databases.current}
              limit={usage.databases.limit}
              icon={<Database className="h-4 w-4" />}
            />
            <UsageBar
              label="Deployments"
              current={usage.deployments.current}
              limit={usage.deployments.limit}
              icon={<ArrowUpRight className="h-4 w-4" />}
            />
            <UsageBar
              label="Bandwidth"
              current={usage.bandwidth_gb.current}
              limit={usage.bandwidth_gb.limit}
              unit="GB"
              icon={<Globe className="h-4 w-4" />}
            />
            <UsageBar
              label="Build Minutes"
              current={usage.build_minutes.current}
              limit={usage.build_minutes.limit}
              unit="min"
              icon={<Clock className="h-4 w-4" />}
            />
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">No usage data available yet.</p>
        )}
      </div>
    </div>
  )
}

// =====================
// PLANS TAB
// =====================

function PlansTab({ plans, currentSlug, orgId }: { plans: any[]; currentSlug: string; orgId: string }) {
  const checkoutMutation = trpc.billing.createCheckoutSession.useMutation({
    onSuccess: (data) => {
      window.location.href = data.url
    },
  })
  const trialMutation = trpc.billing.startTrial.useMutation({
    onSuccess: () => {
      window.location.reload()
    },
  })

  return (
    <div className="grid gap-6 md:grid-cols-3">
      {plans.map((plan: any) => {
        const isCurrent = plan.slug === currentSlug
        const isUpgrade = plan.priceMonthly > 0 && (currentSlug === "hobby" || !currentSlug)

        return (
          <div
            key={plan.id}
            className={cn(
              "rounded-xl border bg-card p-6 relative",
              isCurrent && "ring-2 ring-primary"
            )}
          >
            {isCurrent && (
              <Badge className="absolute -top-3 left-4">Current Plan</Badge>
            )}
            <div className="mb-4">
              <h3 className="text-xl font-bold">{plan.name}</h3>
              <p className="text-sm text-muted-foreground mt-1">{plan.description}</p>
            </div>
            <div className="mb-6">
              <p className="text-3xl font-bold">
                {plan.priceMonthly === 0
                  ? "Free"
                  : plan.priceMonthly
                  ? `$${(plan.priceMonthly / 100).toFixed(0)}`
                  : "Custom"}
              </p>
              {plan.priceMonthly > 0 && (
                <p className="text-sm text-muted-foreground">/seat/month</p>
              )}
            </div>

            {/* Limits */}
            <div className="space-y-2 mb-6">
              <PlanLimit label="Applications" value={plan.limits?.maxApps} />
              <PlanLimit label="Databases" value={plan.limits?.maxDatabases} />
              <PlanLimit label="Deployments/mo" value={plan.limits?.maxDeployments} />
              <PlanLimit label="Bandwidth" value={plan.limits?.maxBandwidthGb} suffix="GB" />
              <PlanLimit label="Build Minutes" value={plan.limits?.maxBuildMinutes} suffix="min" />
              <PlanLimit label="Memory/App" value={plan.limits?.maxMemoryMb} suffix="MB" />
            </div>

            {/* Features */}
            <div className="space-y-2 border-t pt-4">
              <FeatureItem label="Preview Deployments" enabled={plan.features?.previewDeployments} />
              <FeatureItem label="Team Collaboration" enabled={plan.features?.teamCollaboration} />
              <FeatureItem label="Priority Support" enabled={plan.features?.prioritySupport} />
              <FeatureItem label="SSO / SAML" enabled={plan.features?.sso} />
              <FeatureItem label="Webhooks" enabled={plan.features?.webhooks} />
              <FeatureItem label="API Access" enabled={plan.features?.apiAccess} />
            </div>

            {/* Action Button */}
            <div className="mt-6 space-y-2">
              {isCurrent ? (
                <Button variant="outline" className="w-full" disabled>
                  Current Plan
                </Button>
              ) : plan.slug === "enterprise" ? (
                <Button variant="outline" className="w-full">
                  Contact Sales
                </Button>
              ) : plan.slug === "pro" && isUpgrade ? (
                <>
                  <Button
                    className="w-full"
                    onClick={() =>
                      checkoutMutation.mutate({
                        organizationId: orgId,
                        planSlug: "pro",
                        billingInterval: "monthly",
                      })
                    }
                    disabled={checkoutMutation.isPending}
                  >
                    {checkoutMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : null}
                    Upgrade to Pro — $20/mo
                  </Button>
                  {currentSlug === "hobby" && (
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={() =>
                        trialMutation.mutate({ organizationId: orgId })
                      }
                      disabled={trialMutation.isPending}
                    >
                      {trialMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <Sparkles className="h-4 w-4 mr-2" />
                      )}
                      Start 14-Day Free Trial
                    </Button>
                  )}
                </>
              ) : (
                <Button className="w-full" disabled>
                  {plan.priceMonthly > 0 ? "Upgrade" : "Downgrade"}
                </Button>
              )}
              {(checkoutMutation.error || trialMutation.error) && (
                <p className="text-xs text-red-500 text-center">
                  {checkoutMutation.error?.message || trialMutation.error?.message}
                </p>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// =====================
// INVOICES TAB
// =====================

function InvoicesTab({
  invoices,
  isLoading,
}: {
  invoices: any[]
  isLoading: boolean
}) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (invoices.length === 0) {
    return (
      <div className="rounded-xl border bg-card p-12 text-center">
        <FileText className="h-12 w-12 mx-auto text-muted-foreground/30 mb-4" />
        <h3 className="text-lg font-semibold mb-1">No invoices yet</h3>
        <p className="text-sm text-muted-foreground">
          Invoices will appear here once you upgrade to a paid plan.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="text-left text-sm font-medium px-4 py-3">Invoice</th>
            <th className="text-left text-sm font-medium px-4 py-3">Date</th>
            <th className="text-left text-sm font-medium px-4 py-3">Amount</th>
            <th className="text-left text-sm font-medium px-4 py-3">Status</th>
            <th className="text-right text-sm font-medium px-4 py-3">Actions</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((inv: any) => (
            <tr key={inv.id} className="border-b last:border-0">
              <td className="px-4 py-3 text-sm font-mono">{inv.number || "—"}</td>
              <td className="px-4 py-3 text-sm text-muted-foreground">
                {inv.createdAt ? new Date(inv.createdAt).toLocaleDateString() : "—"}
              </td>
              <td className="px-4 py-3 text-sm">
                ${((inv.amountDueCents || 0) / 100).toFixed(2)}
              </td>
              <td className="px-4 py-3">
                <InvoiceStatusBadge status={inv.status} />
              </td>
              <td className="px-4 py-3 text-right">
                {inv.invoiceUrl && (
                  <a
                    href={inv.invoiceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-primary hover:underline"
                  >
                    View
                  </a>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// =====================
// PAYMENT TAB
// =====================

function PaymentTab({
  methods,
  isLoading,
  orgId,
}: {
  methods: any[]
  isLoading: boolean
  orgId: string
}) {
  const portalMutation = trpc.billing.createPortalSession.useMutation({
    onSuccess: (data) => { window.location.href = data.url },
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border bg-card p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Payment Methods</h3>
          <Button
            size="sm"
            variant="outline"
            onClick={() => portalMutation.mutate({ organizationId: orgId })}
            disabled={portalMutation.isPending}
          >
            {portalMutation.isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
            Manage in Stripe
          </Button>
        </div>
        {methods.length === 0 ? (
          <div className="text-center py-8">
            <CreditCard className="h-12 w-12 mx-auto text-muted-foreground/30 mb-4" />
            <p className="text-sm text-muted-foreground mb-4">
              No payment method on file. Add one when upgrading to a paid plan.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {methods.map((pm: any) => (
              <div
                key={pm.id}
                className="flex items-center justify-between p-4 rounded-lg border"
              >
                <div className="flex items-center gap-3">
                  <CreditCard className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium capitalize">
                      {pm.cardBrand} ending in {pm.cardLast4}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Expires {pm.cardExpMonth}/{pm.cardExpYear}
                    </p>
                  </div>
                </div>
                {pm.isDefault && <Badge variant="secondary">Default</Badge>}
              </div>
            ))}
          </div>
        )}
        {portalMutation.error && (
          <p className="text-xs text-red-500 mt-2">{portalMutation.error.message}</p>
        )}
      </div>
    </div>
  )
}

// =====================
// SPEND TAB
// =====================

function SpendTab({
  subscription,
  currentPlan,
  orgId,
  onUpgrade,
}: {
  subscription: any
  currentPlan: any
  orgId: string
  onUpgrade: () => void
}) {
  const [spendInput, setSpendInput] = useState("")
  const [saved, setSaved] = useState(false)
  const isHobby = currentPlan?.slug === "hobby"

  const spendMutation = trpc.billing.setSpendLimit.useMutation({
    onSuccess: () => {
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    },
  })

  const handleSetLimit = () => {
    const dollars = parseFloat(spendInput)
    if (isNaN(dollars) || dollars < 0) return
    spendMutation.mutate({
      organizationId: orgId,
      spendLimitCents: dollars === 0 ? null : Math.round(dollars * 100),
    })
  }

  const handleRemoveLimit = () => {
    spendMutation.mutate({
      organizationId: orgId,
      spendLimitCents: null,
    })
    setSpendInput("")
  }

  if (isHobby) {
    return (
      <div className="rounded-xl border bg-card p-12 text-center">
        <Settings2 className="h-12 w-12 mx-auto text-muted-foreground/30 mb-4" />
        <h3 className="text-lg font-semibold mb-1">Spend Management</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Spend management is available on the Pro plan. The Hobby plan has hard limits with no overages.
        </p>
        <Button onClick={onUpgrade}>Upgrade to Pro</Button>
      </div>
    )
  }

  const currentLimit = subscription?.spendLimitCents
    ? (subscription.spendLimitCents / 100)
    : null

  return (
    <div className="space-y-6">
      <div className="rounded-xl border bg-card p-6">
        <h3 className="text-lg font-semibold mb-4">Spend Management</h3>
        <p className="text-sm text-muted-foreground mb-6">
          Set a monthly spending limit to control overage costs. You&apos;ll receive
          notifications at 50%, 75%, and 100% of your limit.
        </p>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Current Limit</span>
            <span className="text-sm font-mono">
              {currentLimit !== null ? `$${currentLimit.toFixed(2)}/mo` : "No limit (unlimited)"}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Usage Credit</span>
            <span className="text-sm font-mono">
              ${((subscription?.usageCreditCents || 0) / 100).toFixed(2)}/mo included
            </span>
          </div>

          {/* Set Limit Controls */}
          <div className="border-t pt-4 space-y-3">
            <label className="text-sm font-medium">Set Monthly Limit ($)</label>
            <div className="flex gap-2">
              <input
                type="number"
                min="0"
                step="5"
                placeholder={currentLimit ? String(currentLimit) : "e.g. 50"}
                value={spendInput}
                onChange={(e) => setSpendInput(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              <Button
                size="sm"
                onClick={handleSetLimit}
                disabled={spendMutation.isPending || !spendInput}
              >
                {spendMutation.isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                Set
              </Button>
              {currentLimit !== null && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleRemoveLimit}
                  disabled={spendMutation.isPending}
                >
                  Remove
                </Button>
              )}
            </div>
            {saved && (
              <p className="text-xs text-green-600">Spend limit updated successfully!</p>
            )}
            {spendMutation.error && (
              <p className="text-xs text-red-500">{spendMutation.error.message}</p>
            )}
          </div>

          {/* Notification Thresholds */}
          {currentLimit !== null && (
            <div className="border-t pt-4 space-y-2">
              <p className="text-sm font-medium">Alert Thresholds</p>
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 p-3 text-center">
                  <p className="text-lg font-bold text-amber-600">50%</p>
                  <p className="text-xs text-muted-foreground">${(currentLimit * 0.5).toFixed(0)}</p>
                </div>
                <div className="rounded-lg bg-orange-50 dark:bg-orange-950/30 p-3 text-center">
                  <p className="text-lg font-bold text-orange-600">75%</p>
                  <p className="text-xs text-muted-foreground">${(currentLimit * 0.75).toFixed(0)}</p>
                </div>
                <div className="rounded-lg bg-red-50 dark:bg-red-950/30 p-3 text-center">
                  <p className="text-lg font-bold text-red-600">100%</p>
                  <p className="text-xs text-muted-foreground">${currentLimit.toFixed(0)}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// =====================
// SHARED COMPONENTS
// =====================

function PlanBadge({ slug }: { slug: string }) {
  const colors: Record<string, string> = {
    hobby: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
    pro: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
    enterprise: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold capitalize",
        colors[slug] || colors.hobby
      )}
    >
      {slug === "pro" && <Sparkles className="h-3 w-3" />}
      {slug === "enterprise" && <Crown className="h-3 w-3" />}
      {slug}
    </span>
  )
}

function StatItem({
  label,
  value,
  icon,
}: {
  label: string
  value: string | number
  icon: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
      <div className="text-muted-foreground">{icon}</div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-semibold capitalize">{String(value)}</p>
      </div>
    </div>
  )
}

function UsageBar({
  label,
  current,
  limit,
  unit,
  icon,
}: {
  label: string
  current: number
  limit: number
  unit?: string
  icon: React.ReactNode
}) {
  const isUnlimited = limit === -1
  const percentage = isUnlimited ? 0 : limit > 0 ? Math.min((current / limit) * 100, 100) : 0
  const isNearLimit = percentage >= 80
  const isAtLimit = percentage >= 100

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">{icon}</span>
        <span className="text-sm font-medium">{label}</span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            isAtLimit
              ? "bg-red-500"
              : isNearLimit
              ? "bg-amber-500"
              : "bg-primary"
          )}
          style={{ width: isUnlimited ? "0%" : `${percentage}%` }}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {current}
        {unit ? ` ${unit}` : ""} /{" "}
        {isUnlimited ? "Unlimited" : `${limit}${unit ? ` ${unit}` : ""}`}
      </p>
    </div>
  )
}

function PlanLimit({
  label,
  value,
  suffix,
}: {
  label: string
  value: number | undefined
  suffix?: string
}) {
  const display =
    value === undefined
      ? "—"
      : value === -1
      ? "Unlimited"
      : `${value}${suffix ? ` ${suffix}` : ""}`

  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{display}</span>
    </div>
  )
}

function FeatureItem({ label, enabled }: { label: string; enabled: boolean }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <Check
        className={cn(
          "h-4 w-4",
          enabled ? "text-green-500" : "text-muted-foreground/30"
        )}
      />
      <span className={cn(!enabled && "text-muted-foreground")}>{label}</span>
    </div>
  )
}

function InvoiceStatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    paid: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
    open: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
    draft: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
    void: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
    uncollectible:
      "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
  }

  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize",
        colors[status] || colors.draft
      )}
    >
      {status}
    </span>
  )
}
