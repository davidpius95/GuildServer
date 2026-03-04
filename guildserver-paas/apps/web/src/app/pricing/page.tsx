"use client"

import { useState } from "react"
import Link from "next/link"
import { trpc } from "@/components/trpc-provider"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ThemeToggle } from "@/components/theme-toggle"
import { cn } from "@/lib/utils"
import {
  Check,
  X,
  Loader2,
  ArrowRight,
  Sparkles,
  Crown,
  Zap,
  HelpCircle,
  ChevronDown,
  ChevronUp,
} from "lucide-react"

export default function PricingPage() {
  const [billingInterval, setBillingInterval] = useState<"monthly" | "yearly">("monthly")
  const plansQuery = trpc.billing.getPlans.useQuery()

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Navigation */}
      <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
        <div className="main-container flex h-16 items-center justify-between">
          <div className="flex items-center gap-8">
            <Link href="/" className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-lg gradient-bg flex items-center justify-center">
                <span className="text-white font-bold text-sm">G</span>
              </div>
              <span className="text-xl font-bold tracking-tight">GuildServer</span>
            </Link>
            <nav className="hidden md:flex items-center gap-6 text-sm">
              <Link href="/#features" className="text-muted-foreground hover:text-foreground transition-colors">
                Features
              </Link>
              <Link href="/pricing" className="text-foreground font-medium transition-colors">
                Pricing
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <Link href="/auth/login" className="text-sm text-muted-foreground hover:text-foreground transition-colors hidden sm:block">
              Log In
            </Link>
            <Button asChild size="sm" className="gradient-bg border-0 text-white hover:opacity-90 transition-opacity">
              <Link href="/auth/register">
                Sign Up Free
              </Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="py-16 md:py-24 text-center">
        <div className="main-container">
          <Badge variant="secondary" className="mb-4">
            <Sparkles className="h-3 w-3 mr-1" />
            Simple, transparent pricing
          </Badge>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight mb-4">
            Start free, scale as you grow
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-10">
            Deploy personal projects for free, then upgrade to Pro when you need more power,
            more apps, and team collaboration.
          </p>

          {/* Billing Toggle */}
          <div className="flex items-center justify-center gap-4 mb-12">
            <button
              onClick={() => setBillingInterval("monthly")}
              className={cn(
                "text-sm font-medium px-4 py-2 rounded-lg transition-colors",
                billingInterval === "monthly"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Monthly
            </button>
            <button
              onClick={() => setBillingInterval("yearly")}
              className={cn(
                "text-sm font-medium px-4 py-2 rounded-lg transition-colors relative",
                billingInterval === "yearly"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Yearly
              <span className="absolute -top-2 -right-12 text-[10px] font-bold text-green-600 bg-green-100 dark:bg-green-900 dark:text-green-400 px-1.5 py-0.5 rounded-full">
                -17%
              </span>
            </button>
          </div>
        </div>
      </section>

      {/* Pricing Cards */}
      <section className="pb-20">
        <div className="main-container">
          {plansQuery.isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="grid gap-8 md:grid-cols-3 max-w-6xl mx-auto">
              {(plansQuery.data || []).map((plan: any) => (
                <PricingCard
                  key={plan.id}
                  plan={plan}
                  billingInterval={billingInterval}
                  featured={plan.slug === "pro"}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Feature Comparison Table */}
      <section className="py-20 border-t">
        <div className="main-container max-w-6xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-12">Compare Plans</h2>
          <ComparisonTable plans={plansQuery.data || []} />
        </div>
      </section>

      {/* FAQ */}
      <section className="py-20 border-t">
        <div className="main-container max-w-3xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-12">Frequently Asked Questions</h2>
          <FAQSection />
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 border-t">
        <div className="main-container text-center">
          <h2 className="text-3xl font-bold mb-4">Ready to get started?</h2>
          <p className="text-lg text-muted-foreground mb-8 max-w-xl mx-auto">
            Start deploying for free in minutes. No credit card required.
          </p>
          <div className="flex items-center justify-center gap-4">
            <Button asChild size="lg" className="gradient-bg border-0 text-white hover:opacity-90">
              <Link href="/auth/register">
                Get Started Free
                <ArrowRight className="h-4 w-4 ml-2" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/auth/register">
                Start Pro Trial
                <Sparkles className="h-4 w-4 ml-2" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t py-8">
        <div className="main-container flex items-center justify-between text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded gradient-bg flex items-center justify-center">
              <span className="text-white font-bold text-xs">G</span>
            </div>
            <span>GuildServer</span>
          </div>
          <div className="flex items-center gap-6">
            <Link href="/" className="hover:text-foreground transition-colors">Home</Link>
            <Link href="/pricing" className="hover:text-foreground transition-colors">Pricing</Link>
            <Link href="/auth/login" className="hover:text-foreground transition-colors">Log In</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}

// =====================
// PRICING CARD
// =====================

function PricingCard({
  plan,
  billingInterval,
  featured,
}: {
  plan: any
  billingInterval: "monthly" | "yearly"
  featured: boolean
}) {
  const price = billingInterval === "yearly" && plan.priceYearly
    ? plan.priceYearly
    : plan.priceMonthly

  const monthlyEquivalent = billingInterval === "yearly" && plan.priceYearly
    ? Math.round(plan.priceYearly / 12)
    : plan.priceMonthly

  const isEnterprise = plan.slug === "enterprise"
  const isHobby = plan.slug === "hobby"

  const icons: Record<string, any> = {
    hobby: Zap,
    pro: Sparkles,
    enterprise: Crown,
  }
  const Icon = icons[plan.slug] || Zap

  return (
    <div
      className={cn(
        "relative rounded-2xl border bg-card p-8 flex flex-col",
        featured && "ring-2 ring-primary shadow-lg scale-[1.02]"
      )}
    >
      {featured && (
        <div className="absolute -top-4 left-1/2 -translate-x-1/2">
          <Badge className="gradient-bg border-0 text-white px-4 py-1 text-sm">
            Most Popular
          </Badge>
        </div>
      )}

      <div className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          <Icon className="h-5 w-5 text-primary" />
          <h3 className="text-xl font-bold">{plan.name}</h3>
        </div>
        <p className="text-sm text-muted-foreground">{plan.description}</p>
      </div>

      <div className="mb-8">
        {isEnterprise ? (
          <div>
            <p className="text-4xl font-bold">Custom</p>
            <p className="text-sm text-muted-foreground mt-1">Contact us for pricing</p>
          </div>
        ) : (
          <div>
            <p className="text-4xl font-bold">
              ${((monthlyEquivalent || 0) / 100).toFixed(0)}
              <span className="text-lg font-normal text-muted-foreground">/mo</span>
            </p>
            {!isHobby && (
              <p className="text-sm text-muted-foreground mt-1">
                per seat{billingInterval === "yearly" ? ", billed annually" : ""}
                {billingInterval === "yearly" && plan.priceYearly && (
                  <span className="text-green-600 dark:text-green-400 ml-1">
                    (save ${((plan.priceMonthly * 12 - plan.priceYearly) / 100).toFixed(0)}/yr)
                  </span>
                )}
              </p>
            )}
            {isHobby && (
              <p className="text-sm text-muted-foreground mt-1">Free forever</p>
            )}
          </div>
        )}
      </div>

      {/* Key Limits */}
      <div className="space-y-3 mb-8 flex-1">
        <LimitRow label="Applications" value={plan.limits?.maxApps} />
        <LimitRow label="Databases" value={plan.limits?.maxDatabases} />
        <LimitRow label="Deployments/mo" value={plan.limits?.maxDeployments} />
        <LimitRow label="Bandwidth" value={plan.limits?.maxBandwidthGb} suffix="GB/mo" />
        <LimitRow label="Build Minutes" value={plan.limits?.maxBuildMinutes} suffix="min/mo" />
        <LimitRow label="Memory/App" value={plan.limits?.maxMemoryMb} suffix="MB" />
        <LimitRow label="CPU/App" value={plan.limits?.maxCpuCores} suffix="cores" />
      </div>

      {/* Features */}
      <div className="space-y-2 mb-8 border-t pt-6">
        <FeatureRow label="Preview Deployments" enabled={plan.features?.previewDeployments} />
        <FeatureRow label="Team Collaboration" enabled={plan.features?.teamCollaboration} />
        <FeatureRow label="Custom Domains" enabled={plan.features?.customDomains} />
        <FeatureRow label="Priority Support" enabled={plan.features?.prioritySupport} />
        <FeatureRow label="SSO / SAML" enabled={plan.features?.sso} />
        <FeatureRow label="Webhooks" enabled={plan.features?.webhooks} />
        <FeatureRow label="API Access" enabled={plan.features?.apiAccess} />
        <FeatureRow label="Spend Management" enabled={plan.features?.spendManagement} />
      </div>

      {/* CTA */}
      {isHobby ? (
        <Button asChild size="lg" variant="outline" className="w-full">
          <Link href="/auth/register">
            Get Started Free
            <ArrowRight className="h-4 w-4 ml-2" />
          </Link>
        </Button>
      ) : isEnterprise ? (
        <Button size="lg" variant="outline" className="w-full">
          Contact Sales
          <ArrowRight className="h-4 w-4 ml-2" />
        </Button>
      ) : (
        <div className="space-y-2">
          <Button asChild size="lg" className="w-full gradient-bg border-0 text-white hover:opacity-90">
            <Link href="/auth/register">
              Start Pro Trial
              <Sparkles className="h-4 w-4 ml-2" />
            </Link>
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            14-day free trial, no credit card required
          </p>
        </div>
      )}
    </div>
  )
}

function LimitRow({ label, value, suffix }: { label: string; value: number | undefined; suffix?: string }) {
  const display = value === undefined || value === null
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

function FeatureRow({ label, enabled }: { label: string; enabled: boolean }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {enabled ? (
        <Check className="h-4 w-4 text-green-500 shrink-0" />
      ) : (
        <X className="h-4 w-4 text-muted-foreground/30 shrink-0" />
      )}
      <span className={cn(!enabled && "text-muted-foreground")}>{label}</span>
    </div>
  )
}

// =====================
// COMPARISON TABLE
// =====================

function ComparisonTable({ plans }: { plans: any[] }) {
  if (plans.length === 0) return null

  const rows = [
    { category: "Resources", items: [
      { label: "Applications", key: "limits.maxApps" },
      { label: "Databases", key: "limits.maxDatabases" },
      { label: "Deployments/month", key: "limits.maxDeployments" },
      { label: "Bandwidth", key: "limits.maxBandwidthGb", suffix: "GB" },
      { label: "Build Minutes", key: "limits.maxBuildMinutes", suffix: "min" },
      { label: "Memory per App", key: "limits.maxMemoryMb", suffix: "MB" },
      { label: "CPU per App", key: "limits.maxCpuCores", suffix: "cores" },
      { label: "Audit Log Retention", key: "limits.auditRetentionDays", suffix: "days" },
    ]},
    { category: "Features", items: [
      { label: "Custom Domains", key: "features.customDomains", boolean: true },
      { label: "Preview Deployments", key: "features.previewDeployments", boolean: true },
      { label: "Team Collaboration", key: "features.teamCollaboration", boolean: true },
      { label: "Priority Support", key: "features.prioritySupport", boolean: true },
      { label: "SSO / SAML", key: "features.sso", boolean: true },
      { label: "Webhooks", key: "features.webhooks", boolean: true },
      { label: "API Access", key: "features.apiAccess", boolean: true },
      { label: "Spend Management", key: "features.spendManagement", boolean: true },
    ]},
  ]

  const getValue = (plan: any, key: string) => {
    const parts = key.split(".")
    let val = plan
    for (const p of parts) {
      val = val?.[p]
    }
    return val
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b">
            <th className="text-left text-sm font-medium py-4 pr-4 w-1/4"></th>
            {plans.map((plan: any) => (
              <th key={plan.id} className="text-center text-sm font-semibold py-4 px-4">
                {plan.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((section) => (
            <>
              <tr key={section.category}>
                <td colSpan={4} className="pt-6 pb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  {section.category}
                </td>
              </tr>
              {section.items.map((item) => (
                <tr key={item.label} className="border-b border-border/50">
                  <td className="py-3 pr-4 text-sm text-muted-foreground">{item.label}</td>
                  {plans.map((plan: any) => {
                    const val = getValue(plan, item.key)
                    return (
                      <td key={plan.id} className="py-3 px-4 text-center text-sm">
                        {(item as any).boolean ? (
                          val ? (
                            <Check className="h-4 w-4 text-green-500 mx-auto" />
                          ) : (
                            <X className="h-4 w-4 text-muted-foreground/30 mx-auto" />
                          )
                        ) : (
                          <span className="font-medium">
                            {val === -1
                              ? "Unlimited"
                              : val !== undefined && val !== null
                              ? `${val}${(item as any).suffix ? ` ${(item as any).suffix}` : ""}`
                              : "—"}
                          </span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// =====================
// FAQ
// =====================

const faqItems = [
  {
    q: "Can I try Pro features before committing?",
    a: "Yes! Every organization gets a free 14-day Pro trial. No credit card required. When the trial ends, your plan automatically reverts to Hobby if you haven't added a payment method.",
  },
  {
    q: "How does per-seat pricing work?",
    a: "The Pro plan charges $20/month per team member with an active seat. You only pay for members who can deploy and manage apps — read-only viewers are free.",
  },
  {
    q: "What happens if I exceed my plan limits?",
    a: "On the Hobby plan, you'll hit a hard cap and see an upgrade prompt. On the Pro plan, you can set a monthly spend limit to control overage costs, or allow overages with usage-based billing.",
  },
  {
    q: "Can I downgrade or cancel at any time?",
    a: "Absolutely. You can downgrade to Hobby or cancel your Pro subscription at any time. Changes take effect at the end of your current billing period — no prorated charges.",
  },
  {
    q: "What payment methods do you accept?",
    a: "We accept all major credit cards through Stripe. Enterprise customers can also pay via invoice with net-30 terms.",
  },
  {
    q: "Do you offer annual billing?",
    a: "Yes! Annual billing gives you 2 months free — that's $200/seat/year instead of $240. The savings are applied automatically when you switch to yearly billing.",
  },
]

function FAQSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  return (
    <div className="space-y-2">
      {faqItems.map((item, i) => (
        <div key={i} className="rounded-xl border bg-card overflow-hidden">
          <button
            onClick={() => setOpenIndex(openIndex === i ? null : i)}
            className="w-full flex items-center justify-between p-5 text-left"
          >
            <span className="text-sm font-medium pr-4">{item.q}</span>
            {openIndex === i ? (
              <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}
          </button>
          {openIndex === i && (
            <div className="px-5 pb-5">
              <p className="text-sm text-muted-foreground">{item.a}</p>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
