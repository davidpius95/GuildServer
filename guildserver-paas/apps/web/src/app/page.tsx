import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ThemeToggle } from "@/components/theme-toggle"
import {
  Activity,
  ArrowRight,
  BarChart3,
  Boxes,
  Check,
  ChevronRight,
  CircleDot,
  Cloud,
  Code2,
  Database,
  GitBranch,
  Globe2,
  Lock,
  Network,
  Route,
  Server,
  ShieldCheck,
  Sparkles,
  Terminal,
  AlertTriangle,
  Workflow,
  X,
  Zap,
} from "lucide-react"
import Link from "next/link"

const deploySteps = [
  { label: "Select repo", value: "github.com/team/api", icon: GitBranch },
  { label: "Detect stack", value: "Node, Python, Dockerfile", icon: Code2 },
  { label: "Build image", value: "container + health probe", icon: Boxes },
  { label: "Route traffic", value: "TLS domain + live logs", icon: Route },
]

const currentCapabilities = [
  {
    title: "GitHub to running container",
    text: "Connect a repo, pick a branch, build from Dockerfile or detected project files, then deploy immediately.",
    icon: GitBranch,
  },
  {
    title: "Docker-native apps",
    text: "Run prebuilt images or generated images with port routing, restart policy, and container health checks.",
    icon: Boxes,
  },
  {
    title: "Domains and TLS routing",
    text: "Traefik-backed routing for generated app domains and custom domain workflows.",
    icon: Globe2,
  },
  {
    title: "Operational visibility",
    text: "Deployment history, build logs, container status sync, metrics collection, and monitoring stack integrations.",
    icon: Activity,
  },
  {
    title: "Databases and backups foundation",
    text: "Database provisioning and backup workflows are part of the product surface and need continued hardening.",
    icon: Database,
  },
  {
    title: "Self-hosted control plane",
    text: "Designed for teams that want a Vercel-like flow on infrastructure they control, including Docker and Proxmox paths.",
    icon: Server,
  },
]

const comparisonRows = [
  {
    capability: "Git repo import and branch deploy",
    leaders: "Vercel, Netlify, Render, Railway, Amplify",
    guildServer: "Implemented for GitHub and generic Git; needs smoother repo permission recovery and provider expansion.",
    status: "has",
  },
  {
    capability: "Automatic build detection",
    leaders: "Render, Railway, DigitalOcean App Platform, Heroku buildpacks",
    guildServer: "Node, Python, Go, static, Dockerfile, and FastAPI template handling exist; needs broader framework test coverage.",
    status: "has",
  },
  {
    capability: "Preview environments for pull requests",
    leaders: "Vercel, Netlify, Render, Railway, Heroku Review Apps",
    guildServer: "Webhook and preview concepts exist, but PR preview UX and cleanup policies need product hardening.",
    status: "partial",
  },
  {
    capability: "Autoscaling",
    leaders: "DigitalOcean App Platform, Render, Heroku, Fly.io",
    guildServer: "Current Docker-local flow runs containers reliably; autoscaling policy and replica orchestration should be next.",
    status: "gap",
  },
  {
    capability: "Global edge network and CDN",
    leaders: "Vercel, Cloudflare, Netlify, Amplify",
    guildServer: "Cloudflare/Traefik routing path exists, but global CDN, cache controls, and edge functions are not yet a platform layer.",
    status: "gap",
  },
  {
    capability: "Managed databases",
    leaders: "Railway, Render, Heroku add-ons, DigitalOcean",
    guildServer: "Database workflows exist; production readiness needs clear supported engines, backups, restores, and metrics.",
    status: "partial",
  },
  {
    capability: "Secrets and environment management",
    leaders: "Vercel, Railway, Render, Netlify, Heroku",
    guildServer: "Environment variables exist; needs stronger secret UX, variable scopes, previews, and audit-friendly rotation.",
    status: "partial",
  },
  {
    capability: "Team controls and audit trail",
    leaders: "Vercel, AWS Amplify, Heroku Enterprise, Render",
    guildServer: "Organizations, members, and audit surfaces exist; needs policy polish, SSO/SAML, and enterprise permission presets.",
    status: "partial",
  },
  {
    capability: "Marketplace/add-ons",
    leaders: "Heroku Elements, Netlify integrations, Vercel Marketplace",
    guildServer: "Not yet a product advantage. Start with first-party templates and database/service blueprints before marketplace.",
    status: "gap",
  },
]

const roadmap = [
  "Repo import should feel like Vercel: connect GitHub, select repo, select branch, deploy without asking for build internals.",
  "Every failed deploy needs a plain-English diagnosis: clone, build, runtime, health check, or missing environment variable.",
  "Preview deployments need PR comments, automatic cleanup, and branch-specific variables.",
  "Databases need restore verification, connection strings, backups, and usage metrics in the app detail view.",
  "Autoscaling should start simple: min/max replicas, CPU or memory target, and clear monthly cost impact before deploy.",
]

const competitorNotes = [
  { name: "Vercel", note: "Best-in-class frontend and Git workflow; strong DX, previews, edge platform.", price: "Pro from $20/user/mo" },
  { name: "DigitalOcean App Platform", note: "Simple app platform with static and dynamic apps, autoscaling, and optional dedicated egress IPs.", price: "Dynamic apps from about $5/mo" },
  { name: "AWS Amplify", note: "Strong AWS-native full-stack app path with auth, backend resources, and pay-as-you-go hosting.", price: "Free Tier, then usage-based" },
  { name: "Cloudflare Pages + Workers", note: "Global static hosting plus serverless backend on Cloudflare's network.", price: "Pages free; Workers paid plan from $5/mo" },
  { name: "Netlify", note: "Fast static/full-stack workflow with deploy previews, functions, AI agent hooks, and database product.", price: "Free; Personal from $9/mo" },
  { name: "Render", note: "Broad service model: web services, private services, workers, cron, Postgres, IaC, autoscaling.", price: "Free workspace; paid compute varies" },
  { name: "Railway", note: "Strong full-stack deployment, variables, databases, volumes, health checks, and rollback UX.", price: "Free/hobby usage-credit model" },
  { name: "Heroku", note: "Mature dyno runtime, add-ons, pipelines, review apps, metrics, and enterprise isolation.", price: "Eco $5; Basic dyno $7/mo" },
  { name: "Fly.io", note: "Global machines close to users, fast boots, multi-region primitives, and scale-to-zero patterns.", price: "Usage-based; support plans from $29/mo" },
]

function StatusMark({ status }: { status: string }) {
  if (status === "has") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
        <Check className="h-3.5 w-3.5" />
        Have
      </span>
    )
  }

  if (status === "partial") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/25 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-700 dark:text-amber-300">
        <AlertTriangle className="h-3.5 w-3.5" />
        Partial
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/25 bg-rose-500/10 px-2.5 py-1 text-xs font-medium text-rose-700 dark:text-rose-300">
      <X className="h-3.5 w-3.5" />
      Gap
    </span>
  )
}

export default function HomePage() {
  return (
    <div className="min-h-screen overflow-hidden bg-[#f6f3ec] text-[#181713] dark:bg-[#090b0a] dark:text-[#f6f3ec]">
      <header className="sticky top-0 z-50 border-b border-black/10 bg-[#f6f3ec]/85 backdrop-blur-xl dark:border-white/10 dark:bg-[#090b0a]/85">
        <div className="main-container flex h-16 items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-black/10 bg-black text-white dark:border-white/15 dark:bg-white dark:text-black">
              <Network className="h-4 w-4" />
            </span>
            <span className="text-lg font-semibold tracking-tight">GuildServer</span>
          </Link>

          <nav className="hidden items-center gap-6 text-sm text-black/60 dark:text-white/60 md:flex">
            <Link href="#deploy" className="transition-colors hover:text-black dark:hover:text-white">Deploy</Link>
            <Link href="#platform" className="transition-colors hover:text-black dark:hover:text-white">Platform</Link>
            <Link href="#comparison" className="transition-colors hover:text-black dark:hover:text-white">Comparison</Link>
            <Link href="#roadmap" className="transition-colors hover:text-black dark:hover:text-white">Roadmap</Link>
            <Link href="/pricing" className="transition-colors hover:text-black dark:hover:text-white">Pricing</Link>
          </nav>

          <div className="flex items-center gap-3">
            <ThemeToggle />
            <Link href="/auth/login" className="hidden text-sm text-black/60 transition-colors hover:text-black dark:text-white/60 dark:hover:text-white sm:block">
              Log in
            </Link>
            <Button asChild size="sm" className="rounded-full bg-[#181713] text-white hover:bg-[#181713]/90 dark:bg-white dark:text-black dark:hover:bg-white/90">
              <Link href="/auth/register">Start deploying</Link>
            </Button>
          </div>
        </div>
      </header>

      <main>
        <section className="relative">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(69,116,87,0.22),transparent_30%),radial-gradient(circle_at_80%_0%,rgba(221,137,74,0.18),transparent_34%),linear-gradient(90deg,rgba(0,0,0,0.055)_1px,transparent_1px),linear-gradient(rgba(0,0,0,0.055)_1px,transparent_1px)] bg-[size:auto,auto,56px_56px,56px_56px] dark:bg-[radial-gradient(circle_at_20%_20%,rgba(82,173,114,0.18),transparent_30%),radial-gradient(circle_at_80%_0%,rgba(221,137,74,0.14),transparent_34%),linear-gradient(90deg,rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(rgba(255,255,255,0.06)_1px,transparent_1px)]" />
          <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[#f6f3ec] to-transparent dark:from-[#090b0a]" />

          <div className="main-container relative grid gap-12 py-20 md:grid-cols-[1.05fr_0.95fr] md:py-28 lg:py-32">
            <div className="flex flex-col justify-center">
              <Badge className="mb-7 w-fit rounded-full border-black/10 bg-white/70 px-3 py-1 text-black/70 shadow-sm dark:border-white/10 dark:bg-white/10 dark:text-white/75">
                Private-cloud PaaS for Git, Docker, and VPS-backed teams
              </Badge>

              <h1 className="max-w-4xl text-5xl font-black leading-[0.95] tracking-[-0.06em] text-[#181713] dark:text-white md:text-7xl lg:text-8xl">
                Ship like Vercel. Run it on your own cloud.
              </h1>

              <p className="mt-7 max-w-2xl text-lg leading-8 text-black/65 dark:text-white/65 md:text-xl">
                GuildServer turns GitHub repositories, Docker images, databases, and VPS capacity into one deployment control plane. The goal is simple: pick a repo, choose a branch, deploy, and see exactly why it worked or failed.
              </p>

              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <Button asChild size="lg" className="h-12 rounded-full bg-[#181713] px-7 text-white hover:bg-[#181713]/90 dark:bg-white dark:text-black dark:hover:bg-white/90">
                  <Link href="/auth/register">
                    Deploy from GitHub
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="outline" className="h-12 rounded-full border-black/15 bg-white/50 px-7 text-[#181713] hover:bg-white dark:border-white/15 dark:bg-white/10 dark:text-white dark:hover:bg-white/15">
                  <Link href="#comparison">See what to build next</Link>
                </Button>
              </div>

              <div className="mt-10 grid max-w-2xl grid-cols-3 gap-3 text-sm">
                <div className="rounded-2xl border border-black/10 bg-white/55 p-4 dark:border-white/10 dark:bg-white/[0.06]">
                  <p className="text-2xl font-black tracking-tight">Git</p>
                  <p className="mt-1 text-black/55 dark:text-white/55">Repo and branch deploys</p>
                </div>
                <div className="rounded-2xl border border-black/10 bg-white/55 p-4 dark:border-white/10 dark:bg-white/[0.06]">
                  <p className="text-2xl font-black tracking-tight">Docker</p>
                  <p className="mt-1 text-black/55 dark:text-white/55">Images and generated builds</p>
                </div>
                <div className="rounded-2xl border border-black/10 bg-white/55 p-4 dark:border-white/10 dark:bg-white/[0.06]">
                  <p className="text-2xl font-black tracking-tight">VPS</p>
                  <p className="mt-1 text-black/55 dark:text-white/55">Infrastructure you control</p>
                </div>
              </div>
            </div>

            <div id="deploy" className="relative">
              <div className="absolute -inset-6 rounded-[2.5rem] bg-[#dd894a]/20 blur-3xl dark:bg-[#52ad72]/15" />
              <div className="relative rounded-[2rem] border border-black/10 bg-[#12140f] p-4 shadow-2xl shadow-black/20 dark:border-white/10">
                <div className="mb-4 flex items-center justify-between border-b border-white/10 pb-4">
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full bg-[#ff6b5f]" />
                    <span className="h-3 w-3 rounded-full bg-[#f4bd4f]" />
                    <span className="h-3 w-3 rounded-full bg-[#52ad72]" />
                  </div>
                  <span className="rounded-full border border-white/10 px-3 py-1 font-mono text-xs text-white/50">live deploy</span>
                </div>

                <div className="space-y-3">
                  {deploySteps.map((step, index) => {
                    const Icon = step.icon
                    return (
                      <div key={step.label} className="group grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-black">
                          <Icon className="h-5 w-5" />
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-white">{step.label}</p>
                          <p className="mt-1 font-mono text-xs text-white/50">{step.value}</p>
                        </div>
                        <div className="flex items-center gap-2 text-white/40">
                          <span className="font-mono text-xs">{String(index + 1).padStart(2, "0")}</span>
                          <ChevronRight className="h-4 w-4" />
                        </div>
                      </div>
                    )
                  })}
                </div>

                <div className="mt-4 rounded-2xl border border-[#52ad72]/25 bg-[#52ad72]/10 p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-[#a8f0c0]">
                    <CircleDot className="h-4 w-4 animate-pulse" />
                    Deployment verified
                  </div>
                  <pre className="mt-3 overflow-x-auto text-xs leading-6 text-white/65">
{`$ guildserver deploy github.com/team/api --branch main
Detected Node.js backend
Built image gs-api:8f31c2
Health check passed on port 3000
Live at api.guild-technologies.com`}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="platform" className="relative py-20 md:py-28">
          <div className="main-container">
            <div className="mb-12 grid gap-6 md:grid-cols-[0.8fr_1.2fr]">
              <div>
                <p className="text-sm font-bold uppercase tracking-[0.25em] text-[#457457] dark:text-[#8ad7a3]">Platform shape</p>
                <h2 className="mt-3 text-4xl font-black tracking-[-0.04em] md:text-6xl">
                  The product should be honest about what it does today.
                </h2>
              </div>
              <p className="self-end text-lg leading-8 text-black/62 dark:text-white/62">
                The best platforms reduce decisions. Vercel wins on Git flow, Railway wins on full-stack speed, Render wins on service breadth, and Fly.io wins on global machines. GuildServer should win by giving that guided workflow to teams who want private, self-hosted, or hybrid infrastructure.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {currentCapabilities.map((capability) => {
                const Icon = capability.icon
                return (
                  <div key={capability.title} className="rounded-[1.5rem] border border-black/10 bg-white/60 p-6 shadow-sm transition-transform hover:-translate-y-1 dark:border-white/10 dark:bg-white/[0.055]">
                    <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#181713] text-white dark:bg-white dark:text-black">
                      <Icon className="h-5 w-5" />
                    </div>
                    <h3 className="text-xl font-bold tracking-tight">{capability.title}</h3>
                    <p className="mt-3 leading-7 text-black/60 dark:text-white/60">{capability.text}</p>
                  </div>
                )
              })}
            </div>
          </div>
        </section>

        <section className="border-y border-black/10 bg-[#181713] py-20 text-white dark:border-white/10 md:py-28">
          <div className="main-container">
            <div className="grid gap-8 md:grid-cols-[0.9fr_1.1fr]">
              <div>
                <p className="text-sm font-bold uppercase tracking-[0.25em] text-[#dd894a]">Borrow the right lessons</p>
                <h2 className="mt-3 text-4xl font-black tracking-[-0.04em] md:text-6xl">
                  What the market already taught us.
                </h2>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {competitorNotes.map((competitor) => (
                  <div key={competitor.name} className="rounded-2xl border border-white/10 bg-white/[0.045] p-4">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="font-bold">{competitor.name}</h3>
                      <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] text-white/65">{competitor.price}</span>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-white/60">{competitor.note}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section id="comparison" className="py-20 md:py-28">
          <div className="main-container">
            <div className="mx-auto mb-12 max-w-3xl text-center">
              <p className="text-sm font-bold uppercase tracking-[0.25em] text-[#457457] dark:text-[#8ad7a3]">Gap matrix</p>
              <h2 className="mt-3 text-4xl font-black tracking-[-0.04em] md:text-6xl">
                What they have, what GuildServer needs.
              </h2>
              <p className="mt-5 text-lg leading-8 text-black/62 dark:text-white/62">
                This should stay visible on the landing page for now. It creates trust, guides the roadmap, and makes the product feel serious.
              </p>
            </div>

            <div className="overflow-hidden rounded-[1.75rem] border border-black/10 bg-white/70 shadow-sm dark:border-white/10 dark:bg-white/[0.055]">
              <div className="hidden grid-cols-[1fr_1fr_1.35fr_110px] gap-0 border-b border-black/10 bg-black/[0.035] px-5 py-4 text-xs font-bold uppercase tracking-[0.18em] text-black/50 dark:border-white/10 dark:bg-white/[0.045] dark:text-white/45 md:grid">
                <span>Capability</span>
                <span>Market leaders</span>
                <span>GuildServer position</span>
                <span>Status</span>
              </div>
              {comparisonRows.map((row) => (
                <div key={row.capability} className="grid gap-4 border-b border-black/10 px-5 py-5 last:border-b-0 dark:border-white/10 md:grid-cols-[1fr_1fr_1.35fr_110px] md:items-center">
                  <div>
                    <p className="font-bold">{row.capability}</p>
                  </div>
                  <p className="text-sm leading-6 text-black/58 dark:text-white/58">{row.leaders}</p>
                  <p className="text-sm leading-6 text-black/68 dark:text-white/68">{row.guildServer}</p>
                  <StatusMark status={row.status} />
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="roadmap" className="relative overflow-hidden border-y border-black/10 bg-[#ede7da] py-20 dark:border-white/10 dark:bg-[#10130f] md:py-28">
          <div className="absolute right-0 top-0 h-72 w-72 rounded-full bg-[#dd894a]/20 blur-3xl" />
          <div className="main-container relative grid gap-10 md:grid-cols-[0.85fr_1.15fr]">
            <div>
              <Badge className="rounded-full border-black/10 bg-white/70 px-3 py-1 text-black/70 dark:border-white/10 dark:bg-white/10 dark:text-white/70">
                Product priority
              </Badge>
              <h2 className="mt-5 text-4xl font-black tracking-[-0.04em] md:text-6xl">
                Make GitHub deploys feel boring.
              </h2>
              <p className="mt-5 text-lg leading-8 text-black/62 dark:text-white/62">
                Boring is the compliment: no 404s, no guessed commands, no hidden build failure, no unclear next step.
              </p>
            </div>

            <div className="space-y-3">
              {roadmap.map((item, index) => (
                <div key={item} className="grid grid-cols-[auto_1fr] gap-4 rounded-2xl border border-black/10 bg-white/65 p-5 dark:border-white/10 dark:bg-white/[0.06]">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#181713] font-mono text-xs font-bold text-white dark:bg-white dark:text-black">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <p className="leading-7 text-black/70 dark:text-white/70">{item}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="py-20 md:py-28">
          <div className="main-container">
            <div className="grid overflow-hidden rounded-[2rem] border border-black/10 bg-[#181713] text-white shadow-2xl shadow-black/15 dark:border-white/10 md:grid-cols-[1fr_0.8fr]">
              <div className="p-8 md:p-12">
                <div className="mb-6 flex items-center gap-2 text-[#8ad7a3]">
                  <Sparkles className="h-5 w-5" />
                  <span className="text-sm font-bold uppercase tracking-[0.2em]">Next action</span>
                </div>
                <h2 className="max-w-2xl text-4xl font-black tracking-[-0.04em] md:text-6xl">
                  Start with the flow users already expect.
                </h2>
                <p className="mt-5 max-w-2xl text-lg leading-8 text-white/62">
                  Connect GitHub, select a repository, pick a branch, deploy, and get a readable result. Once that is perfect, add previews, autoscaling, and databases as deliberate upgrades.
                </p>
                <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                  <Button asChild size="lg" className="h-12 rounded-full bg-white px-7 text-black hover:bg-white/90">
                    <Link href="/auth/register">
                      Connect GitHub
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                  <Button asChild size="lg" variant="outline" className="h-12 rounded-full border-white/15 bg-transparent px-7 text-white hover:bg-white/10 hover:text-white">
                    <Link href="/dashboard/templates">Browse templates</Link>
                  </Button>
                </div>
              </div>
              <div className="border-t border-white/10 bg-white/[0.04] p-8 md:border-l md:border-t-0 md:p-10">
                <div className="space-y-4">
                  {[
                    ["Clone", "branch fallback, private repo auth"],
                    ["Build", "detected stack and generated Dockerfile"],
                    ["Run", "container logs and health check"],
                    ["Explain", "plain-English failure reason"],
                  ].map(([label, detail]) => (
                    <div key={label} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                      <div className="flex items-center gap-2">
                        <Zap className="h-4 w-4 text-[#dd894a]" />
                        <p className="font-bold">{label}</p>
                      </div>
                      <p className="mt-2 text-sm text-white/55">{detail}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-black/10 bg-[#f6f3ec] py-10 dark:border-white/10 dark:bg-[#090b0a]">
        <div className="main-container flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#181713] text-white dark:bg-white dark:text-black">
                <Cloud className="h-4 w-4" />
              </span>
              <span className="font-bold">GuildServer</span>
            </div>
            <p className="mt-3 max-w-md text-sm leading-6 text-black/55 dark:text-white/55">
              A private-cloud deployment platform for teams that want excellent Git workflow without giving up infrastructure control.
            </p>
          </div>
          <div className="flex flex-wrap gap-4 text-sm text-black/55 dark:text-white/55">
            <Link href="#deploy" className="hover:text-black dark:hover:text-white">Deploy</Link>
            <Link href="#platform" className="hover:text-black dark:hover:text-white">Platform</Link>
            <Link href="#comparison" className="hover:text-black dark:hover:text-white">Comparison</Link>
            <Link href="/pricing" className="hover:text-black dark:hover:text-white">Pricing</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
