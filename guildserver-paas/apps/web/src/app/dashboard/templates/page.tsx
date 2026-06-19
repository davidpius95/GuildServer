"use client"

import { useState, useMemo } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Search,
  Rocket,
  Globe,
  Server,
  Database,
  Code2,
  Boxes,
  ArrowRight,
  Star,
  GitBranch,
  Loader2,
  CheckCircle,
  X,
  ChevronDown,
  ChevronRight,
  SlidersHorizontal,
} from "lucide-react"
import { trpc } from "@/components/trpc-provider"
import { useOrganization, useProjects } from "@/hooks/use-auth"
import { EnvVarEditor, type EnvVarEntry } from "@/components/env-var-editor"
import { cn } from "@/lib/utils"

// ─── Template types ──────────────────────────────────────────────────────────

type SourceKind = "docker" | "git"

interface Template {
  id: string
  name: string
  description: string
  icon: string
  category: string
  tags: string[]
  popular?: boolean
  useCase: string[]
  framework?: string
  // Docker templates (sourceKind === "docker")
  sourceKind: SourceKind
  dockerImage?: string
  containerPort?: number
  envVars?: Record<string, string>
  // Git templates (sourceKind === "git")
  repository?: string
  branch?: string
  buildPath?: string
  buildType?: string
}

// ─── Filter definitions ─────────────────────────────────────────────────────

interface FilterSection {
  id: string
  label: string
  options: string[]
}

// ─── Template catalogue ──────────────────────────────────────────────────────

const TEMPLATES: Template[] = [
  // ═══════════════════════════════════════════════════════════════════════════
  //  DOCKER IMAGES — ready-to-run services
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "nginx",
    name: "Nginx",
    description: "High-performance web server and reverse proxy",
    icon: "globe",
    category: "Web Servers",
    sourceKind: "docker",
    dockerImage: "nginx:alpine",
    containerPort: 80,
    tags: ["web server", "proxy", "static"],
    useCase: ["Backend", "Starter"],
    popular: true,
  },
  {
    id: "caddy",
    name: "Caddy",
    description: "Web server with automatic HTTPS",
    icon: "globe",
    category: "Web Servers",
    sourceKind: "docker",
    dockerImage: "caddy:2-alpine",
    containerPort: 80,
    tags: ["web server", "https", "proxy"],
    useCase: ["Backend"],
  },
  {
    id: "postgres",
    name: "PostgreSQL",
    description: "Advanced open-source relational database",
    icon: "database",
    category: "Databases",
    sourceKind: "docker",
    dockerImage: "postgres:16-alpine",
    containerPort: 5432,
    envVars: { POSTGRES_DB: "app", POSTGRES_USER: "admin", POSTGRES_PASSWORD: "changeme" },
    tags: ["database", "sql", "relational"],
    useCase: ["Database"],
    popular: true,
  },
  {
    id: "redis",
    name: "Redis",
    description: "In-memory data store for caching and messaging",
    icon: "database",
    category: "Databases",
    sourceKind: "docker",
    dockerImage: "redis:7-alpine",
    containerPort: 6379,
    tags: ["cache", "queue", "key-value"],
    useCase: ["Database"],
    popular: true,
  },
  {
    id: "mysql",
    name: "MySQL",
    description: "Popular open-source relational database",
    icon: "database",
    category: "Databases",
    sourceKind: "docker",
    dockerImage: "mysql:8",
    containerPort: 3306,
    envVars: { MYSQL_ROOT_PASSWORD: "changeme", MYSQL_DATABASE: "app" },
    tags: ["database", "sql", "relational"],
    useCase: ["Database"],
  },
  {
    id: "mongodb",
    name: "MongoDB",
    description: "Document-oriented NoSQL database",
    icon: "database",
    category: "Databases",
    sourceKind: "docker",
    dockerImage: "mongo:7",
    containerPort: 27017,
    tags: ["database", "nosql", "document"],
    useCase: ["Database"],
  },
  {
    id: "mariadb",
    name: "MariaDB",
    description: "Community-developed fork of MySQL",
    icon: "database",
    category: "Databases",
    sourceKind: "docker",
    dockerImage: "mariadb:11",
    containerPort: 3306,
    envVars: { MARIADB_ROOT_PASSWORD: "changeme", MARIADB_DATABASE: "app" },
    tags: ["database", "sql", "mysql-compatible"],
    useCase: ["Database"],
  },
  {
    id: "grafana",
    name: "Grafana",
    description: "Open-source analytics and monitoring platform",
    icon: "boxes",
    category: "Monitoring",
    sourceKind: "docker",
    dockerImage: "grafana/grafana:latest",
    containerPort: 3000,
    tags: ["monitoring", "dashboards", "analytics"],
    useCase: ["Monitoring"],
  },
  {
    id: "uptime-kuma",
    name: "Uptime Kuma",
    description: "Self-hosted monitoring tool like Uptime Robot",
    icon: "boxes",
    category: "Monitoring",
    sourceKind: "docker",
    dockerImage: "louislam/uptime-kuma:1",
    containerPort: 3001,
    tags: ["monitoring", "uptime", "status page"],
    useCase: ["Monitoring"],
    popular: true,
  },
  {
    id: "minio",
    name: "MinIO",
    description: "S3-compatible object storage server",
    icon: "server",
    category: "Storage",
    sourceKind: "docker",
    dockerImage: "minio/minio:latest",
    containerPort: 9000,
    envVars: { MINIO_ROOT_USER: "admin", MINIO_ROOT_PASSWORD: "changeme123" },
    tags: ["storage", "s3", "object store"],
    useCase: ["Backend"],
  },
  {
    id: "rabbitmq",
    name: "RabbitMQ",
    description: "Open-source message broker with management UI",
    icon: "server",
    category: "Messaging",
    sourceKind: "docker",
    dockerImage: "rabbitmq:3-management-alpine",
    containerPort: 15672,
    envVars: { RABBITMQ_DEFAULT_USER: "admin", RABBITMQ_DEFAULT_PASS: "changeme" },
    tags: ["messaging", "queue", "amqp"],
    useCase: ["Backend"],
  },
  {
    id: "ghost",
    name: "Ghost",
    description: "Professional publishing platform for blogs",
    icon: "globe",
    category: "CMS",
    sourceKind: "docker",
    dockerImage: "ghost:5-alpine",
    containerPort: 2368,
    envVars: { NODE_ENV: "production" },
    tags: ["blog", "cms", "publishing"],
    useCase: ["Blog", "CMS"],
    popular: true,
  },
  {
    id: "wordpress",
    name: "WordPress",
    description: "Most popular content management system",
    icon: "globe",
    category: "CMS",
    sourceKind: "docker",
    dockerImage: "wordpress:6-apache",
    containerPort: 80,
    envVars: { WORDPRESS_DB_HOST: "db:3306", WORDPRESS_DB_USER: "wp", WORDPRESS_DB_PASSWORD: "changeme" },
    tags: ["cms", "blog", "php"],
    useCase: ["Blog", "CMS", "Ecommerce"],
  },
  {
    id: "plausible",
    name: "Plausible Analytics",
    description: "Privacy-friendly Google Analytics alternative",
    icon: "boxes",
    category: "Analytics",
    sourceKind: "docker",
    dockerImage: "plausible/analytics:latest",
    containerPort: 8000,
    envVars: { BASE_URL: "http://localhost", SECRET_KEY_BASE: "changeme-generate-a-secret" },
    tags: ["analytics", "privacy", "web"],
    useCase: ["Monitoring"],
  },
  {
    id: "n8n",
    name: "n8n",
    description: "Workflow automation tool with 200+ integrations",
    icon: "boxes",
    category: "Automation",
    sourceKind: "docker",
    dockerImage: "n8nio/n8n:latest",
    containerPort: 5678,
    tags: ["automation", "workflow", "integrations"],
    useCase: ["Backend", "AI"],
  },
  {
    id: "gitea",
    name: "Gitea",
    description: "Lightweight self-hosted Git service",
    icon: "code",
    category: "Developer Tools",
    sourceKind: "docker",
    dockerImage: "gitea/gitea:latest",
    containerPort: 3000,
    tags: ["git", "version control", "devops"],
    useCase: ["Backend"],
  },
  {
    id: "drone",
    name: "Drone CI",
    description: "Container-native continuous integration",
    icon: "boxes",
    category: "Developer Tools",
    sourceKind: "docker",
    dockerImage: "drone/drone:latest",
    containerPort: 80,
    tags: ["ci", "cd", "devops"],
    useCase: ["Backend"],
  },
  {
    id: "portainer",
    name: "Portainer",
    description: "Docker management UI for containers and clusters",
    icon: "boxes",
    category: "Developer Tools",
    sourceKind: "docker",
    dockerImage: "portainer/portainer-ce:latest",
    containerPort: 9000,
    tags: ["docker", "management", "ui"],
    useCase: ["Monitoring"],
  },
  {
    id: "directus",
    name: "Directus",
    description: "Instant REST + GraphQL API for any SQL database",
    icon: "server",
    category: "CMS",
    sourceKind: "docker",
    dockerImage: "directus/directus:latest",
    containerPort: 8055,
    envVars: { KEY: "changeme", SECRET: "changeme", ADMIN_EMAIL: "admin@example.com", ADMIN_PASSWORD: "changeme" },
    tags: ["headless cms", "api", "database"],
    useCase: ["CMS", "Backend"],
  },
  {
    id: "strapi",
    name: "Strapi",
    description: "Open-source headless CMS for building APIs",
    icon: "server",
    category: "CMS",
    sourceKind: "docker",
    dockerImage: "strapi/strapi:latest",
    containerPort: 1337,
    tags: ["headless cms", "api", "node"],
    useCase: ["CMS", "Backend"],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  GIT TEMPLATES — GuildServer examples
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "nextjs",
    name: "Next.js",
    description: "React framework with SSR, routing, and API routes",
    icon: "code",
    category: "Frameworks",
    sourceKind: "git",
    repository: "https://github.com/davidpius95/guildserver-examples",
    branch: "main",
    buildPath: "nextjs",
    buildType: "nixpacks",
    containerPort: 3000,
    tags: ["react", "ssr", "javascript", "fullstack"],
    useCase: ["Starter", "SaaS"],
    framework: "Next.js",
    popular: true,
  },
  {
    id: "astro",
    name: "Astro",
    description: "Content-driven framework for fast, modern websites",
    icon: "code",
    category: "Frameworks",
    sourceKind: "git",
    repository: "https://github.com/davidpius95/guildserver-examples",
    branch: "main",
    buildPath: "astro",
    buildType: "nixpacks",
    containerPort: 4321,
    tags: ["static", "ssr", "javascript", "content"],
    useCase: ["Blog", "Portfolio", "Starter"],
    framework: "Astro",
    popular: true,
  },
  {
    id: "astro-ssr",
    name: "Astro SSR",
    description: "Astro with server-side rendering enabled",
    icon: "code",
    category: "Frameworks",
    sourceKind: "git",
    repository: "https://github.com/davidpius95/guildserver-examples",
    branch: "main",
    buildPath: "astro-ssr",
    buildType: "nixpacks",
    containerPort: 4321,
    tags: ["astro", "ssr", "javascript", "dynamic"],
    useCase: ["Starter"],
    framework: "Astro",
  },
  {
    id: "svelte",
    name: "Svelte",
    description: "Cybernetically enhanced web framework",
    icon: "code",
    category: "Frameworks",
    sourceKind: "git",
    repository: "https://github.com/davidpius95/guildserver-examples",
    branch: "main",
    buildPath: "svelte",
    buildType: "nixpacks",
    containerPort: 3000,
    tags: ["svelte", "ssr", "javascript", "fullstack"],
    useCase: ["Starter"],
    framework: "Svelte",
  },
  {
    id: "nuxt",
    name: "Nuxt",
    description: "Full-stack Vue.js framework with SSR support",
    icon: "code",
    category: "Frameworks",
    sourceKind: "git",
    repository: "https://github.com/davidpius95/guildserver-examples",
    branch: "main",
    buildPath: "nuxt",
    buildType: "nixpacks",
    containerPort: 3000,
    tags: ["vue", "ssr", "javascript", "fullstack"],
    useCase: ["Starter", "SaaS"],
    framework: "Nuxt",
  },
  {
    id: "remix",
    name: "Remix",
    description: "Full-stack React framework focused on web standards",
    icon: "code",
    category: "Frameworks",
    sourceKind: "git",
    repository: "https://github.com/davidpius95/guildserver-examples",
    branch: "main",
    buildPath: "remix",
    buildType: "nixpacks",
    containerPort: 3000,
    tags: ["react", "ssr", "javascript", "web standards"],
    useCase: ["Starter"],
    framework: "Remix",
  },
  {
    id: "vuejs",
    name: "Vue.js",
    description: "Progressive JavaScript framework for building UIs",
    icon: "code",
    category: "Frameworks",
    sourceKind: "git",
    repository: "https://github.com/davidpius95/guildserver-examples",
    branch: "main",
    buildPath: "vuejs",
    buildType: "nixpacks",
    containerPort: 3000,
    tags: ["vue", "spa", "javascript", "frontend"],
    useCase: ["Starter"],
    framework: "Vue",
  },
  {
    id: "vite",
    name: "Vite",
    description: "Fast frontend build tool with HMR and optimized builds",
    icon: "code",
    category: "Frameworks",
    sourceKind: "git",
    repository: "https://github.com/davidpius95/guildserver-examples",
    branch: "main",
    buildPath: "vite",
    buildType: "nixpacks",
    containerPort: 3000,
    tags: ["react", "vite", "javascript", "frontend"],
    useCase: ["Starter"],
    framework: "Vite",
  },
  {
    id: "django",
    name: "Django",
    description: "High-level Python web framework for rapid development",
    icon: "code",
    category: "Frameworks",
    sourceKind: "git",
    repository: "https://github.com/davidpius95/guildserver-examples",
    branch: "main",
    buildPath: "Django-Example",
    buildType: "nixpacks",
    containerPort: 8000,
    tags: ["python", "django", "api", "fullstack"],
    useCase: ["Backend", "SaaS"],
    framework: "Django",
    popular: true,
  },
  {
    id: "flask",
    name: "Flask",
    description: "Lightweight Python WSGI web application framework",
    icon: "code",
    category: "Frameworks",
    sourceKind: "git",
    repository: "https://github.com/davidpius95/guildserver-examples",
    branch: "main",
    buildPath: "Flask-Example",
    buildType: "nixpacks",
    containerPort: 5000,
    tags: ["python", "flask", "api", "microservice"],
    useCase: ["Backend"],
    framework: "Flask",
  },
  {
    id: "nestjs",
    name: "NestJS",
    description: "Progressive Node.js framework for enterprise APIs",
    icon: "server",
    category: "Frameworks",
    sourceKind: "git",
    repository: "https://github.com/davidpius95/guildserver-examples",
    branch: "main",
    buildPath: "nestjs",
    buildType: "nixpacks",
    containerPort: 3000,
    tags: ["node", "nestjs", "typescript", "api"],
    useCase: ["Backend", "SaaS"],
    framework: "NestJS",
  },
  {
    id: "go-fiber",
    name: "Go Fiber",
    description: "Express-inspired Go web framework built on Fasthttp",
    icon: "code",
    category: "Frameworks",
    sourceKind: "git",
    repository: "https://github.com/davidpius95/guildserver-examples",
    branch: "main",
    buildPath: "go-fiber",
    buildType: "nixpacks",
    containerPort: 3000,
    tags: ["go", "golang", "fiber", "api"],
    useCase: ["Backend"],
    framework: "Go",
  },
  {
    id: "deno-app",
    name: "Deno",
    description: "Secure TypeScript runtime with built-in tooling",
    icon: "server",
    category: "Frameworks",
    sourceKind: "git",
    repository: "https://github.com/davidpius95/guildserver-examples",
    branch: "main",
    buildPath: "deno",
    buildType: "nixpacks",
    containerPort: 8000,
    tags: ["deno", "typescript", "runtime", "secure"],
    useCase: ["Backend"],
    framework: "Deno",
  },
  {
    id: "solidjs",
    name: "SolidJS",
    description: "Simple and performant reactive JavaScript framework",
    icon: "code",
    category: "Frameworks",
    sourceKind: "git",
    repository: "https://github.com/davidpius95/guildserver-examples",
    branch: "main",
    buildPath: "solidjs",
    buildType: "nixpacks",
    containerPort: 3000,
    tags: ["solid", "reactive", "javascript", "frontend"],
    useCase: ["Starter"],
    framework: "SolidJS",
  },
  {
    id: "preact",
    name: "Preact",
    description: "Fast 3kB alternative to React with the same API",
    icon: "code",
    category: "Frameworks",
    sourceKind: "git",
    repository: "https://github.com/davidpius95/guildserver-examples",
    branch: "main",
    buildPath: "preact",
    buildType: "nixpacks",
    containerPort: 3000,
    tags: ["preact", "react", "lightweight", "frontend"],
    useCase: ["Starter"],
    framework: "Preact",
  },
  {
    id: "qwik",
    name: "Qwik",
    description: "Resumable framework for instant-loading web apps",
    icon: "code",
    category: "Frameworks",
    sourceKind: "git",
    repository: "https://github.com/davidpius95/guildserver-examples",
    branch: "main",
    buildPath: "qwik",
    buildType: "nixpacks",
    containerPort: 3000,
    tags: ["qwik", "resumable", "javascript", "performance"],
    useCase: ["Starter"],
    framework: "Qwik",
  },
  {
    id: "t3-stack",
    name: "T3 Stack",
    description: "Next.js + tRPC + Prisma + Tailwind full-stack starter",
    icon: "code",
    category: "Frameworks",
    sourceKind: "git",
    repository: "https://github.com/davidpius95/guildserver-examples",
    branch: "main",
    buildPath: "t3",
    buildType: "nixpacks",
    containerPort: 3000,
    tags: ["next", "trpc", "prisma", "fullstack"],
    useCase: ["SaaS", "Starter"],
    framework: "Next.js",
  },
  {
    id: "11ty",
    name: "Eleventy (11ty)",
    description: "Simple and flexible static site generator",
    icon: "globe",
    category: "Frameworks",
    sourceKind: "git",
    repository: "https://github.com/davidpius95/guildserver-examples",
    branch: "main",
    buildPath: "11ty",
    buildType: "nixpacks",
    containerPort: 3000,
    tags: ["static", "ssg", "javascript", "content"],
    useCase: ["Blog", "Portfolio"],
    framework: "Eleventy",
  },
  {
    id: "lit",
    name: "Lit",
    description: "Simple library for building fast web components",
    icon: "code",
    category: "Frameworks",
    sourceKind: "git",
    repository: "https://github.com/davidpius95/guildserver-examples",
    branch: "main",
    buildPath: "lit",
    buildType: "nixpacks",
    containerPort: 3000,
    tags: ["web components", "lit", "javascript", "lightweight"],
    useCase: ["Starter"],
    framework: "Lit",
  },
  {
    id: "static-html",
    name: "Static HTML",
    description: "Simple static HTML website",
    icon: "globe",
    category: "Web Servers",
    sourceKind: "git",
    repository: "https://github.com/davidpius95/guildserver-examples",
    branch: "main",
    buildPath: "html",
    buildType: "nixpacks",
    containerPort: 80,
    tags: ["html", "static", "simple", "beginner"],
    useCase: ["Starter", "Portfolio"],
  },
  {
    id: "official-ai-chatgpt",
    name: "AI ChatGPT App",
    description: "An open-source AI chatbot app template built with Next.js",
    icon: "code",
    category: "Frameworks",
    sourceKind: "git",
    repository: "https://github.com/davidpius95/guildserver-examples",
    branch: "main",
    buildPath: "official/solutions/ai-chatgpt",
    buildType: "nixpacks",
    containerPort: 3000,
    tags: ["nextjs", "ai", "chatgpt", "openai"],
    useCase: ["AI", "Starter"],
    framework: "Next.js",
    popular: true,
  },
  {
    id: "official-blog-starter",
    name: "Blog Starter Kit",
    description: "A statically generated blog example using Next.js and Markdown",
    icon: "globe",
    category: "Frameworks",
    sourceKind: "git",
    repository: "https://github.com/davidpius95/guildserver-examples",
    branch: "main",
    buildPath: "official/solutions/blog",
    buildType: "nixpacks",
    containerPort: 3000,
    tags: ["nextjs", "blog", "markdown"],
    useCase: ["Blog", "Starter"],
    framework: "Next.js",
  },
  {
    id: "official-hono-ai-sdk",
    name: "Hono AI SDK Starter",
    description: "A starter for Hono with the AI SDK",
    icon: "code",
    category: "Frameworks",
    sourceKind: "git",
    repository: "https://github.com/davidpius95/guildserver-examples",
    branch: "main",
    buildPath: "official/starter/hono-ai-sdk",
    buildType: "nixpacks",
    containerPort: 3000,
    tags: ["hono", "ai", "sdk"],
    useCase: ["AI", "Starter", "Backend"],
    framework: "Hono",
  },
  {
    id: "official-express-ai",
    name: "Express AI Chatbot",
    description: "A lightweight Express API integrating with AI SDK",
    icon: "code",
    category: "Frameworks",
    sourceKind: "git",
    repository: "https://github.com/davidpius95/guildserver-examples",
    branch: "main",
    buildPath: "official/starter/express-ai-sdk",
    buildType: "nixpacks",
    containerPort: 3000,
    tags: ["express", "node", "ai"],
    useCase: ["AI", "Backend"],
    framework: "Express",
  },
  {
    id: "official-platforms-supabase",
    name: "Platforms Starter (Supabase)",
    description: "Multi-tenant platform builder using Next.js and Supabase",
    icon: "boxes",
    category: "Frameworks",
    sourceKind: "git",
    repository: "https://github.com/davidpius95/guildserver-examples",
    branch: "main",
    buildPath: "official/solutions/platforms-slate-supabase",
    buildType: "nixpacks",
    containerPort: 3000,
    tags: ["nextjs", "supabase", "multi-tenant"],
    useCase: ["SaaS", "Starter", "Database"],
    framework: "Next.js",
    popular: true,
  },
  {
    id: "official-web3-auth",
    name: "Web3 Authentication",
    description: "Web3 wallet sign-in and session management",
    icon: "shield",
    category: "Frameworks",
    sourceKind: "git",
    repository: "https://github.com/davidpius95/guildserver-examples",
    branch: "main",
    buildPath: "official/solutions/web3-authentication",
    buildType: "nixpacks",
    containerPort: 3000,
    tags: ["nextjs", "web3", "crypto", "auth"],
    useCase: ["Security", "Starter"],
    framework: "Next.js",
  },
  {
    id: "official-cron",
    name: "Cron Jobs Scheduler",
    description: "Example showing how to run cron jobs in Next.js APIs",
    icon: "code",
    category: "Frameworks",
    sourceKind: "git",
    repository: "https://github.com/davidpius95/guildserver-examples",
    branch: "main",
    buildPath: "official/solutions/cron",
    buildType: "nixpacks",
    containerPort: 3000,
    tags: ["nextjs", "cron", "jobs", "automation"],
    useCase: ["Backend", "Automation"],
    framework: "Next.js",
  },
  {
    id: "official-monorepo",
    name: "Turborepo Next.js Monorepo",
    description: "Advanced Turborepo workspace with shared UI and apps",
    icon: "boxes",
    category: "Frameworks",
    sourceKind: "git",
    repository: "https://github.com/davidpius95/guildserver-examples",
    branch: "main",
    buildPath: "official/solutions/monorepo",
    buildType: "nixpacks",
    containerPort: 3000,
    tags: ["turborepo", "nextjs", "monorepo", "workspace"],
    useCase: ["Starter", "SaaS"],
    framework: "Next.js",
  }
]

// ─── Derive filter sections from the templates ───────────────────────────────

const FILTER_SECTIONS: FilterSection[] = [
  {
    id: "useCase",
    label: "Use Case",
    options: [...new Set(TEMPLATES.flatMap((t) => t.useCase))].sort(),
  },
  {
    id: "framework",
    label: "Framework",
    options: [...new Set(TEMPLATES.map((t) => t.framework).filter(Boolean) as string[])].sort(),
  },
  {
    id: "category",
    label: "Category",
    options: [...new Set(TEMPLATES.map((t) => t.category))].sort(),
  },
]

// ─── Gradient map for cards ──────────────────────────────────────────────────

const GRADIENT_MAP: Record<string, string> = {
  "Next.js": "from-slate-900 via-slate-800 to-slate-900",
  "Astro": "from-purple-950 via-indigo-950 to-slate-900",
  "Svelte": "from-orange-950 via-red-950 to-slate-900",
  "Nuxt": "from-emerald-950 via-green-950 to-slate-900",
  "Vue": "from-emerald-950 via-teal-950 to-slate-900",
  "Remix": "from-indigo-950 via-violet-950 to-slate-900",
  "Django": "from-green-950 via-emerald-950 to-slate-900",
  "Flask": "from-gray-900 via-slate-800 to-gray-900",
  "NestJS": "from-red-950 via-rose-950 to-slate-900",
  "Go": "from-cyan-950 via-sky-950 to-slate-900",
  "Deno": "from-slate-900 via-gray-800 to-slate-900",
  "SolidJS": "from-blue-950 via-indigo-950 to-slate-900",
  "Vite": "from-violet-950 via-purple-950 to-slate-900",
  "Preact": "from-purple-950 via-violet-950 to-slate-900",
  "Qwik": "from-blue-950 via-cyan-950 to-slate-900",
  "Eleventy": "from-gray-900 via-slate-800 to-gray-900",
  "Lit": "from-blue-950 via-sky-950 to-slate-900",
  "default": "from-slate-900 via-gray-800 to-slate-900",
}

const getIconComponent = (icon: string) => {
  switch (icon) {
    case "globe": return Globe
    case "server": return Server
    case "database": return Database
    case "code": return Code2
    case "boxes": return Boxes
    default: return Server
  }
}

// ─── Sidebar filter section component ────────────────────────────────────────

function FilterGroup({
  section,
  selected,
  onToggle,
}: {
  section: FilterSection
  selected: Set<string>
  onToggle: (value: string) => void
}) {
  const [isOpen, setIsOpen] = useState(true)
  const activeCount = section.options.filter((o) => selected.has(o)).length

  return (
    <div className="border-b border-border/40 pb-3 mb-3 last:border-0 last:pb-0 last:mb-0">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-between w-full text-sm font-semibold text-foreground hover:text-foreground/80 transition-colors py-1"
      >
        <span className="flex items-center gap-2">
          {isOpen ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          {section.label}
        </span>
        {activeCount > 0 && (
          <Badge variant="secondary" className="h-5 min-w-[20px] px-1.5 text-[10px] font-bold">
            {activeCount}
          </Badge>
        )}
      </button>
      {isOpen && (
        <div className="mt-2 space-y-1 ml-1">
          {section.options.map((option) => (
            <label
              key={option}
              className={cn(
                "flex items-center gap-2.5 py-1.5 px-2 rounded-md cursor-pointer text-sm transition-colors",
                selected.has(option)
                  ? "text-foreground bg-accent/50"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent/30"
              )}
            >
              <Checkbox
                checked={selected.has(option)}
                onCheckedChange={() => onToggle(option)}
                className="h-4 w-4 rounded border-border/60"
              />
              {option}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Template card component ─────────────────────────────────────────────────

function TemplateCard({
  template,
  isDeploying,
  projectId,
  onDeploy,
}: {
  template: Template
  isDeploying: boolean
  projectId: string | null
  onDeploy: (t: Template) => void
}) {
  const Icon = getIconComponent(template.icon)
  const gradient = template.framework
    ? GRADIENT_MAP[template.framework] || GRADIENT_MAP.default
    : GRADIENT_MAP.default

  return (
    <Card
      role="button"
      tabIndex={0}
      aria-label={`Deploy ${template.name}`}
      onClick={() => onDeploy(template)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onDeploy(template)
        }
      }}
      className="group cursor-pointer overflow-hidden border-border/40 hover:border-primary/40 hover:-translate-y-0.5 transition-all duration-300 hover:shadow-lg hover:shadow-black/10 bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      {/* Top text section */}
      <CardHeader className="p-4 pb-3">
        <CardTitle className="text-[15px] font-semibold leading-tight line-clamp-1 group-hover:text-primary transition-colors">
          {template.name}
        </CardTitle>
        <CardDescription className="text-xs text-muted-foreground line-clamp-2 mt-1 leading-relaxed">
          {template.description}
        </CardDescription>
      </CardHeader>

      {/* Visual preview area */}
      <div
        className={cn(
          "relative h-[140px] mx-3 mb-3 rounded-lg overflow-hidden bg-gradient-to-br",
          gradient
        )}
      >
        {/* Grid pattern overlay */}
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
        />

        {/* Centered icon */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="p-5 rounded-2xl bg-white/[0.07] backdrop-blur-sm border border-white/[0.08] shadow-2xl group-hover:scale-110 transition-transform duration-500">
            <Icon className="h-8 w-8 text-white/70" />
          </div>
        </div>

        {/* Source badge */}
        <div className="absolute top-2 right-2">
          <Badge
            variant="secondary"
            className="text-[10px] px-1.5 py-0.5 bg-black/30 text-white/70 border-white/10 backdrop-blur-sm"
          >
            {template.sourceKind === "git" ? (
              <span className="flex items-center gap-1">
                <GitBranch className="h-2.5 w-2.5" />
                Git
              </span>
            ) : (
              "Docker"
            )}
          </Badge>
        </div>

        {/* Popular star */}
        {template.popular && (
          <div className="absolute top-2 left-2">
            <Star className="h-3.5 w-3.5 text-yellow-400 fill-yellow-400 drop-shadow" />
          </div>
        )}

        {/* Deploy hover overlay */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all duration-300 flex items-center justify-center opacity-0 group-hover:opacity-100">
          <Button
            size="sm"
            disabled={isDeploying || !projectId}
            onClick={(e) => {
              e.stopPropagation()
              onDeploy(template)
            }}
            className="bg-white text-black hover:bg-white/90 shadow-xl"
          >
            {isDeploying ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
            ) : (
              <Rocket className="h-3.5 w-3.5 mr-1.5" />
            )}
            Deploy
          </Button>
        </div>
      </div>
    </Card>
  )
}

// ─── Page component ──────────────────────────────────────────────────────────

export default function TemplatesPage() {
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedFilters, setSelectedFilters] = useState<Record<string, Set<string>>>({
    useCase: new Set(),
    framework: new Set(),
    category: new Set(),
  })
  const [deployingTemplate, setDeployingTemplate] = useState<string | null>(null)
  const [deployedApp, setDeployedApp] = useState<string | null>(null)
  const [preDeployTemplate, setPreDeployTemplate] = useState<Template | null>(null)
  const [preDeployEnvVars, setPreDeployEnvVars] = useState<EnvVarEntry[]>([])
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)

  const { orgId } = useOrganization()
  const { projectId } = useProjects(orgId)

  const createAppMutation = trpc.application.create.useMutation()
  const deployAppMutation = trpc.application.deploy.useMutation()

  const hasActiveFilters = Object.values(selectedFilters).some((s) => s.size > 0)
  const activeFilterCount = Object.values(selectedFilters).reduce((sum, s) => sum + s.size, 0)

  const toggleFilter = (sectionId: string, value: string) => {
    setSelectedFilters((prev) => {
      const next = { ...prev }
      const set = new Set(prev[sectionId])
      if (set.has(value)) {
        set.delete(value)
      } else {
        set.add(value)
      }
      next[sectionId] = set
      return next
    })
  }

  const clearAllFilters = () => {
    setSelectedFilters({
      useCase: new Set(),
      framework: new Set(),
      category: new Set(),
    })
  }

  const filteredTemplates = useMemo(() => {
    return TEMPLATES.filter((t) => {
      // Search
      const q = searchQuery.toLowerCase()
      const matchesSearch =
        !searchQuery ||
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.tags.some((tag) => tag.includes(q))

      // Use Case filter
      const useCaseFilter = selectedFilters.useCase
      const matchesUseCase = useCaseFilter.size === 0 || t.useCase.some((uc) => useCaseFilter.has(uc))

      // Framework filter
      const frameworkFilter = selectedFilters.framework
      const matchesFramework = frameworkFilter.size === 0 || (t.framework && frameworkFilter.has(t.framework))

      // Category filter
      const categoryFilter = selectedFilters.category
      const matchesCategory = categoryFilter.size === 0 || categoryFilter.has(t.category)

      return matchesSearch && matchesUseCase && matchesFramework && matchesCategory
    })
  }, [searchQuery, selectedFilters])

  const openPreDeployDialog = (template: Template) => {
    const entries: EnvVarEntry[] = template.envVars
      ? Object.entries(template.envVars).map(([key, value]) => ({ key, value }))
      : []
    entries.push({ key: "", value: "" })
    setPreDeployEnvVars(entries)
    setPreDeployTemplate(template)
  }

  const handleDeploy = async (template: Template, envVarsOverride: Record<string, string>) => {
    if (!projectId) return

    setDeployingTemplate(template.id)
    setDeployedApp(null)
    setPreDeployTemplate(null)

    try {
      if (template.sourceKind === "git") {
        const app = await createAppMutation.mutateAsync({
          name: template.id + "-" + Date.now().toString(36),
          projectId,
          sourceType: "git",
          repository: template.repository!,
          branch: template.branch || "main",
          buildPath: template.buildPath,
          buildType: (template.buildType as any) || "nixpacks",
          containerPort: template.containerPort,
          environment: envVarsOverride,
        })
        await deployAppMutation.mutateAsync({ id: app.id })
        setDeployedApp(app.id)
      } else {
        const app = await createAppMutation.mutateAsync({
          name: template.id + "-" + Date.now().toString(36),
          projectId,
          sourceType: "docker",
          buildType: "dockerfile",
          dockerImage: template.dockerImage!,
          containerPort: template.containerPort,
          environment: envVarsOverride,
        })
        await deployAppMutation.mutateAsync({ id: app.id })
        setDeployedApp(app.id)
      }
    } catch (error: any) {
      console.error("Deploy failed:", error)
    } finally {
      setDeployingTemplate(null)
    }
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Find your Template</h1>
        <p className="text-muted-foreground mt-1">
          Jumpstart your app development process with pre-built solutions from GuildServer and our community.
        </p>
      </div>

      {/* Full-width search bar */}
      <div className="relative">
        <Search className="absolute left-4 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search templates..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-11 h-12 text-base bg-background border-border/60 focus:border-primary/40 rounded-xl"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery("")}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Mobile filter toggle */}
      <div className="lg:hidden">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setMobileSidebarOpen(!mobileSidebarOpen)}
          className="gap-2"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Filter Templates
          {activeFilterCount > 0 && (
            <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
              {activeFilterCount}
            </Badge>
          )}
        </Button>
      </div>

      {/* Main layout: Sidebar + Grid */}
      <div className="flex gap-8">
        {/* ── Sidebar ─────────────────────────────── */}
        <aside
          className={cn(
            "w-[220px] flex-shrink-0 space-y-1",
            "hidden lg:block",
            mobileSidebarOpen && "!block"
          )}
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-foreground">Filter Templates</h2>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearAllFilters}
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
              >
                <X className="h-3 w-3" />
                Clear
              </button>
            )}
          </div>

          {FILTER_SECTIONS.map((section) => (
            <FilterGroup
              key={section.id}
              section={section}
              selected={selectedFilters[section.id] || new Set()}
              onToggle={(value) => toggleFilter(section.id, value)}
            />
          ))}
        </aside>

        {/* ── Template grid ───────────────────────── */}
        <div className="flex-1 min-w-0">
          {(hasActiveFilters || searchQuery) && (
            <div className="flex items-center gap-3 mb-4">
              <p className="text-sm text-muted-foreground">
                {filteredTemplates.length} template{filteredTemplates.length !== 1 ? "s" : ""} found
              </p>
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={clearAllFilters}
                  className="text-xs text-primary hover:text-primary/80 transition-colors"
                >
                  Clear filters
                </button>
              )}
            </div>
          )}

          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
            {filteredTemplates.map((template) => (
              <TemplateCard
                key={template.id}
                template={template}
                isDeploying={deployingTemplate === template.id}
                projectId={projectId}
                onDeploy={openPreDeployDialog}
              />
            ))}
          </div>

          {filteredTemplates.length === 0 && (
            <div className="text-center py-20">
              <Search className="mx-auto h-12 w-12 text-muted-foreground mb-4 opacity-20" />
              <h3 className="text-lg font-semibold mb-1">No templates found</h3>
              <p className="text-sm text-muted-foreground">
                Try adjusting your search or filters
              </p>
              {hasActiveFilters && (
                <Button variant="outline" size="sm" className="mt-4" onClick={clearAllFilters}>
                  Clear all filters
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Pre-Deploy Configuration Dialog */}
      {preDeployTemplate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <Card className="w-full max-w-lg mx-4 max-h-[80vh] overflow-y-auto border-border/50 shadow-2xl">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-primary/10 rounded-lg">
                    {(() => {
                      const Icon = getIconComponent(preDeployTemplate.icon)
                      return <Icon className="h-5 w-5 text-primary" />
                    })()}
                  </div>
                  <div>
                    <CardTitle className="text-lg">Deploy {preDeployTemplate.name}</CardTitle>
                    <CardDescription className="text-xs mt-0.5">
                      {preDeployTemplate.description}
                    </CardDescription>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0"
                  onClick={() => setPreDeployTemplate(null)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Template details */}
              <div className="flex gap-2 text-sm">
                <Badge variant="secondary">
                  {preDeployTemplate.sourceKind === "git" ? (
                    <span className="flex items-center gap-1">
                      <GitBranch className="h-3 w-3" />
                      {preDeployTemplate.buildType || "Nixpacks"}
                    </span>
                  ) : (
                    preDeployTemplate.dockerImage
                  )}
                </Badge>
                {preDeployTemplate.containerPort && (
                  <Badge variant="outline">Port {preDeployTemplate.containerPort}</Badge>
                )}
              </div>

              {/* Environment Variables Editor */}
              <EnvVarEditor
                value={preDeployEnvVars}
                onChange={setPreDeployEnvVars}
                label="Environment Variables"
              />

              {/* Actions */}
              <div className="flex gap-3 pt-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setPreDeployTemplate(null)}
                >
                  Cancel
                </Button>
                <Button
                  className="flex-1"
                  disabled={deployingTemplate === preDeployTemplate.id || !projectId}
                  onClick={() => {
                    const envRecord: Record<string, string> = {}
                    for (const entry of preDeployEnvVars) {
                      if (entry.key.trim()) {
                        envRecord[entry.key.trim()] = entry.value
                      }
                    }
                    handleDeploy(preDeployTemplate, envRecord)
                  }}
                >
                  {deployingTemplate === preDeployTemplate.id ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Rocket className="h-4 w-4 mr-2" />
                  )}
                  Deploy
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Deployed success message */}
      {deployedApp && (
        <div className="fixed bottom-6 right-6 bg-green-50 dark:bg-green-950/50 border border-green-200 dark:border-green-800 rounded-lg p-4 shadow-lg flex items-center gap-3 animate-in slide-in-from-bottom-5">
          <CheckCircle className="h-5 w-5 text-green-600" />
          <div>
            <p className="font-medium text-green-900 dark:text-green-100">Deployment started!</p>
            <p className="text-sm text-green-700 dark:text-green-300">
              Your application is being deployed.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="ml-4"
            onClick={() => {
              window.location.href = `/dashboard/applications/${deployedApp}`
            }}
          >
            View <ArrowRight className="h-3 w-3 ml-1" />
          </Button>
        </div>
      )}
    </div>
  )
}
