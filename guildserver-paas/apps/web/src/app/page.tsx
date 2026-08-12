import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ThemeToggle } from "@/components/theme-toggle"
import {
  Activity,
  ArrowRight,
  Boxes,
  Check,
  ChevronRight,
  CircleDot,
  Cloud,
  Code2,
  Database,
  GitBranch,
  Globe2,
  KeyRound,
  Layers3,
  Lock,
  Network,
  Play,
  Route,
  Server,
  ShieldCheck,
  Sparkles,
  Terminal,
  Workflow,
  Zap,
} from "lucide-react"
import Link from "next/link"

const deploySequence = [
  { title: "Import", detail: "GitHub repo + branch", icon: GitBranch },
  { title: "Build", detail: "Dockerfile or auto-detected stack", icon: Code2 },
  { title: "Run", detail: "Container, port, health check", icon: Boxes },
  { title: "Route", detail: "Domain, TLS, live logs", icon: Route },
]

const platformCards = [
  {
    title: "Git deployments that explain themselves",
    description: "Connect a repository, pick a branch, deploy, and get readable build output when something needs attention.",
    icon: GitBranch,
  },
  {
    title: "Docker when you need control",
    description: "Bring an image or let GuildServer generate one. You still get routing, health checks, logs, and restart behavior.",
    icon: Boxes,
  },
  {
    title: "Databases beside your apps",
    description: "Keep applications, databases, backups, and connection details in the same workspace instead of scattered tools.",
    icon: Database,
  },
  {
    title: "Domains without the ceremony",
    description: "Generated URLs, custom domains, TLS routing, and clear instructions for DNS verification.",
    icon: Globe2,
  },
  {
    title: "Operations in the product",
    description: "Deployment history, container state, resource metrics, and logs stay close to the app that produced them.",
    icon: Activity,
  },
  {
    title: "Infrastructure you can grow into",
    description: "Start with simple app deployments and expand toward VPS capacity, Docker hosts, and private infrastructure.",
    icon: Server,
  },
]

const workflows = [
  {
    label: "For backend APIs",
    title: "Push an Express, FastAPI, Django, Go, or Docker app.",
    points: ["Auto-detect common stacks", "Expose the right port", "Show logs during health checks"],
  },
  {
    label: "For SaaS projects",
    title: "Keep web apps, workers, databases, and domains together.",
    points: ["One dashboard per project", "Environment variables per app", "Deployment history and rollbacks"],
  },
  {
    label: "For lean infrastructure teams",
    title: "Give developers a clean deploy button without hiding the machine.",
    points: ["Container-first runtime", "Observable failures", "Room for private-cloud growth"],
  },
]

const proofItems = [
  "Clone fallback when a repo default branch is not main",
  "Generated Dockerfiles for Node and Python projects",
  "Health checks that probe the deployed container",
  "GitHub OAuth routes for browser and API clients",
  "Production routing through the GuildServer domain layer",
]

const principles = [
  { title: "One clear path", text: "Import from GitHub, confirm the branch, and deploy. Advanced settings should help, not block the first launch." },
  { title: "Failure with direction", text: "A failed deployment should say whether clone, build, runtime, health check, or configuration caused it." },
  { title: "Own the runtime", text: "GuildServer is built around real containers and real infrastructure, so teams can inspect what is running." },
]

export default function HomePage() {
  return (
    <div className="min-h-screen overflow-hidden bg-[#fbfaf6] text-[#171713] dark:bg-[#080c0a] dark:text-[#f8f6ee]">
      <header className="sticky top-0 z-50 border-b border-[#171713]/10 bg-[#fbfaf6]/86 backdrop-blur-xl dark:border-white/10 dark:bg-[#080c0a]/86">
        <div className="main-container flex h-16 items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#171713] text-white shadow-sm dark:bg-[#f8f6ee] dark:text-[#080c0a]">
              <Network className="h-4 w-4" />
            </span>
            <span className="text-lg font-black tracking-[-0.03em]">GuildServer</span>
          </Link>

          <nav className="hidden items-center gap-6 text-sm text-[#171713]/62 dark:text-white/62 md:flex">
            <Link href="#platform" className="transition-colors hover:text-[#171713] dark:hover:text-white">Platform</Link>
            <Link href="#workflow" className="transition-colors hover:text-[#171713] dark:hover:text-white">Workflow</Link>
            <Link href="#use-cases" className="transition-colors hover:text-[#171713] dark:hover:text-white">Use cases</Link>
            <Link href="/pricing" className="transition-colors hover:text-[#171713] dark:hover:text-white">Pricing</Link>
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
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(39,95,74,0.18),transparent_28%),radial-gradient(circle_at_78%_12%,rgba(238,164,83,0.20),transparent_32%),linear-gradient(90deg,rgba(23,23,19,0.055)_1px,transparent_1px),linear-gradient(rgba(23,23,19,0.055)_1px,transparent_1px)] bg-[size:auto,auto,52px_52px,52px_52px] dark:bg-[radial-gradient(circle_at_18%_18%,rgba(66,185,127,0.14),transparent_28%),radial-gradient(circle_at_78%_12%,rgba(238,164,83,0.12),transparent_32%),linear-gradient(90deg,rgba(255,255,255,0.055)_1px,transparent_1px),linear-gradient(rgba(255,255,255,0.055)_1px,transparent_1px)]" />
          <div className="absolute inset-x-0 bottom-0 h-44 bg-gradient-to-t from-[#fbfaf6] to-transparent dark:from-[#080c0a]" />

          <div className="main-container relative grid gap-12 py-20 md:grid-cols-[1.08fr_0.92fr] md:py-28 lg:py-32">
            <div className="flex flex-col justify-center">
              <Badge className="mb-7 w-fit rounded-full border-[#171713]/10 bg-white/75 px-3 py-1 text-[#171713]/70 shadow-sm dark:border-white/10 dark:bg-white/10 dark:text-white/75">
                Git, Docker, databases, and VPS hosting in one workspace
              </Badge>

              <h1 className="max-w-4xl text-5xl font-black leading-[0.94] tracking-[-0.065em] text-[#171713] dark:text-white md:text-7xl lg:text-8xl">
                Deploy apps without the infrastructure drag.
              </h1>

              <p className="mt-7 max-w-2xl text-lg leading-8 text-[#171713]/66 dark:text-white/66 md:text-xl">
                GuildServer gives teams a clean path from repository to live service: build the app, run the container, attach the domain, watch the logs, and keep moving.
              </p>

              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <Button asChild size="lg" className="h-12 rounded-full bg-[#171713] px-7 text-white hover:bg-[#171713]/90 dark:bg-[#f8f6ee] dark:text-[#080c0a] dark:hover:bg-white/90">
                  <Link href="/auth/register">
                    Deploy your first app
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="outline" className="h-12 rounded-full border-[#171713]/15 bg-white/55 px-7 text-[#171713] hover:bg-white dark:border-white/15 dark:bg-white/10 dark:text-white dark:hover:bg-white/15">
                  <Link href="#workflow">
                    See the workflow
                    <Play className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              </div>

              <div className="mt-10 grid max-w-2xl grid-cols-1 gap-3 sm:grid-cols-3">
                {[
                  ["GitHub first", "Repo, branch, deploy"],
                  ["Container native", "Dockerfile or generated image"],
                  ["Visible runtime", "Logs, health, domains"],
                ].map(([title, detail]) => (
                  <div key={title} className="rounded-2xl border border-[#171713]/10 bg-white/60 p-4 dark:border-white/10 dark:bg-white/[0.06]">
                    <p className="font-black tracking-tight">{title}</p>
                    <p className="mt-1 text-sm text-[#171713]/55 dark:text-white/55">{detail}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="relative">
              <div className="absolute -inset-7 rounded-[2.75rem] bg-[#eba453]/24 blur-3xl dark:bg-[#42b97f]/15" />
              <div className="relative rounded-[2rem] border border-[#171713]/10 bg-[#11150f] p-4 shadow-2xl shadow-black/20 dark:border-white/10">
                <div className="mb-4 flex items-center justify-between border-b border-white/10 pb-4">
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full bg-[#ff6d62]" />
                    <span className="h-3 w-3 rounded-full bg-[#f5be51]" />
                    <span className="h-3 w-3 rounded-full bg-[#49c17d]" />
                  </div>
                  <span className="rounded-full border border-white/10 px-3 py-1 font-mono text-xs text-white/50">deployment console</span>
                </div>

                <div className="space-y-3">
                  {deploySequence.map((step, index) => {
                    const Icon = step.icon
                    return (
                      <div key={step.title} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.045] p-4">
                        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-black">
                          <Icon className="h-5 w-5" />
                        </div>
                        <div>
                          <p className="text-sm font-bold text-white">{step.title}</p>
                          <p className="mt-1 font-mono text-xs text-white/50">{step.detail}</p>
                        </div>
                        <div className="flex items-center gap-2 text-white/36">
                          <span className="font-mono text-xs">{String(index + 1).padStart(2, "0")}</span>
                          <ChevronRight className="h-4 w-4" />
                        </div>
                      </div>
                    )
                  })}
                </div>

                <div className="mt-4 rounded-2xl border border-[#49c17d]/25 bg-[#49c17d]/10 p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-[#a8efc2]">
                    <CircleDot className="h-4 w-4 animate-pulse" />
                    Live service
                  </div>
                  <pre className="mt-3 overflow-x-auto text-xs leading-6 text-white/65">
{`main  8f31c2  built
api   healthy  port 3000
tls   issued   api.guildserver.app
logs  streaming`}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="platform" className="py-20 md:py-28">
          <div className="main-container">
            <div className="mb-12 grid gap-6 md:grid-cols-[0.85fr_1.15fr]">
              <div>
                <p className="text-sm font-bold uppercase tracking-[0.25em] text-[#276f54] dark:text-[#85d9a8]">Platform</p>
                <h2 className="mt-3 text-4xl font-black tracking-[-0.045em] md:text-6xl">
                  Everything around deployment, in one place.
                </h2>
              </div>
              <p className="self-end text-lg leading-8 text-[#171713]/62 dark:text-white/62">
                A good platform does not ask developers to stitch together clone logs, Docker output, DNS notes, and container health in four tools. GuildServer keeps those steps connected.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {platformCards.map((card) => {
                const Icon = card.icon
                return (
                  <div key={card.title} className="rounded-[1.5rem] border border-[#171713]/10 bg-white/66 p-6 shadow-sm transition-transform hover:-translate-y-1 dark:border-white/10 dark:bg-white/[0.055]">
                    <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#171713] text-white dark:bg-white dark:text-[#080c0a]">
                      <Icon className="h-5 w-5" />
                    </div>
                    <h3 className="text-xl font-bold tracking-tight">{card.title}</h3>
                    <p className="mt-3 leading-7 text-[#171713]/60 dark:text-white/60">{card.description}</p>
                  </div>
                )
              })}
            </div>
          </div>
        </section>

        <section id="workflow" className="border-y border-[#171713]/10 bg-[#171713] py-20 text-white dark:border-white/10 md:py-28">
          <div className="main-container">
            <div className="grid gap-10 md:grid-cols-[0.9fr_1.1fr]">
              <div>
                <p className="text-sm font-bold uppercase tracking-[0.25em] text-[#eba453]">Workflow</p>
                <h2 className="mt-3 text-4xl font-black tracking-[-0.045em] md:text-6xl">
                  From push to production without guesswork.
                </h2>
                <p className="mt-5 text-lg leading-8 text-white/62">
                  The deploy path is designed to be readable: what changed, what was detected, what image was built, where it is running, and what to fix if it fails.
                </p>
              </div>

              <div className="rounded-[1.75rem] border border-white/10 bg-white/[0.045] p-5">
                <div className="rounded-2xl bg-black/35 p-5 font-mono text-sm leading-7 text-white/72">
                  <p><span className="text-[#85d9a8]">$</span> connect github.com/acme/billing-api</p>
                  <p className="text-white/45">repo access verified</p>
                  <p><span className="text-[#85d9a8]">$</span> deploy main</p>
                  <p className="text-white/45">detected Node backend</p>
                  <p className="text-white/45">generated Dockerfile</p>
                  <p className="text-white/45">container healthy on port 3000</p>
                  <p className="text-[#85d9a8]">live at billing-api.guildserver.app</p>
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  {proofItems.map((item) => (
                    <div key={item} className="flex gap-3 rounded-2xl border border-white/10 bg-black/15 p-4">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#85d9a8]" />
                      <p className="text-sm leading-6 text-white/68">{item}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="use-cases" className="py-20 md:py-28">
          <div className="main-container">
            <div className="mx-auto mb-12 max-w-3xl text-center">
              <p className="text-sm font-bold uppercase tracking-[0.25em] text-[#276f54] dark:text-[#85d9a8]">Use cases</p>
              <h2 className="mt-3 text-4xl font-black tracking-[-0.045em] md:text-6xl">
                Built for teams shipping real services.
              </h2>
              <p className="mt-5 text-lg leading-8 text-[#171713]/62 dark:text-white/62">
                Marketing sites are only one workload. GuildServer is shaped around backends, workers, databases, dashboards, and the infrastructure they depend on.
              </p>
            </div>

            <div className="grid gap-5 lg:grid-cols-3">
              {workflows.map((workflow) => (
                <div key={workflow.label} className="rounded-[1.75rem] border border-[#171713]/10 bg-white/68 p-6 shadow-sm dark:border-white/10 dark:bg-white/[0.055]">
                  <span className="rounded-full bg-[#276f54]/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.16em] text-[#276f54] dark:bg-[#85d9a8]/10 dark:text-[#85d9a8]">
                    {workflow.label}
                  </span>
                  <h3 className="mt-5 text-2xl font-black tracking-[-0.035em]">{workflow.title}</h3>
                  <div className="mt-6 space-y-3">
                    {workflow.points.map((point) => (
                      <div key={point} className="flex gap-3">
                        <Check className="mt-1 h-4 w-4 shrink-0 text-[#276f54] dark:text-[#85d9a8]" />
                        <p className="text-sm leading-6 text-[#171713]/64 dark:text-white/64">{point}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="relative overflow-hidden border-y border-[#171713]/10 bg-[#efe8da] py-20 dark:border-white/10 dark:bg-[#10140f] md:py-28">
          <div className="absolute right-0 top-0 h-72 w-72 rounded-full bg-[#eba453]/25 blur-3xl" />
          <div className="main-container relative grid gap-10 md:grid-cols-[0.82fr_1.18fr]">
            <div>
              <Badge className="rounded-full border-[#171713]/10 bg-white/70 px-3 py-1 text-[#171713]/70 dark:border-white/10 dark:bg-white/10 dark:text-white/70">
                Product promise
              </Badge>
              <h2 className="mt-5 text-4xl font-black tracking-[-0.045em] md:text-6xl">
                Deploy fast. Understand every step.
              </h2>
              <p className="mt-5 text-lg leading-8 text-[#171713]/62 dark:text-white/62">
                Fast deploys are only useful when teams can trust them. GuildServer should make the path to production simple enough for developers and visible enough for operators.
              </p>
            </div>

            <div className="space-y-3">
              {principles.map((principle, index) => (
                <div key={principle.title} className="grid grid-cols-[auto_1fr] gap-4 rounded-2xl border border-[#171713]/10 bg-white/66 p-5 dark:border-white/10 dark:bg-white/[0.06]">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#171713] font-mono text-xs font-bold text-white dark:bg-white dark:text-[#080c0a]">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <h3 className="font-black tracking-tight">{principle.title}</h3>
                    <p className="mt-2 leading-7 text-[#171713]/66 dark:text-white/66">{principle.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="py-20 md:py-28">
          <div className="main-container">
            <div className="grid overflow-hidden rounded-[2rem] border border-[#171713]/10 bg-[#171713] text-white shadow-2xl shadow-black/15 dark:border-white/10 md:grid-cols-[1fr_0.85fr]">
              <div className="p-8 md:p-12">
                <div className="mb-6 flex items-center gap-2 text-[#85d9a8]">
                  <Sparkles className="h-5 w-5" />
                  <span className="text-sm font-bold uppercase tracking-[0.2em]">Start here</span>
                </div>
                <h2 className="max-w-2xl text-4xl font-black tracking-[-0.045em] md:text-6xl">
                  Bring the repo. GuildServer handles the launch path.
                </h2>
                <p className="mt-5 max-w-2xl text-lg leading-8 text-white/62">
                  Create an account, connect GitHub, choose a branch, and deploy your first service with logs and health checks visible from the start.
                </p>
                <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                  <Button asChild size="lg" className="h-12 rounded-full bg-white px-7 text-black hover:bg-white/90">
                    <Link href="/auth/register">
                      Start deploying
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                  <Button asChild size="lg" variant="outline" className="h-12 rounded-full border-white/15 bg-transparent px-7 text-white hover:bg-white/10 hover:text-white">
                    <Link href="/dashboard/templates">Browse templates</Link>
                  </Button>
                </div>
              </div>
              <div className="grid gap-3 border-t border-white/10 bg-white/[0.04] p-8 md:border-l md:border-t-0 md:p-10">
                {[
                  [Terminal, "CLI and dashboard paths"],
                  [KeyRound, "Environment variables"],
                  [Lock, "TLS and custom domains"],
                  [Layers3, "Apps, databases, and infrastructure"],
                  [ShieldCheck, "Team and audit foundations"],
                  [Workflow, "Deploy history and rollbacks"],
                ].map(([Icon, text]) => {
                  const ItemIcon = Icon as typeof Terminal
                  return (
                    <div key={text as string} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/20 p-4">
                      <ItemIcon className="h-4 w-4 text-[#eba453]" />
                      <p className="text-sm text-white/70">{text as string}</p>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-[#171713]/10 bg-[#fbfaf6] py-10 dark:border-white/10 dark:bg-[#080c0a]">
        <div className="main-container flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#171713] text-white dark:bg-white dark:text-[#080c0a]">
                <Cloud className="h-4 w-4" />
              </span>
              <span className="font-black tracking-tight">GuildServer</span>
            </div>
            <p className="mt-3 max-w-md text-sm leading-6 text-[#171713]/55 dark:text-white/55">
              A deployment workspace for apps, containers, databases, domains, and infrastructure.
            </p>
          </div>
          <div className="flex flex-wrap gap-4 text-sm text-[#171713]/55 dark:text-white/55">
            <Link href="#platform" className="hover:text-[#171713] dark:hover:text-white">Platform</Link>
            <Link href="#workflow" className="hover:text-[#171713] dark:hover:text-white">Workflow</Link>
            <Link href="#use-cases" className="hover:text-[#171713] dark:hover:text-white">Use cases</Link>
            <Link href="/pricing" className="hover:text-[#171713] dark:hover:text-white">Pricing</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
