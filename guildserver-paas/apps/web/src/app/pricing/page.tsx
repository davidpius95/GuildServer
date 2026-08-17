"use client"

import { useState } from "react"
import Link from "next/link"
import { trpc } from "@/components/trpc-provider"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ThemeToggle } from "@/components/theme-toggle"
import { cn } from "@/lib/utils"
import {
  ArrowRight,
  Boxes,
  Check,
  ChevronDown,
  ChevronUp,
  Cloud,
  Cpu,
  Database,
  GitBranch,
  Globe2,
  HardDrive,
  Loader2,
  MemoryStick,
  Network,
  Server,
  Sparkles,
  X,
  Zap,
} from "lucide-react"

const productChoices = [
  {
    value: "paas",
    label: "Managed Platform",
    description: "Best when you want Git and Docker deploys handled for you.",
  },
  {
    value: "vps",
    label: "VPS Instances",
    description: "Best when you want raw compute with predictable resource pricing.",
  },
] as const

const includedItems = [
  { icon: GitBranch, label: "GitHub and Docker deployments" },
  { icon: Globe2, label: "Generated URLs and custom domain flow" },
  { icon: Database, label: "Database and backup workspace" },
  { icon: Boxes, label: "Container logs, health checks, and status" },
]

const faqItems = [
  {
    q: "Can I start without a credit card?",
    a: "Yes. Start on the free platform plan and deploy your first apps before choosing a paid plan.",
  },
  {
    q: "When should I choose the Managed Platform?",
    a: "Choose the Managed Platform when you want GuildServer to build, deploy, route, and monitor your apps from Git or Docker.",
  },
  {
    q: "When should I choose VPS Instances?",
    a: "Choose VPS Instances when you want raw vCPU, RAM, storage, and transfer that you manage directly or attach as compute capacity.",
  },
  {
    q: "Can I use both products together?",
    a: "Yes. The platform is designed so apps, databases, domains, and infrastructure can live in the same workspace.",
  },
  {
    q: "How is hourly VPS billing calculated?",
    a: "The hourly rate is based on the monthly price divided by 730 hours. Long-running instances are capped at the listed monthly price.",
  },
  {
    q: "Can I cancel or downgrade?",
    a: "Yes. You can change plans as your needs change. Downgrades take effect at the end of the current billing period.",
  },
]

const VPS_ADDONS = [
  { icon: HardDrive, label: "Block storage", price: "$0.10 / GB / mo" },
  { icon: Server, label: "Automated backups", price: "+20% of instance price" },
  { icon: Network, label: "Bandwidth overage", price: "$0.01 / GB" },
  { icon: Cpu, label: "Snapshots", price: "$0.05 / GB / mo" },
]

export default function PricingPage() {
  const [billingInterval, setBillingInterval] = useState<"monthly" | "yearly">("monthly")
  const [product, setProduct] = useState<"paas" | "vps">("paas")
  const plansQuery = trpc.billing.getPlans.useQuery()
  const instanceTypesQuery = trpc.billing.getInstanceTypes.useQuery()

  return (
    <div className="min-h-screen overflow-hidden bg-[#fbfaf6] text-[#171713] dark:bg-[#080c0a] dark:text-[#f8f6ee]">
      <header className="sticky top-0 z-50 border-b border-[#171713]/10 bg-[#fbfaf6]/86 backdrop-blur-xl dark:border-white/10 dark:bg-[#080c0a]/86">
        <div className="main-container flex h-16 items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#171713] text-white shadow-sm dark:bg-[#f8f6ee] dark:text-[#080c0a]">
              <Cloud className="h-4 w-4" />
            </span>
            <span className="text-lg font-black tracking-[-0.03em]">GuildServer</span>
          </Link>

          <nav className="hidden items-center gap-6 text-sm text-[#171713]/62 dark:text-white/62 md:flex">
            <Link href="/#platform" className="transition-colors hover:text-[#171713] dark:hover:text-white">Platform</Link>
            <Link href="/#workflow" className="transition-colors hover:text-[#171713] dark:hover:text-white">Workflow</Link>
            <Link href="/pricing" className="font-semibold text-[#171713] dark:text-white">Pricing</Link>
          </nav>

          <div className="flex items-center gap-3">
            <ThemeToggle />
            <Link href="/auth/login" className="hidden text-sm text-[#171713]/62 transition-colors hover:text-[#171713] dark:text-white/62 dark:hover:text-white sm:block">
              Log in
            </Link>
            <Button asChild size="sm" className="rounded-full bg-[#171713] text-white hover:bg-[#171713]/90 dark:bg-[#f8f6ee] dark:text-[#080c0a] dark:hover:bg-white/90">
              <Link href="/auth/register">Start free</Link>
            </Button>
          </div>
        </div>
      </header>

      <main>
        <section className="relative">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(39,95,74,0.16),transparent_28%),radial-gradient(circle_at_80%_0%,rgba(238,164,83,0.18),transparent_32%),linear-gradient(90deg,rgba(23,23,19,0.052)_1px,transparent_1px),linear-gradient(rgba(23,23,19,0.052)_1px,transparent_1px)] bg-[size:auto,auto,52px_52px,52px_52px] dark:bg-[radial-gradient(circle_at_18%_18%,rgba(66,185,127,0.13),transparent_28%),radial-gradient(circle_at_80%_0%,rgba(238,164,83,0.11),transparent_32%),linear-gradient(90deg,rgba(255,255,255,0.055)_1px,transparent_1px),linear-gradient(rgba(255,255,255,0.055)_1px,transparent_1px)]" />
          <div className="absolute inset-x-0 bottom-0 h-36 bg-gradient-to-t from-[#fbfaf6] to-transparent dark:from-[#080c0a]" />

          <div className="main-container relative py-16 md:py-24">
            <div className="mx-auto max-w-4xl text-center">
              <Badge className="mb-6 rounded-full border-[#171713]/10 bg-white/75 px-3 py-1 text-[#171713]/70 shadow-sm dark:border-white/10 dark:bg-white/10 dark:text-white/75">
                Simple pricing for apps and infrastructure
              </Badge>
              <h1 className="text-5xl font-black leading-[0.95] tracking-[-0.06em] md:text-7xl">
                Start small. Keep the path to production clear.
              </h1>
              <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-[#171713]/64 dark:text-white/64">
                Choose the managed platform when you want deployment handled. Choose VPS instances when you want direct compute. Use both as your stack grows.
              </p>
            </div>

            <div className="mx-auto mt-10 grid max-w-4xl gap-3 md:grid-cols-2">
              {productChoices.map((choice) => (
                <button
                  key={choice.value}
                  onClick={() => setProduct(choice.value)}
                  className={cn(
                    "rounded-[1.4rem] border p-5 text-left transition-all",
                    product === choice.value
                      ? "border-[#171713] bg-[#171713] text-white shadow-xl shadow-black/15 dark:border-white dark:bg-white dark:text-[#080c0a]"
                      : "border-[#171713]/10 bg-white/65 text-[#171713] hover:bg-white dark:border-white/10 dark:bg-white/[0.06] dark:text-white dark:hover:bg-white/[0.09]"
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-black tracking-tight">{choice.label}</p>
                    <ArrowRight className={cn("h-4 w-4", product === choice.value ? "opacity-100" : "opacity-30")} />
                  </div>
                  <p className={cn("mt-2 text-sm leading-6", product === choice.value ? "text-white/66 dark:text-black/66" : "text-[#171713]/58 dark:text-white/58")}>
                    {choice.description}
                  </p>
                </button>
              ))}
            </div>
          </div>
        </section>

        {product === "paas" ? (
          <PlatformPricing
            plans={plansQuery.data || []}
            isLoading={plansQuery.isLoading}
            billingInterval={billingInterval}
            setBillingInterval={setBillingInterval}
          />
        ) : (
          <VPSPricing
            instanceTypes={instanceTypesQuery.data || []}
            isLoading={instanceTypesQuery.isLoading}
          />
        )}

        <IncludedSection />
        <FAQSection />

        <section className="py-20 md:py-24">
          <div className="main-container">
            <div className="rounded-[2rem] border border-[#171713]/10 bg-[#171713] p-8 text-white shadow-2xl shadow-black/15 dark:border-white/10 md:p-12">
              <div className="grid gap-8 md:grid-cols-[1fr_auto] md:items-end">
                <div>
                  <p className="text-sm font-bold uppercase tracking-[0.2em] text-[#85d9a8]">Ready when you are</p>
                  <h2 className="mt-4 max-w-2xl text-4xl font-black tracking-[-0.045em] md:text-6xl">
                    Deploy the first app, then choose the plan that fits.
                  </h2>
                  <p className="mt-5 max-w-2xl text-lg leading-8 text-white/62">
                    Start with the platform flow, add resources when they are needed, and keep cost visible as your services grow.
                  </p>
                </div>
                <div className="flex flex-col gap-3 sm:flex-row md:flex-col">
                  <Button asChild size="lg" className="h-12 rounded-full bg-white px-7 text-black hover:bg-white/90">
                    <Link href="/auth/register">
                      Start free
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                  <Button asChild size="lg" variant="outline" className="h-12 rounded-full border-white/15 bg-transparent px-7 text-white hover:bg-white/10 hover:text-white">
                    <Link href="/#workflow">See workflow</Link>
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-[#171713]/10 bg-[#fbfaf6] py-10 dark:border-white/10 dark:bg-[#080c0a]">
        <div className="main-container flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#171713] text-white dark:bg-white dark:text-[#080c0a]">
              <Cloud className="h-4 w-4" />
            </span>
            <span className="font-black tracking-tight">GuildServer</span>
          </div>
          <div className="flex flex-wrap gap-4 text-sm text-[#171713]/55 dark:text-white/55">
            <Link href="/" className="hover:text-[#171713] dark:hover:text-white">Home</Link>
            <Link href="/pricing" className="hover:text-[#171713] dark:hover:text-white">Pricing</Link>
            <Link href="/auth/login" className="hover:text-[#171713] dark:hover:text-white">Log in</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}

function PlatformPricing({
  plans,
  isLoading,
  billingInterval,
  setBillingInterval,
}: {
  plans: any[]
  isLoading: boolean
  billingInterval: "monthly" | "yearly"
  setBillingInterval: (interval: "monthly" | "yearly") => void
}) {
  return (
    <section className="pb-16 md:pb-24">
      <div className="main-container">
        <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.22em] text-[#276f54] dark:text-[#85d9a8]">Managed Platform</p>
            <h2 className="mt-2 text-3xl font-black tracking-[-0.04em] md:text-5xl">Plans for shipping apps.</h2>
            <p className="mt-3 max-w-2xl leading-7 text-[#171713]/62 dark:text-white/62">
              Pay for the deployment workspace: apps, build minutes, domains, team controls, and operational visibility.
            </p>
          </div>

          <div className="inline-flex w-fit rounded-full border border-[#171713]/10 bg-white/70 p-1 dark:border-white/10 dark:bg-white/[0.06]">
            {(["monthly", "yearly"] as const).map((interval) => (
              <button
                key={interval}
                onClick={() => setBillingInterval(interval)}
                className={cn(
                  "rounded-full px-4 py-2 text-sm font-semibold transition-colors",
                  billingInterval === interval
                    ? "bg-[#171713] text-white dark:bg-white dark:text-[#080c0a]"
                    : "text-[#171713]/62 hover:text-[#171713] dark:text-white/62 dark:hover:text-white"
                )}
              >
                {interval === "monthly" ? "Monthly" : "Yearly"}
                {interval === "yearly" && <span className="ml-2 text-[#276f54] dark:text-[#85d9a8]">save 17%</span>}
              </button>
            ))}
          </div>
        </div>

        {isLoading ? (
          <LoadingBlock />
        ) : (
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
            {plans.map((plan) => (
              <PricingCard
                key={plan.id}
                plan={plan}
                billingInterval={billingInterval}
                featured={plan.slug === "pro"}
              />
            ))}
          </div>
        )}

        {!isLoading && plans.length > 0 && (
          <div className="mt-10 overflow-hidden rounded-[1.75rem] border border-[#171713]/10 bg-white/70 dark:border-white/10 dark:bg-white/[0.055]">
            <ComparisonTable plans={plans} />
          </div>
        )}
      </div>
    </section>
  )
}

function PricingCard({
  plan,
  billingInterval,
  featured,
}: {
  plan: any
  billingInterval: "monthly" | "yearly"
  featured: boolean
}) {
  const price = billingInterval === "yearly" && plan.priceYearly ? plan.priceYearly : plan.priceMonthly
  const monthlyEquivalent = billingInterval === "yearly" && plan.priceYearly ? Math.round(plan.priceYearly / 12) : plan.priceMonthly
  const isEnterprise = plan.slug === "enterprise"
  const isHobby = plan.slug === "hobby"

  return (
    <div
      className={cn(
        "relative flex flex-col rounded-[1.75rem] border p-6 shadow-sm",
        featured
          ? "border-[#171713] bg-[#171713] text-white shadow-2xl shadow-black/15 dark:border-white dark:bg-white dark:text-[#080c0a]"
          : "border-[#171713]/10 bg-white/72 dark:border-white/10 dark:bg-white/[0.055]"
      )}
    >
      {featured && (
        <Badge className="absolute -top-3 left-6 rounded-full border-0 bg-[#eba453] px-3 py-1 text-[#171713]">
          Best for teams
        </Badge>
      )}

      <div className="mb-6 pt-2">
        <h3 className="text-2xl font-black tracking-[-0.035em]">{plan.name}</h3>
        <p className={cn("mt-2 min-h-[48px] text-sm leading-6", featured ? "text-white/64 dark:text-black/64" : "text-[#171713]/58 dark:text-white/58")}>
          {plan.description}
        </p>
      </div>

      <div className="mb-7">
        {isEnterprise ? (
          <>
            <p className="text-4xl font-black tracking-tight">Custom</p>
            <p className={cn("mt-1 text-sm", featured ? "text-white/60 dark:text-black/60" : "text-[#171713]/55 dark:text-white/55")}>For larger teams and custom requirements</p>
          </>
        ) : (
          <>
            <p className="text-5xl font-black tracking-[-0.04em]">
              ${((monthlyEquivalent || price || 0) / 100).toFixed(0)}
              <span className={cn("text-base font-medium", featured ? "text-white/58 dark:text-black/58" : "text-[#171713]/52 dark:text-white/52")}>/mo</span>
            </p>
            <p className={cn("mt-1 text-sm", featured ? "text-white/58 dark:text-black/58" : "text-[#171713]/55 dark:text-white/55")}>
              {isHobby ? "Free to start" : billingInterval === "yearly" ? "Billed yearly" : "Billed monthly"}
            </p>
          </>
        )}
      </div>

      <div className="mb-7 grid gap-2 text-sm">
        <LimitPill featured={featured} label="Apps" value={formatLimit(plan.limits?.maxApps)} />
        <LimitPill featured={featured} label="Databases" value={formatLimit(plan.limits?.maxDatabases)} />
        <LimitPill featured={featured} label="Build" value={formatLimit(plan.limits?.maxBuildMinutes, "min/mo")} />
        <LimitPill featured={featured} label="Memory" value={formatLimit(plan.limits?.maxMemoryMb, "MB/app")} />
      </div>

      <div className={cn("mb-7 space-y-2 border-t pt-5", featured ? "border-white/12 dark:border-black/12" : "border-[#171713]/10 dark:border-white/10")}>
        <FeatureRow label="Custom domains" enabled={plan.features?.customDomains} featured={featured} />
        <FeatureRow label="Preview deployments" enabled={plan.features?.previewDeployments} featured={featured} />
        <FeatureRow label="Team collaboration" enabled={plan.features?.teamCollaboration} featured={featured} />
        <FeatureRow label="Spend management" enabled={plan.features?.spendManagement} featured={featured} />
      </div>

      <div className="mt-auto">
        {isEnterprise ? (
          <Button size="lg" variant="outline" className={cn("w-full rounded-full", featured && "border-black/15 bg-transparent text-black hover:bg-black/5")}>
            Contact sales
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        ) : (
          <Button
            asChild
            size="lg"
            className={cn(
              "w-full rounded-full",
              featured
                ? "bg-white text-black hover:bg-white/90 dark:bg-[#171713] dark:text-white dark:hover:bg-[#171713]/90"
                : "bg-[#171713] text-white hover:bg-[#171713]/90 dark:bg-white dark:text-[#080c0a] dark:hover:bg-white/90"
            )}
          >
            <Link href="/auth/register">
              {isHobby ? "Start free" : "Start trial"}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        )}
      </div>
    </div>
  )
}

function LimitPill({ label, value, featured }: { label: string; value: string; featured: boolean }) {
  return (
    <div className={cn("flex items-center justify-between rounded-xl px-3 py-2", featured ? "bg-white/8 dark:bg-black/6" : "bg-[#171713]/5 dark:bg-white/[0.055]")}>
      <span className={cn(featured ? "text-white/58 dark:text-black/58" : "text-[#171713]/56 dark:text-white/56")}>{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  )
}

function FeatureRow({ label, enabled, featured = false }: { label: string; enabled: boolean; featured?: boolean }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {enabled ? (
        <Check className={cn("h-4 w-4 shrink-0", featured ? "text-[#85d9a8] dark:text-[#276f54]" : "text-[#276f54] dark:text-[#85d9a8]")} />
      ) : (
        <X className={cn("h-4 w-4 shrink-0", featured ? "text-white/24 dark:text-black/24" : "text-[#171713]/24 dark:text-white/24")} />
      )}
      <span className={cn(!enabled && (featured ? "text-white/42 dark:text-black/42" : "text-[#171713]/42 dark:text-white/42"))}>{label}</span>
    </div>
  )
}

function ComparisonTable({ plans }: { plans: any[] }) {
  const rows = [
    { label: "Applications", key: "limits.maxApps" },
    { label: "Databases", key: "limits.maxDatabases" },
    { label: "Deployments/month", key: "limits.maxDeployments" },
    { label: "Bandwidth", key: "limits.maxBandwidthGb", suffix: "GB" },
    { label: "Build minutes", key: "limits.maxBuildMinutes", suffix: "min" },
    { label: "Audit retention", key: "limits.auditRetentionDays", suffix: "days" },
    { label: "API access", key: "features.apiAccess", boolean: true },
    { label: "SSO", key: "features.sso", boolean: true },
  ]

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-sm">
        <thead>
          <tr className="border-b border-[#171713]/10 bg-[#171713]/[0.035] dark:border-white/10 dark:bg-white/[0.045]">
            <th className="px-5 py-4 text-left font-bold text-[#171713]/58 dark:text-white/58">Included</th>
            {plans.map((plan) => (
              <th key={plan.id} className="px-4 py-4 text-center font-black">{plan.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-b border-[#171713]/10 last:border-0 dark:border-white/10">
              <td className="px-5 py-4 text-[#171713]/62 dark:text-white/62">{row.label}</td>
              {plans.map((plan) => {
                const val = getNestedValue(plan, row.key)
                return (
                  <td key={plan.id} className="px-4 py-4 text-center font-semibold">
                    {(row as any).boolean ? (
                      val ? <Check className="mx-auto h-4 w-4 text-[#276f54] dark:text-[#85d9a8]" /> : <X className="mx-auto h-4 w-4 text-[#171713]/25 dark:text-white/25" />
                    ) : (
                      formatLimit(val, (row as any).suffix)
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function VPSPricing({ instanceTypes, isLoading }: { instanceTypes: any[]; isLoading: boolean }) {
  return (
    <section className="pb-16 md:pb-24">
      <div className="main-container">
        <div className="mb-8">
          <p className="text-sm font-bold uppercase tracking-[0.22em] text-[#276f54] dark:text-[#85d9a8]">VPS Instances</p>
          <h2 className="mt-2 text-3xl font-black tracking-[-0.04em] md:text-5xl">Raw compute with clear sizing.</h2>
          <p className="mt-3 max-w-2xl leading-7 text-[#171713]/62 dark:text-white/62">
            Choose the machine profile, add storage or backups, and keep the monthly estimate visible before you launch.
          </p>
        </div>

        {isLoading ? <LoadingBlock /> : <VPSSection instanceTypes={instanceTypes} />}
      </div>
    </section>
  )
}

function VPSSection({ instanceTypes }: { instanceTypes: any[] }) {
  const [family, setFamily] = useState<"shared" | "dedicated">("shared")
  const [interval, setIntervalMode] = useState<"monthly" | "hourly">("monthly")
  const [calcSlug, setCalcSlug] = useState<string>("")
  const [extraStorage, setExtraStorage] = useState<number>(0)
  const [backups, setBackups] = useState(false)

  const types = instanceTypes.filter((t) => t.family === family)
  const selected = instanceTypes.find((t) => t.slug === calcSlug) || types[0] || instanceTypes[0]
  const estMonthlyCents = selected
    ? selected.priceMonthly + Math.max(0, extraStorage) * 10 + (backups ? Math.round(selected.priceMonthly * 0.2) : 0)
    : 0

  if (instanceTypes.length === 0) {
    return (
      <div className="rounded-[1.75rem] border border-[#171713]/10 bg-white/70 p-8 text-center dark:border-white/10 dark:bg-white/[0.055]">
        <Server className="mx-auto h-8 w-8 text-[#171713]/45 dark:text-white/45" />
        <h3 className="mt-4 text-xl font-black">Instance pricing is being prepared</h3>
        <p className="mt-2 text-[#171713]/58 dark:text-white/58">Check back shortly or continue with managed app deployments.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <ToggleGroup
          value={family}
          options={[
            { value: "shared", label: "Shared CPU" },
            { value: "dedicated", label: "Dedicated CPU" },
          ]}
          onChange={(value) => setFamily(value as "shared" | "dedicated")}
        />
        <ToggleGroup
          value={interval}
          options={[
            { value: "monthly", label: "Monthly" },
            { value: "hourly", label: "Hourly" },
          ]}
          onChange={(value) => setIntervalMode(value as "monthly" | "hourly")}
        />
      </div>

      <div className="overflow-hidden rounded-[1.75rem] border border-[#171713]/10 bg-white/72 dark:border-white/10 dark:bg-white/[0.055]">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-[#171713]/10 bg-[#171713]/[0.035] text-[#171713]/58 dark:border-white/10 dark:bg-white/[0.045] dark:text-white/58">
                <th className="px-5 py-4 text-left font-bold">Plan</th>
                <th className="px-3 py-4 text-left font-bold">vCPU</th>
                <th className="px-3 py-4 text-left font-bold">RAM</th>
                <th className="px-3 py-4 text-left font-bold">NVMe</th>
                <th className="px-3 py-4 text-left font-bold">Transfer</th>
                <th className="px-5 py-4 text-right font-bold">Price</th>
                <th className="px-5 py-4" />
              </tr>
            </thead>
            <tbody>
              {types.map((type) => (
                <tr key={type.slug} className="border-b border-[#171713]/10 last:border-0 hover:bg-[#171713]/[0.025] dark:border-white/10 dark:hover:bg-white/[0.035]">
                  <td className="px-5 py-4">
                    <div className="font-black">{type.name}</div>
                    <div className="mt-1 text-xs text-[#171713]/52 dark:text-white/52">{type.description}</div>
                  </td>
                  <td className="px-3 py-4">{type.vcpu}</td>
                  <td className="px-3 py-4">{fmtRam(type.ramMb)}</td>
                  <td className="px-3 py-4">{type.storageGb} GB</td>
                  <td className="px-3 py-4">{type.transferTb} TB</td>
                  <td className="whitespace-nowrap px-5 py-4 text-right">
                    {interval === "monthly" ? (
                      <><span className="font-black">{fmtUSD(type.priceMonthly)}</span><span className="text-xs text-[#171713]/52 dark:text-white/52">/mo</span></>
                    ) : (
                      <><span className="font-black">${(type.priceHourlyCents / 100).toFixed(4)}</span><span className="text-xs text-[#171713]/52 dark:text-white/52">/hr</span></>
                    )}
                  </td>
                  <td className="px-5 py-4 text-right">
                    <Button asChild size="sm" variant="outline" className="rounded-full">
                      <Link href="/auth/register">Create</Link>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-[1.75rem] border border-[#171713]/10 bg-white/72 p-6 dark:border-white/10 dark:bg-white/[0.055]">
          <h3 className="text-xl font-black tracking-tight">Add-ons</h3>
          <div className="mt-5 space-y-3">
            {VPS_ADDONS.map((addon) => {
              const Icon = addon.icon
              return (
                <div key={addon.label} className="flex items-center justify-between gap-4 rounded-2xl bg-[#171713]/5 px-4 py-3 text-sm dark:bg-white/[0.055]">
                  <span className="inline-flex items-center gap-2 text-[#171713]/62 dark:text-white/62"><Icon className="h-4 w-4" />{addon.label}</span>
                  <span className="font-semibold">{addon.price}</span>
                </div>
              )
            })}
          </div>
          <p className="mt-4 text-xs leading-5 text-[#171713]/52 dark:text-white/52">Hourly billing is capped at the monthly rate. You only pay for instances while they exist.</p>
        </div>

        <div className="rounded-[1.75rem] border border-[#171713]/10 bg-[#171713] p-6 text-white dark:border-white/10">
          <h3 className="text-xl font-black tracking-tight">Estimate your cost</h3>
          <div className="mt-5 space-y-4">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.16em] text-white/48">Instance</label>
              <select
                value={selected?.slug || ""}
                onChange={(e) => setCalcSlug(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-sm text-white"
              >
                {instanceTypes.map((type) => (
                  <option key={type.slug} value={type.slug}>
                    {type.name} ({type.vcpu} vCPU / {fmtRam(type.ramMb)}) - {fmtUSD(type.priceMonthly)}/mo
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.16em] text-white/48">Extra block storage (GB)</label>
              <input
                type="number"
                min={0}
                value={extraStorage}
                onChange={(e) => setExtraStorage(Math.max(0, Number(e.target.value) || 0))}
                className="w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-sm text-white"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-white/72">
              <input type="checkbox" checked={backups} onChange={(e) => setBackups(e.target.checked)} />
              Automated backups (+20%)
            </label>
            <div className="border-t border-white/10 pt-5">
              <div className="flex items-end justify-between gap-4">
                <span className="text-sm text-white/52">Estimated total</span>
                <div className="text-right">
                  <div className="text-3xl font-black">{fmtUSD(estMonthlyCents, 2)}<span className="text-sm font-normal text-white/52">/mo</span></div>
                  <div className="text-xs text-white/45">about ${(estMonthlyCents / 100 / 730).toFixed(4)}/hr</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function IncludedSection() {
  return (
    <section className="border-y border-[#171713]/10 bg-[#efe8da] py-16 dark:border-white/10 dark:bg-[#10140f] md:py-20">
      <div className="main-container">
        <div className="mb-8 max-w-2xl">
          <p className="text-sm font-bold uppercase tracking-[0.22em] text-[#276f54] dark:text-[#85d9a8]">Across plans</p>
          <h2 className="mt-2 text-3xl font-black tracking-[-0.04em] md:text-5xl">The workspace stays connected.</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {includedItems.map((item) => {
            const Icon = item.icon
            return (
              <div key={item.label} className="rounded-[1.5rem] border border-[#171713]/10 bg-white/66 p-5 dark:border-white/10 dark:bg-white/[0.06]">
                <Icon className="h-5 w-5 text-[#276f54] dark:text-[#85d9a8]" />
                <p className="mt-4 font-semibold leading-6">{item.label}</p>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

function FAQSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(0)

  return (
    <section className="py-16 md:py-20">
      <div className="main-container max-w-3xl">
        <div className="mb-8 text-center">
          <p className="text-sm font-bold uppercase tracking-[0.22em] text-[#276f54] dark:text-[#85d9a8]">Questions</p>
          <h2 className="mt-2 text-3xl font-black tracking-[-0.04em] md:text-5xl">Pricing, without surprises.</h2>
        </div>
        <div className="space-y-3">
          {faqItems.map((item, index) => (
            <div key={item.q} className="overflow-hidden rounded-2xl border border-[#171713]/10 bg-white/70 dark:border-white/10 dark:bg-white/[0.055]">
              <button
                onClick={() => setOpenIndex(openIndex === index ? null : index)}
                className="flex w-full items-center justify-between gap-4 p-5 text-left"
              >
                <span className="font-semibold">{item.q}</span>
                {openIndex === index ? <ChevronUp className="h-4 w-4 shrink-0 text-[#171713]/48 dark:text-white/48" /> : <ChevronDown className="h-4 w-4 shrink-0 text-[#171713]/48 dark:text-white/48" />}
              </button>
              {openIndex === index && (
                <div className="px-5 pb-5">
                  <p className="text-sm leading-6 text-[#171713]/62 dark:text-white/62">{item.a}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function ToggleGroup({
  value,
  options,
  onChange,
}: {
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
}) {
  return (
    <div className="inline-flex w-fit rounded-full border border-[#171713]/10 bg-white/70 p-1 dark:border-white/10 dark:bg-white/[0.06]">
      {options.map((option) => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "rounded-full px-4 py-2 text-sm font-semibold transition-colors",
            value === option.value
              ? "bg-[#171713] text-white dark:bg-white dark:text-[#080c0a]"
              : "text-[#171713]/62 hover:text-[#171713] dark:text-white/62 dark:hover:text-white"
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function LoadingBlock() {
  return (
    <div className="flex items-center justify-center rounded-[1.75rem] border border-[#171713]/10 bg-white/70 py-20 dark:border-white/10 dark:bg-white/[0.055]">
      <Loader2 className="h-8 w-8 animate-spin text-[#171713]/45 dark:text-white/45" />
    </div>
  )
}

function getNestedValue(obj: any, key: string) {
  return key.split(".").reduce((value, part) => value?.[part], obj)
}

function formatLimit(value: number | undefined | null, suffix?: string) {
  if (value === undefined || value === null) return "-"
  if (value === -1) return "Unlimited"
  return `${value}${suffix ? ` ${suffix}` : ""}`
}

function fmtUSD(cents: number, digits = 0) {
  return `$${(cents / 100).toFixed(digits)}`
}

function fmtRam(ramMb: number) {
  return ramMb >= 1024 ? `${ramMb / 1024} GB` : `${ramMb} MB`
}
