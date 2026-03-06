"use client"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ThemeToggle } from "@/components/theme-toggle"
import {
  ArrowRight,
  Zap,
  Shield,
  Globe,
  Database,
  Workflow,
  BarChart3,
  Rocket,
  Server,
  GitBranch,
  Terminal,
  Lock,
  Layers,
  Box,
  Cloud,
  Monitor,
  Code2,
  Check,
  Users,
  Cpu,
  HardDrive,
  Activity
} from "lucide-react"
import Link from "next/link"

export default function HomePage() {
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
              <Link href="#features" className="text-muted-foreground hover:text-foreground transition-colors">
                Features
              </Link>
              <Link href="#use-cases" className="text-muted-foreground hover:text-foreground transition-colors">
                Use Cases
              </Link>
              <Link href="#templates" className="text-muted-foreground hover:text-foreground transition-colors">
                Templates
              </Link>
              <Link href="#infrastructure" className="text-muted-foreground hover:text-foreground transition-colors">
                Infrastructure
              </Link>
              <Link href="/pricing" className="text-muted-foreground hover:text-foreground transition-colors">
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
                Sign Up
              </Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative overflow-hidden">
        {/* Animated mesh background */}
        <div className="absolute inset-0 hero-mesh" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-background/50 to-background" />

        {/* Floating gradient orbs */}
        <div className="absolute top-20 left-[10%] w-72 h-72 rounded-full bg-[var(--gradient-1)] opacity-[0.07] blur-[100px] animate-pulse-glow" />
        <div className="absolute top-40 right-[15%] w-96 h-96 rounded-full bg-[var(--gradient-3)] opacity-[0.07] blur-[100px] animate-pulse-glow" style={{ animationDelay: "1.5s" }} />
        <div className="absolute bottom-10 left-[30%] w-80 h-80 rounded-full bg-[var(--gradient-blue-1)] opacity-[0.05] blur-[100px] animate-pulse-glow" style={{ animationDelay: "3s" }} />

        <div className="relative main-container pt-20 pb-24 md:pt-32 md:pb-36">
          <div className="text-center max-w-4xl mx-auto">
            {/* Badge */}
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-border/50 bg-muted/50 backdrop-blur-sm text-sm text-muted-foreground mb-8">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
              </span>
              Enterprise Platform as a Service
            </div>

            {/* Headline */}
            <h1 className="text-5xl md:text-7xl font-bold tracking-tight leading-[1.1] mb-6">
              Deploy and scale
              <br />
              <span className="gradient-text">with confidence</span>
            </h1>

            <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed">
              GuildServer provides enterprise-grade cloud infrastructure to build, deploy,
              and scale applications. From Docker containers to managed databases — everything
              you need in one platform.
            </p>

            {/* CTA Buttons */}
            <div className="flex flex-col sm:flex-row gap-3 justify-center mb-20">
              <Button size="lg" asChild className="h-12 px-8 text-base gradient-bg border-0 text-white hover:opacity-90 transition-opacity shadow-lg shadow-[var(--gradient-1)]/20">
                <Link href="/auth/register">
                  Start Deploying
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" asChild className="h-12 px-8 text-base backdrop-blur-sm">
                <Link href="#features">
                  Get a Demo
                </Link>
              </Button>
            </div>

            {/* Terminal Preview */}
            <div className="max-w-3xl mx-auto">
              <div className="rounded-2xl overflow-hidden shadow-2xl dark:shadow-[0_0_60px_-15px_var(--gradient-1)] border border-border/50 bg-[#0a0a0a]">
                <div className="flex items-center gap-2 px-4 py-3 bg-[#111] border-b border-white/[0.06]">
                  <div className="flex gap-1.5">
                    <div className="w-3 h-3 rounded-full bg-[#ff5f57]" />
                    <div className="w-3 h-3 rounded-full bg-[#febc2e]" />
                    <div className="w-3 h-3 rounded-full bg-[#28c840]" />
                  </div>
                  <span className="ml-2 text-xs text-white/30 font-mono">terminal</span>
                </div>
                <div className="p-6 font-mono text-sm leading-7">
                  <div>
                    <span className="text-white/40">~</span>
                    <span className="text-emerald-400 ml-2">$</span>
                    <span className="text-white ml-2">guildserver deploy --image nginx:alpine</span>
                  </div>
                  <div className="text-white/40 pl-4">▸ Creating application...</div>
                  <div className="text-white/40 pl-4">▸ Pulling image nginx:alpine</div>
                  <div className="text-white/40 pl-4">▸ Starting container...</div>
                  <div className="text-emerald-400 pl-4">✓ Deployed to <span className="underline decoration-emerald-400/30">my-app.guildserver.dev</span></div>
                  <div className="mt-3">
                    <span className="text-white/40">~</span>
                    <span className="text-emerald-400 ml-2">$</span>
                    <span className="text-white ml-2">guildserver status</span>
                  </div>
                  <div className="text-violet-400 pl-4">● my-app          running    2m ago    nginx:alpine</div>
                  <div className="text-sky-400 pl-4">● api-backend      running    1h ago    node:20-alpine</div>
                  <div className="text-pink-400 pl-4">● postgres-db      running    3d ago    postgres:16</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Metrics / Social Proof Section */}
      <section className="border-y border-border/50 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-[var(--gradient-1)]/[0.03] via-[var(--gradient-3)]/[0.03] to-[var(--gradient-5)]/[0.03]" />
        <div className="relative main-container py-16">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-12">
            <div className="text-center">
              <div className="text-4xl md:text-5xl font-bold tracking-tight mb-2 gradient-text">99.9%</div>
              <p className="text-sm text-muted-foreground">Uptime SLA</p>
            </div>
            <div className="text-center">
              <div className="text-4xl md:text-5xl font-bold tracking-tight mb-2 gradient-text-blue">&lt;2s</div>
              <p className="text-sm text-muted-foreground">Average Deploy Time</p>
            </div>
            <div className="text-center">
              <div className="text-4xl md:text-5xl font-bold tracking-tight mb-2 gradient-text-purple">50+</div>
              <p className="text-sm text-muted-foreground">Pre-built Templates</p>
            </div>
            <div className="text-center">
              <div className="text-4xl md:text-5xl font-bold tracking-tight mb-2 gradient-text">24/7</div>
              <p className="text-sm text-muted-foreground">Monitoring & Alerts</p>
            </div>
          </div>
        </div>
      </section>

      {/* Feature Cards Section */}
      <section id="features" className="py-24 md:py-32 relative">
        <div className="absolute top-0 right-[20%] w-[500px] h-[500px] rounded-full bg-[var(--gradient-2)] opacity-[0.04] blur-[120px]" />
        <div className="relative main-container">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-5xl font-bold tracking-tight mb-4">
              Your apps, <span className="gradient-text">delivered</span>
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Everything you need to build, deploy, and manage enterprise applications
              in one unified platform.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* Feature 1 */}
            <div className="group relative rounded-2xl border border-border/50 bg-card p-8 hover:shadow-xl hover:shadow-[var(--gradient-1)]/5 transition-all duration-500 hover:-translate-y-1 overflow-hidden">
              <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 bg-gradient-to-br from-[var(--gradient-1)]/[0.03] to-transparent" />
              <div className="relative">
                <div className="mb-4 inline-flex p-3 rounded-xl bg-gradient-to-br from-[var(--gradient-1)]/10 to-[var(--gradient-2)]/10">
                  <Rocket className="h-6 w-6 text-[var(--gradient-1)]" />
                </div>
                <h3 className="text-xl font-semibold mb-2">Instant Deployments</h3>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  Deploy from Docker images or Git repositories in seconds.
                  Zero-downtime deployments with automatic rollbacks.
                </p>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-emerald-500 shrink-0" />
                    Zero-downtime deployments
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-emerald-500 shrink-0" />
                    Auto-scaling containers
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-emerald-500 shrink-0" />
                    Instant rollbacks
                  </li>
                </ul>
              </div>
            </div>

            {/* Feature 2 */}
            <div className="group relative rounded-2xl border border-border/50 bg-card p-8 hover:shadow-xl hover:shadow-[var(--gradient-2)]/5 transition-all duration-500 hover:-translate-y-1 overflow-hidden">
              <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 bg-gradient-to-br from-[var(--gradient-2)]/[0.03] to-transparent" />
              <div className="relative">
                <div className="mb-4 inline-flex p-3 rounded-xl bg-gradient-to-br from-[var(--gradient-2)]/10 to-[var(--gradient-3)]/10">
                  <Shield className="h-6 w-6 text-[var(--gradient-2)]" />
                </div>
                <h3 className="text-xl font-semibold mb-2">Enterprise Security</h3>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  Bank-grade security with compliance frameworks, audit trails,
                  and role-based access control.
                </p>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-emerald-500 shrink-0" />
                    SOC2 & HIPAA compliance
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-emerald-500 shrink-0" />
                    End-to-end encryption
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-emerald-500 shrink-0" />
                    RBAC & audit logging
                  </li>
                </ul>
              </div>
            </div>

            {/* Feature 3 */}
            <div className="group relative rounded-2xl border border-border/50 bg-card p-8 hover:shadow-xl hover:shadow-[var(--gradient-3)]/5 transition-all duration-500 hover:-translate-y-1 overflow-hidden">
              <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 bg-gradient-to-br from-[var(--gradient-3)]/[0.03] to-transparent" />
              <div className="relative">
                <div className="mb-4 inline-flex p-3 rounded-xl bg-gradient-to-br from-[var(--gradient-orange-1)]/10 to-[var(--gradient-orange-2)]/10">
                  <Database className="h-6 w-6 text-[var(--gradient-orange-1)]" />
                </div>
                <h3 className="text-xl font-semibold mb-2">Managed Databases</h3>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  Provision production-ready databases with automated backups,
                  scaling, and high availability.
                </p>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-emerald-500 shrink-0" />
                    PostgreSQL, MySQL, Redis
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-emerald-500 shrink-0" />
                    Automated daily backups
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-emerald-500 shrink-0" />
                    High availability clusters
                  </li>
                </ul>
              </div>
            </div>

            {/* Feature 4 */}
            <div className="group relative rounded-2xl border border-border/50 bg-card p-8 hover:shadow-xl hover:shadow-[var(--gradient-blue-1)]/5 transition-all duration-500 hover:-translate-y-1 overflow-hidden">
              <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 bg-gradient-to-br from-[var(--gradient-blue-1)]/[0.03] to-transparent" />
              <div className="relative">
                <div className="mb-4 inline-flex p-3 rounded-xl bg-gradient-to-br from-[var(--gradient-blue-1)]/10 to-[var(--gradient-blue-2)]/10">
                  <BarChart3 className="h-6 w-6 text-[var(--gradient-blue-1)]" />
                </div>
                <h3 className="text-xl font-semibold mb-2">Real-time Monitoring</h3>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  Comprehensive observability with metrics, live logs, and
                  intelligent alerting built in.
                </p>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-emerald-500 shrink-0" />
                    CPU & memory metrics
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-emerald-500 shrink-0" />
                    Live log streaming
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-emerald-500 shrink-0" />
                    Custom alert rules
                  </li>
                </ul>
              </div>
            </div>

            {/* Feature 5 */}
            <div className="group relative rounded-2xl border border-border/50 bg-card p-8 hover:shadow-xl hover:shadow-[var(--gradient-green-1)]/5 transition-all duration-500 hover:-translate-y-1 overflow-hidden">
              <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 bg-gradient-to-br from-[var(--gradient-green-1)]/[0.03] to-transparent" />
              <div className="relative">
                <div className="mb-4 inline-flex p-3 rounded-xl bg-gradient-to-br from-[var(--gradient-green-1)]/10 to-[var(--gradient-green-2)]/10">
                  <GitBranch className="h-6 w-6 text-[var(--gradient-green-1)]" />
                </div>
                <h3 className="text-xl font-semibold mb-2">Git Integration</h3>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  Connect your repository and deploy on every push. Preview
                  deployments for every pull request.
                </p>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-emerald-500 shrink-0" />
                    GitHub & GitLab support
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-emerald-500 shrink-0" />
                    Auto-deploy on push
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-emerald-500 shrink-0" />
                    Preview environments
                  </li>
                </ul>
              </div>
            </div>

            {/* Feature 6 */}
            <div className="group relative rounded-2xl border border-border/50 bg-card p-8 hover:shadow-xl hover:shadow-[var(--gradient-4)]/5 transition-all duration-500 hover:-translate-y-1 overflow-hidden">
              <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 bg-gradient-to-br from-[var(--gradient-4)]/[0.03] to-transparent" />
              <div className="relative">
                <div className="mb-4 inline-flex p-3 rounded-xl bg-gradient-to-br from-[var(--gradient-4)]/10 to-[var(--gradient-5)]/10">
                  <Users className="h-6 w-6 text-[var(--gradient-4)]" />
                </div>
                <h3 className="text-xl font-semibold mb-2">Team Collaboration</h3>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  Invite your team, manage roles, and collaborate on projects
                  with built-in workflows.
                </p>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-emerald-500 shrink-0" />
                    Organization management
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-emerald-500 shrink-0" />
                    Role-based permissions
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-emerald-500 shrink-0" />
                    Activity audit trail
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Use Cases Section */}
      <section id="use-cases" className="py-24 md:py-32 border-y border-border/50 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-[var(--gradient-1)]/[0.02] via-transparent to-[var(--gradient-3)]/[0.02]" />
        <div className="relative main-container">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-5xl font-bold tracking-tight mb-4">
              Built for <span className="gradient-text-purple">every workload</span>
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Whether you&apos;re deploying containers, APIs, databases, or full-stack
              applications — GuildServer handles it all.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {/* Use Case 1 */}
            <div className="relative rounded-2xl border border-border/50 bg-card overflow-hidden group hover:shadow-lg transition-all duration-300">
              <div className="absolute inset-0 bg-gradient-to-br from-[var(--gradient-blue-1)]/[0.04] to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="relative p-8">
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2.5 rounded-xl bg-gradient-to-br from-[var(--gradient-blue-1)]/15 to-[var(--gradient-blue-2)]/15">
                    <Box className="h-5 w-5 text-[var(--gradient-blue-1)]" />
                  </div>
                  <h3 className="text-lg font-semibold">Docker Containers</h3>
                </div>
                <p className="text-muted-foreground text-sm leading-relaxed mb-6">
                  Deploy any Docker image with a single command. Automatic port mapping,
                  health checks, and traffic routing included.
                </p>
                <div className="rounded-lg bg-[#0a0a0a] p-4 font-mono text-xs text-white/70 border border-white/[0.06]">
                  <div><span className="text-emerald-400">$</span> guildserver deploy \</div>
                  <div className="pl-4">--image nginx:alpine \</div>
                  <div className="pl-4">--port 80</div>
                  <div className="text-emerald-400 mt-1">✓ Live at my-app.guild.dev</div>
                </div>
              </div>
            </div>

            {/* Use Case 2 */}
            <div className="relative rounded-2xl border border-border/50 bg-card overflow-hidden group hover:shadow-lg transition-all duration-300">
              <div className="absolute inset-0 bg-gradient-to-br from-[var(--gradient-2)]/[0.04] to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="relative p-8">
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2.5 rounded-xl bg-gradient-to-br from-[var(--gradient-2)]/15 to-[var(--gradient-3)]/15">
                    <Code2 className="h-5 w-5 text-[var(--gradient-2)]" />
                  </div>
                  <h3 className="text-lg font-semibold">Full-Stack Apps</h3>
                </div>
                <p className="text-muted-foreground text-sm leading-relaxed mb-6">
                  Push your code and we build it. Auto-detect Node.js, Python, Go, and more.
                  Dockerfile support for custom builds.
                </p>
                <div className="rounded-lg bg-[#0a0a0a] p-4 font-mono text-xs text-white/70 border border-white/[0.06]">
                  <div><span className="text-emerald-400">$</span> git push guild main</div>
                  <div className="text-white/40 mt-1">▸ Detecting Node.js project</div>
                  <div className="text-white/40">▸ Building with npm...</div>
                  <div className="text-emerald-400">✓ Deployed commit a3f2c1d</div>
                </div>
              </div>
            </div>

            {/* Use Case 3 */}
            <div className="relative rounded-2xl border border-border/50 bg-card overflow-hidden group hover:shadow-lg transition-all duration-300">
              <div className="absolute inset-0 bg-gradient-to-br from-[var(--gradient-orange-1)]/[0.04] to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="relative p-8">
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2.5 rounded-xl bg-gradient-to-br from-[var(--gradient-orange-1)]/15 to-[var(--gradient-orange-2)]/15">
                    <Database className="h-5 w-5 text-[var(--gradient-orange-1)]" />
                  </div>
                  <h3 className="text-lg font-semibold">Managed Databases</h3>
                </div>
                <p className="text-muted-foreground text-sm leading-relaxed mb-6">
                  Provision PostgreSQL, MySQL, Redis, or MongoDB instances.
                  Automatic backups, scaling, and connection pooling.
                </p>
                <div className="rounded-lg bg-[#0a0a0a] p-4 font-mono text-xs text-white/70 border border-white/[0.06]">
                  <div><span className="text-emerald-400">$</span> guildserver db create \</div>
                  <div className="pl-4">--type postgres \</div>
                  <div className="pl-4">--name my-db</div>
                  <div className="text-emerald-400 mt-1">✓ postgresql://my-db.guild.dev</div>
                </div>
              </div>
            </div>

            {/* Use Case 4 */}
            <div className="relative rounded-2xl border border-border/50 bg-card overflow-hidden group hover:shadow-lg transition-all duration-300">
              <div className="absolute inset-0 bg-gradient-to-br from-[var(--gradient-green-1)]/[0.04] to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="relative p-8">
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2.5 rounded-xl bg-gradient-to-br from-[var(--gradient-green-1)]/15 to-[var(--gradient-green-2)]/15">
                    <Server className="h-5 w-5 text-[var(--gradient-green-1)]" />
                  </div>
                  <h3 className="text-lg font-semibold">APIs & Microservices</h3>
                </div>
                <p className="text-muted-foreground text-sm leading-relaxed mb-6">
                  Deploy REST or GraphQL APIs with automatic TLS, load balancing,
                  and service discovery across your infrastructure.
                </p>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Check className="h-4 w-4 text-emerald-500" />
                  <span>Auto-TLS with Let&apos;s Encrypt</span>
                </div>
              </div>
            </div>

            {/* Use Case 5 */}
            <div className="relative rounded-2xl border border-border/50 bg-card overflow-hidden group hover:shadow-lg transition-all duration-300">
              <div className="absolute inset-0 bg-gradient-to-br from-[var(--gradient-5)]/[0.04] to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="relative p-8">
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2.5 rounded-xl bg-gradient-to-br from-[var(--gradient-5)]/15 to-[var(--gradient-4)]/15">
                    <Monitor className="h-5 w-5 text-[var(--gradient-5)]" />
                  </div>
                  <h3 className="text-lg font-semibold">Monitoring Stacks</h3>
                </div>
                <p className="text-muted-foreground text-sm leading-relaxed mb-6">
                  Deploy Grafana, Prometheus, or custom dashboards in one click.
                  Built-in metrics collection for all your apps.
                </p>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Check className="h-4 w-4 text-emerald-500" />
                  <span>Real-time CPU, memory & network</span>
                </div>
              </div>
            </div>

            {/* Use Case 6 */}
            <div className="relative rounded-2xl border border-border/50 bg-card overflow-hidden group hover:shadow-lg transition-all duration-300">
              <div className="absolute inset-0 bg-gradient-to-br from-[var(--gradient-1)]/[0.04] to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="relative p-8">
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2.5 rounded-xl bg-gradient-to-br from-[var(--gradient-1)]/15 to-[var(--gradient-2)]/15">
                    <Workflow className="h-5 w-5 text-[var(--gradient-1)]" />
                  </div>
                  <h3 className="text-lg font-semibold">CI/CD Pipelines</h3>
                </div>
                <p className="text-muted-foreground text-sm leading-relaxed mb-6">
                  Automated build and deploy pipelines. Branch-based previews,
                  approval gates, and deployment protection rules.
                </p>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Check className="h-4 w-4 text-emerald-500" />
                  <span>Preview deploys for every PR</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Template Gallery Section */}
      <section id="templates" className="py-24 md:py-32 relative">
        <div className="absolute bottom-0 left-[20%] w-[400px] h-[400px] rounded-full bg-[var(--gradient-3)] opacity-[0.03] blur-[100px]" />
        <div className="relative main-container">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-5xl font-bold tracking-tight mb-4">
              Start with a <span className="gradient-text-blue">template</span>
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Deploy production-ready applications in seconds. Choose from our curated
              collection of templates.
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {[
              { name: "Nginx", icon: "🌐", desc: "Web Server" },
              { name: "Node.js", icon: "⬢", desc: "Runtime" },
              { name: "Python", icon: "🐍", desc: "Framework" },
              { name: "PostgreSQL", icon: "🐘", desc: "Database" },
              { name: "Redis", icon: "◆", desc: "Cache" },
              { name: "Go", icon: "🔷", desc: "Runtime" },
              { name: "MySQL", icon: "🗄️", desc: "Database" },
              { name: "MongoDB", icon: "🍃", desc: "Database" },
              { name: "Grafana", icon: "📊", desc: "Monitoring" },
              { name: "Caddy", icon: "🔒", desc: "Web Server" },
              { name: "RabbitMQ", icon: "🐇", desc: "Messaging" },
              { name: "MinIO", icon: "📦", desc: "Storage" },
            ].map((template) => (
              <Link
                key={template.name}
                href="/dashboard/templates"
                className="group flex flex-col items-center gap-3 rounded-xl border border-border/50 bg-card p-6 hover:shadow-lg hover:shadow-[var(--gradient-1)]/5 hover:-translate-y-1 transition-all duration-300 hover:border-[var(--gradient-1)]/20"
              >
                <span className="text-3xl">{template.icon}</span>
                <div className="text-center">
                  <p className="font-medium text-sm">{template.name}</p>
                  <p className="text-xs text-muted-foreground">{template.desc}</p>
                </div>
              </Link>
            ))}
          </div>

          <div className="text-center mt-10">
            <Button variant="outline" size="lg" asChild className="backdrop-blur-sm">
              <Link href="/dashboard/templates">
                Browse All Templates
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Infrastructure Section */}
      <section id="infrastructure" className="py-24 md:py-32 border-y border-border/50 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-tl from-[var(--gradient-blue-1)]/[0.02] via-transparent to-[var(--gradient-2)]/[0.02]" />
        <div className="relative main-container">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-5xl font-bold tracking-tight mb-4">
              Enterprise <span className="gradient-text">infrastructure</span>
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Built on Docker and Traefik for reliability, performance, and scale.
              Every deployment is production-grade from day one.
            </p>
          </div>

          {/* Infrastructure Grid */}
          <div className="grid md:grid-cols-2 gap-8 mb-16">
            {/* Container Orchestration */}
            <div className="rounded-2xl border border-border/50 bg-card p-8 md:p-10 relative overflow-hidden group">
              <div className="absolute inset-0 bg-gradient-to-br from-[var(--gradient-1)]/[0.03] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
              <div className="relative">
                <div className="flex items-center gap-3 mb-6">
                  <div className="p-3 rounded-xl bg-gradient-to-br from-[var(--gradient-1)]/10 to-[var(--gradient-2)]/10">
                    <Layers className="h-6 w-6 text-[var(--gradient-1)]" />
                  </div>
                  <div>
                    <h3 className="text-xl font-semibold">Container Orchestration</h3>
                    <p className="text-sm text-muted-foreground">Docker-powered compute</p>
                  </div>
                </div>
                <p className="text-muted-foreground leading-relaxed mb-6">
                  Every application runs in isolated Docker containers with automatic resource
                  management, health checks, and restart policies. Scale horizontally with a single command.
                </p>
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex items-center gap-2 text-sm">
                    <Cpu className="h-4 w-4 text-muted-foreground" />
                    <span>CPU isolation</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <HardDrive className="h-4 w-4 text-muted-foreground" />
                    <span>Persistent volumes</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Activity className="h-4 w-4 text-muted-foreground" />
                    <span>Health monitoring</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Zap className="h-4 w-4 text-muted-foreground" />
                    <span>Auto-restart</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Reverse Proxy */}
            <div className="rounded-2xl border border-border/50 bg-card p-8 md:p-10 relative overflow-hidden group">
              <div className="absolute inset-0 bg-gradient-to-br from-[var(--gradient-blue-1)]/[0.03] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
              <div className="relative">
                <div className="flex items-center gap-3 mb-6">
                  <div className="p-3 rounded-xl bg-gradient-to-br from-[var(--gradient-blue-1)]/10 to-[var(--gradient-blue-2)]/10">
                    <Globe className="h-6 w-6 text-[var(--gradient-blue-1)]" />
                  </div>
                  <div>
                    <h3 className="text-xl font-semibold">Smart Traffic Routing</h3>
                    <p className="text-sm text-muted-foreground">Traefik-powered edge</p>
                  </div>
                </div>
                <p className="text-muted-foreground leading-relaxed mb-6">
                  Automatic TLS certificates, load balancing, and traffic routing for every
                  deployment. Custom domains with Let&apos;s Encrypt SSL in minutes.
                </p>
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex items-center gap-2 text-sm">
                    <Lock className="h-4 w-4 text-muted-foreground" />
                    <span>Auto SSL/TLS</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Globe className="h-4 w-4 text-muted-foreground" />
                    <span>Custom domains</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Server className="h-4 w-4 text-muted-foreground" />
                    <span>Load balancing</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Cloud className="h-4 w-4 text-muted-foreground" />
                    <span>Edge caching</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* CLI Feature Highlight */}
          <div className="rounded-2xl border border-border/50 bg-card overflow-hidden relative">
            <div className="absolute inset-0 bg-gradient-to-r from-[var(--gradient-1)]/[0.02] to-[var(--gradient-3)]/[0.02]" />
            <div className="relative grid md:grid-cols-2">
              <div className="p-8 md:p-10 flex flex-col justify-center">
                <div className="inline-flex items-center gap-2 mb-4">
                  <Terminal className="h-5 w-5 text-[var(--gradient-1)]" />
                  <span className="text-sm font-medium gradient-text">GuildServer CLI</span>
                </div>
                <h3 className="text-2xl font-bold mb-4">Deploy from your terminal</h3>
                <p className="text-muted-foreground leading-relaxed mb-6">
                  The GuildServer CLI gives you full control over your infrastructure.
                  Login, deploy, manage environment variables, stream logs, and more —
                  all from your terminal.
                </p>
                <div className="space-y-3 text-sm">
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-lg gradient-bg-purple flex items-center justify-center text-xs font-mono font-bold text-white">1</div>
                    <code className="text-muted-foreground">npm install -g @guildserver/cli</code>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-lg gradient-bg-purple flex items-center justify-center text-xs font-mono font-bold text-white">2</div>
                    <code className="text-muted-foreground">guildserver login</code>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-lg gradient-bg-purple flex items-center justify-center text-xs font-mono font-bold text-white">3</div>
                    <code className="text-muted-foreground">guildserver deploy</code>
                  </div>
                </div>
              </div>
              <div className="bg-[#0a0a0a] p-8 md:p-10 font-mono text-sm leading-7 border-l border-white/[0.06]">
                <div>
                  <span className="text-emerald-400">$</span>
                  <span className="text-white ml-2">guildserver login</span>
                </div>
                <div className="text-white/40 pl-2">✓ Logged in as Admin User</div>
                <div className="text-white/40 pl-2">✓ Organization: MyTeam</div>
                <div className="mt-4">
                  <span className="text-emerald-400">$</span>
                  <span className="text-white ml-2">guildserver apps list</span>
                </div>
                <div className="text-violet-400 pl-2">┌──────────┬─────────┬───────┐</div>
                <div className="text-violet-400 pl-2">│ Name     │ Status  │ Image │</div>
                <div className="text-violet-400 pl-2">├──────────┼─────────┼───────┤</div>
                <div className="text-violet-400 pl-2">│ my-api   │ running │ node  │</div>
                <div className="text-violet-400 pl-2">│ web-app  │ running │ nginx │</div>
                <div className="text-violet-400 pl-2">└──────────┴─────────┴───────┘</div>
                <div className="mt-4">
                  <span className="text-emerald-400">$</span>
                  <span className="text-white ml-2">guildserver logs my-api -f</span>
                </div>
                <div className="text-white/40 pl-2">📡 Streaming logs...</div>
                <div className="text-sky-400 pl-2">[INFO] Server started on :3000</div>
                <div className="text-sky-400 pl-2">[INFO] Ready for connections</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section className="py-24 md:py-32 relative">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-[var(--gradient-2)] opacity-[0.03] blur-[120px]" />
        <div className="relative main-container">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-5xl font-bold tracking-tight mb-4">
              Deploy in <span className="gradient-text-purple">three steps</span>
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Get from zero to production in under a minute.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8 max-w-4xl mx-auto">
            <div className="text-center group">
              <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl gradient-bg text-white text-2xl font-bold shadow-lg shadow-[var(--gradient-1)]/20 group-hover:shadow-[var(--gradient-1)]/40 transition-shadow">
                1
              </div>
              <h3 className="text-lg font-semibold mb-2">Connect</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Sign up and create your organization. Connect a Git repo or choose a Docker image.
              </p>
            </div>
            <div className="text-center group">
              <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl gradient-bg-purple text-white text-2xl font-bold shadow-lg shadow-[var(--gradient-2)]/20 group-hover:shadow-[var(--gradient-2)]/40 transition-shadow">
                2
              </div>
              <h3 className="text-lg font-semibold mb-2">Configure</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Set environment variables, choose your resources, and configure your deployment settings.
              </p>
            </div>
            <div className="text-center group">
              <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl gradient-bg-blue text-white text-2xl font-bold shadow-lg shadow-[var(--gradient-blue-1)]/20 group-hover:shadow-[var(--gradient-blue-1)]/40 transition-shadow">
                3
              </div>
              <h3 className="text-lg font-semibold mb-2">Deploy</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Click deploy or push to Git. Your app is live with TLS, monitoring, and logging.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Security & Compliance Banner */}
      <section className="border-y border-border/50 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-[var(--gradient-1)]/[0.02] via-[var(--gradient-3)]/[0.02] to-[var(--gradient-5)]/[0.02]" />
        <div className="relative main-container py-16">
          <div className="text-center mb-10">
            <h2 className="text-2xl md:text-3xl font-bold tracking-tight mb-3">
              Enterprise-grade <span className="gradient-text">security</span>
            </h2>
            <p className="text-muted-foreground">
              Built with security-first principles at every layer.
            </p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            <div className="text-center group">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-[var(--gradient-1)]/10 to-[var(--gradient-2)]/10 group-hover:from-[var(--gradient-1)]/20 group-hover:to-[var(--gradient-2)]/20 transition-colors">
                <Lock className="h-5 w-5 text-[var(--gradient-1)]" />
              </div>
              <p className="font-medium text-sm">Encrypted at Rest</p>
              <p className="text-xs text-muted-foreground mt-1">AES-256 encryption</p>
            </div>
            <div className="text-center group">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-[var(--gradient-2)]/10 to-[var(--gradient-3)]/10 group-hover:from-[var(--gradient-2)]/20 group-hover:to-[var(--gradient-3)]/20 transition-colors">
                <Shield className="h-5 w-5 text-[var(--gradient-2)]" />
              </div>
              <p className="font-medium text-sm">RBAC</p>
              <p className="text-xs text-muted-foreground mt-1">Role-based access control</p>
            </div>
            <div className="text-center group">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-[var(--gradient-3)]/10 to-[var(--gradient-4)]/10 group-hover:from-[var(--gradient-3)]/20 group-hover:to-[var(--gradient-4)]/20 transition-colors">
                <Activity className="h-5 w-5 text-[var(--gradient-3)]" />
              </div>
              <p className="font-medium text-sm">Audit Logging</p>
              <p className="text-xs text-muted-foreground mt-1">Complete activity trail</p>
            </div>
            <div className="text-center group">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-[var(--gradient-blue-1)]/10 to-[var(--gradient-blue-2)]/10 group-hover:from-[var(--gradient-blue-1)]/20 group-hover:to-[var(--gradient-blue-2)]/20 transition-colors">
                <Globe className="h-5 w-5 text-[var(--gradient-blue-1)]" />
              </div>
              <p className="font-medium text-sm">SSL/TLS</p>
              <p className="text-xs text-muted-foreground mt-1">Auto-provisioned certs</p>
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA Section */}
      <section className="py-24 md:py-32 relative overflow-hidden">
        <div className="absolute inset-0 hero-mesh" />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/80 to-background" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[400px] rounded-full bg-[var(--gradient-2)] opacity-[0.06] blur-[120px]" />

        <div className="relative main-container text-center">
          <h2 className="text-3xl md:text-5xl font-bold tracking-tight mb-6">
            Deploy your first app
            <br />
            <span className="gradient-text">in seconds</span>
          </h2>
          <p className="text-lg text-muted-foreground mb-10 max-w-xl mx-auto">
            Join teams that trust GuildServer for their mission-critical applications.
            Start building today.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button size="lg" asChild className="h-12 px-8 text-base gradient-bg border-0 text-white hover:opacity-90 transition-opacity shadow-lg shadow-[var(--gradient-1)]/20">
              <Link href="/auth/register">
                Start Deploying
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild className="h-12 px-8 text-base backdrop-blur-sm">
              <Link href="/dashboard/templates">
                Browse Templates
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/50 bg-muted/30">
        <div className="main-container py-16">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-8">
            {/* Brand Column */}
            <div className="col-span-2 md:col-span-1">
              <div className="flex items-center gap-2 mb-4">
                <div className="h-7 w-7 rounded-lg gradient-bg flex items-center justify-center">
                  <span className="text-white font-bold text-xs">G</span>
                </div>
                <span className="font-bold">GuildServer</span>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Enterprise Platform
                <br />
                as a Service
              </p>
            </div>

            {/* Product */}
            <div>
              <h4 className="font-semibold text-sm mb-4">Product</h4>
              <ul className="space-y-3 text-sm text-muted-foreground">
                <li><Link href="#features" className="hover:text-foreground transition-colors">Features</Link></li>
                <li><Link href="/dashboard/templates" className="hover:text-foreground transition-colors">Templates</Link></li>
                <li><Link href="#infrastructure" className="hover:text-foreground transition-colors">Infrastructure</Link></li>
                <li><Link href="#" className="hover:text-foreground transition-colors">Pricing</Link></li>
              </ul>
            </div>

            {/* Resources */}
            <div>
              <h4 className="font-semibold text-sm mb-4">Resources</h4>
              <ul className="space-y-3 text-sm text-muted-foreground">
                <li><Link href="#" className="hover:text-foreground transition-colors">Documentation</Link></li>
                <li><Link href="#" className="hover:text-foreground transition-colors">API Reference</Link></li>
                <li><Link href="#" className="hover:text-foreground transition-colors">CLI Guide</Link></li>
                <li><Link href="#" className="hover:text-foreground transition-colors">Changelog</Link></li>
              </ul>
            </div>

            {/* Company */}
            <div>
              <h4 className="font-semibold text-sm mb-4">Company</h4>
              <ul className="space-y-3 text-sm text-muted-foreground">
                <li><Link href="#" className="hover:text-foreground transition-colors">About</Link></li>
                <li><Link href="#" className="hover:text-foreground transition-colors">Blog</Link></li>
                <li><Link href="#" className="hover:text-foreground transition-colors">Careers</Link></li>
                <li><Link href="#" className="hover:text-foreground transition-colors">Contact</Link></li>
              </ul>
            </div>

            {/* Legal */}
            <div>
              <h4 className="font-semibold text-sm mb-4">Legal</h4>
              <ul className="space-y-3 text-sm text-muted-foreground">
                <li><Link href="#" className="hover:text-foreground transition-colors">Privacy Policy</Link></li>
                <li><Link href="#" className="hover:text-foreground transition-colors">Terms of Service</Link></li>
                <li><Link href="#" className="hover:text-foreground transition-colors">Security</Link></li>
                <li><Link href="#" className="hover:text-foreground transition-colors">SLA</Link></li>
              </ul>
            </div>
          </div>

          <div className="border-t border-border/50 mt-12 pt-8 flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              &copy; 2026 GuildServer. All rights reserved.
            </p>
            <div className="flex items-center gap-6 text-sm text-muted-foreground">
              <Link href="#" className="hover:text-foreground transition-colors">GitHub</Link>
              <Link href="#" className="hover:text-foreground transition-colors">Twitter</Link>
              <Link href="#" className="hover:text-foreground transition-colors">Discord</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
