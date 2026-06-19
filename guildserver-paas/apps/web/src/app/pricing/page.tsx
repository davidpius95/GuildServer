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
  Rocket,
  Server,
  Cpu,
  MemoryStick,
  HardDrive,
  Network,
} from "lucide-react"

export default function PricingPage() {
  const [billingInterval, setBillingInterval] = useState<"monthly" | "yearly">("monthly")
  const [product, setProduct] = useState<"paas" | "vps">("paas")
  const plansQuery = trpc.billing.getPlans.useQuery()
  const instanceTypesQuery = trpc.billing.getInstanceTypes.useQuery()

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Navigation */}
      <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
        <div className="main-container flex h-16 items-center justify-between">
          <div className="flex items-center gap-8">
            <Link href="/" className="flex items-center gap-2.5">
              <img src="/logo.png" alt="GuildServer Logo" className="h-8 w-8 object-contain dark:invert" />
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
          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-8">
            {product === "paas"
              ? "Deploy personal projects for free, then upgrade as you need more power, more apps, and team collaboration."
              : "Spin up raw compute in seconds — predictable monthly or hourly pricing for vCPU, RAM, and NVMe storage."}
          </p>

          {/* Product Toggle: Managed Platform vs VPS */}
          <div className="inline-flex items-center rounded-xl border bg-card p-1 mb-8">
            <button
              onClick={() => setProduct("paas")}
              className={cn(
                "text-sm font-medium px-5 py-2 rounded-lg transition-colors",
                product === "paas" ? "gradient-bg text-white" : "text-muted-foreground hover:text-foreground"
              )}
            >
              Managed Platform
            </button>
            <button
              onClick={() => setProduct("vps")}
              className={cn(
                "text-sm font-medium px-5 py-2 rounded-lg transition-colors",
                product === "vps" ? "gradient-bg text-white" : "text-muted-foreground hover:text-foreground"
              )}
            >
              VPS Instances
            </button>
          </div>

          {/* Billing Toggle (PaaS only) */}
          {product === "paas" && (
            <div className="flex items-center justify-center gap-4 mb-4">
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
          )}
        </div>
      </section>

      {/* ===== Managed Platform (PaaS) ===== */}
      {product === "paas" && (
        <>
          {/* Pricing Cards */}
          <section className="pb-20">
            <div className="main-container">
              {plansQuery.isLoading ? (
                <div className="flex items-center justify-center py-20">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4 max-w-7xl mx-auto">
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
            <div className="main-container max-w-7xl mx-auto">
              <h2 className="text-3xl font-bold text-center mb-12">Compare Plans</h2>
              <ComparisonTable plans={plansQuery.data || []} />
            </div>
          </section>
        </>
      )}

      {/* ===== VPS Instances (IaaS) ===== */}
      {product === "vps" && (
        <section className="pb-20">
          <div className="main-container max-w-6xl mx-auto">
            {instanceTypesQuery.isLoading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <VPSSection instanceTypes={instanceTypesQuery.data || []} />
            )}
          </div>
        </section>
      )}

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
            <img src="/logo.png" alt="GuildServer Logo" className="h-6 w-6 object-contain" />
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
    starter: Rocket,
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
                <td colSpan={plans.length + 1} className="pt-6 pb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
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
    a: "Yes! Annual billing on the Managed Platform gives you 2 months free. The savings are applied automatically when you switch to yearly billing.",
  },
  {
    q: "VPS Instances vs the Managed Platform — which do I need?",
    a: "VPS Instances give you raw, sized compute (vCPU, RAM, NVMe storage) that you manage yourself — like a DigitalOcean Droplet or AWS EC2 instance. The Managed Platform sits on top: it builds, deploys, and runs your apps for you (Git/Docker deploys, managed databases, domains + SSL, monitoring). Use VPS if you want full control of the box; use the platform if you just want to ship. You can also run the platform on your own VPS instances and pay only the platform fee.",
  },
  {
    q: "How is hourly VPS billing calculated?",
    a: "Each instance has an hourly rate equal to its monthly price divided by 730 hours. You're billed per hour for the time an instance exists, and the total is capped at the monthly price — so a machine left running all month never costs more than the listed monthly rate.",
  },
  {
    q: "Can I bring my own server?",
    a: "Yes. Connect your own VPS or a provider like Proxmox/Hetzner/DigitalOcean as a compute provider, and GuildServer deploys to it. In that case you pay your provider for the hardware and only the Managed Platform fee to us.",
  },
]

// =====================
// VPS / INSTANCES
// =====================

const VPS_ADDONS = [
  { icon: HardDrive, label: "Block storage", price: "$0.10 / GB / mo" },
  { icon: Server, label: "Automated backups", price: "+20% of instance price" },
  { icon: Network, label: "Bandwidth overage", price: "$0.01 / GB" },
  { icon: Cpu, label: "Snapshots", price: "$0.05 / GB / mo" },
]

function fmtUSD(cents: number, digits = 0) {
  return `$${(cents / 100).toFixed(digits)}`
}

function fmtRam(ramMb: number) {
  return ramMb >= 1024 ? `${ramMb / 1024} GB` : `${ramMb} MB`
}

function VPSSection({ instanceTypes }: { instanceTypes: any[] }) {
  const [family, setFamily] = useState<"shared" | "dedicated">("shared")
  const [interval, setIntervalMode] = useState<"monthly" | "hourly">("monthly")

  const types = instanceTypes.filter((t) => t.family === family)

  // Calculator state
  const [calcSlug, setCalcSlug] = useState<string>("")
  const [extraStorage, setExtraStorage] = useState<number>(0)
  const [backups, setBackups] = useState(false)

  const selected = instanceTypes.find((t) => t.slug === calcSlug) || types[0]
  const estMonthlyCents = selected
    ? selected.priceMonthly + Math.max(0, extraStorage) * 10 + (backups ? Math.round(selected.priceMonthly * 0.2) : 0)
    : 0

  return (
    <div className="space-y-10">
      {/* Family + interval toggles */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="inline-flex items-center rounded-xl border bg-card p-1">
          <button
            onClick={() => setFamily("shared")}
            className={cn("text-sm font-medium px-5 py-2 rounded-lg transition-colors", family === "shared" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            Shared CPU
          </button>
          <button
            onClick={() => setFamily("dedicated")}
            className={cn("text-sm font-medium px-5 py-2 rounded-lg transition-colors", family === "dedicated" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            Dedicated CPU
          </button>
        </div>
        <div className="inline-flex items-center rounded-xl border bg-card p-1">
          <button
            onClick={() => setIntervalMode("monthly")}
            className={cn("text-sm font-medium px-4 py-2 rounded-lg transition-colors", interval === "monthly" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            Monthly
          </button>
          <button
            onClick={() => setIntervalMode("hourly")}
            className={cn("text-sm font-medium px-4 py-2 rounded-lg transition-colors", interval === "hourly" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            Hourly
          </button>
        </div>
      </div>

      <p className="text-sm text-muted-foreground text-center -mt-4">
        {family === "shared"
          ? "Burstable vCPU shared with other tenants — the best value for most workloads."
          : "Dedicated vCPU cores with no noisy neighbours — consistent performance for production."}
      </p>

      {/* Instance table */}
      <div className="overflow-x-auto rounded-2xl border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-muted-foreground">
              <th className="text-left font-medium py-4 px-5">Plan</th>
              <th className="text-left font-medium py-4 px-3"><span className="inline-flex items-center gap-1"><Cpu className="h-3.5 w-3.5" />vCPU</span></th>
              <th className="text-left font-medium py-4 px-3"><span className="inline-flex items-center gap-1"><MemoryStick className="h-3.5 w-3.5" />RAM</span></th>
              <th className="text-left font-medium py-4 px-3"><span className="inline-flex items-center gap-1"><HardDrive className="h-3.5 w-3.5" />NVMe</span></th>
              <th className="text-left font-medium py-4 px-3"><span className="inline-flex items-center gap-1"><Network className="h-3.5 w-3.5" />Transfer</span></th>
              <th className="text-right font-medium py-4 px-5">Price</th>
              <th className="py-4 px-5"></th>
            </tr>
          </thead>
          <tbody>
            {types.map((t) => (
              <tr key={t.slug} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                <td className="py-4 px-5">
                  <div className="font-semibold">{t.name}</div>
                  <div className="text-xs text-muted-foreground">{t.description}</div>
                </td>
                <td className="py-4 px-3">{t.vcpu}</td>
                <td className="py-4 px-3">{fmtRam(t.ramMb)}</td>
                <td className="py-4 px-3">{t.storageGb} GB</td>
                <td className="py-4 px-3">{t.transferTb} TB</td>
                <td className="py-4 px-5 text-right whitespace-nowrap">
                  {interval === "monthly" ? (
                    <><span className="font-bold">{fmtUSD(t.priceMonthly)}</span><span className="text-muted-foreground text-xs">/mo</span></>
                  ) : (
                    <><span className="font-bold">${(t.priceHourlyCents / 100).toFixed(4)}</span><span className="text-muted-foreground text-xs">/hr</span></>
                  )}
                </td>
                <td className="py-4 px-5 text-right">
                  <Button asChild size="sm" variant="outline">
                    <Link href="/auth/register">Deploy</Link>
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add-ons + Calculator */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Add-ons */}
        <div className="rounded-2xl border bg-card p-6">
          <h3 className="font-semibold mb-4">Add-ons</h3>
          <div className="space-y-3">
            {VPS_ADDONS.map((a) => (
              <div key={a.label} className="flex items-center justify-between text-sm">
                <span className="inline-flex items-center gap-2 text-muted-foreground"><a.icon className="h-4 w-4" />{a.label}</span>
                <span className="font-medium">{a.price}</span>
              </div>
            ))}
            <div className="flex items-center justify-between text-sm">
              <span className="inline-flex items-center gap-2 text-muted-foreground"><Network className="h-4 w-4" />Extra IPv4</span>
              <span className="font-medium">$4 / mo</span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-4">Hourly billing caps at the monthly rate (730 hrs). You only pay for what you run.</p>
        </div>

        {/* Calculator */}
        <div className="rounded-2xl border bg-card p-6">
          <h3 className="font-semibold mb-4">Estimate your cost</h3>
          <div className="space-y-4">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Instance</label>
              <select
                value={selected?.slug || ""}
                onChange={(e) => setCalcSlug(e.target.value)}
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
              >
                {instanceTypes.map((t) => (
                  <option key={t.slug} value={t.slug}>
                    {t.name} ({t.vcpu} vCPU / {fmtRam(t.ramMb)}) — {fmtUSD(t.priceMonthly)}/mo
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Extra block storage (GB)</label>
              <input
                type="number"
                min={0}
                value={extraStorage}
                onChange={(e) => setExtraStorage(Math.max(0, Number(e.target.value) || 0))}
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={backups} onChange={(e) => setBackups(e.target.checked)} />
              Automated backups (+20%)
            </label>
            <div className="border-t pt-4 flex items-end justify-between">
              <span className="text-sm text-muted-foreground">Estimated total</span>
              <div className="text-right">
                <div className="text-2xl font-bold">{fmtUSD(estMonthlyCents, 2)}<span className="text-sm font-normal text-muted-foreground">/mo</span></div>
                <div className="text-xs text-muted-foreground">≈ ${(estMonthlyCents / 100 / 730).toFixed(4)}/hr</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

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
