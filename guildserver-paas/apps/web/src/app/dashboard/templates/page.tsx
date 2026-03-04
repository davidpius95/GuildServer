"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
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
  ExternalLink,
  Loader2,
  CheckCircle,
  X,
} from "lucide-react"
import { trpc } from "@/components/trpc-provider"
import { useOrganization, useProjects } from "@/hooks/use-auth"
import { EnvVarEditor, type EnvVarEntry } from "@/components/env-var-editor"

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
  // Docker templates (sourceKind === "docker")
  sourceKind: SourceKind
  dockerImage?: string
  containerPort?: number
  envVars?: Record<string, string>
  // Git templates (sourceKind === "git")
  repository?: string
  branch?: string
  buildPath?: string   // subdirectory inside repo
  buildType?: string   // "nixpacks" | "dockerfile" | "static"
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
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  GIT TEMPLATES — GuildServer examples (verified directory names)
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
  },
]

// ─── Derived data ────────────────────────────────────────────────────────────

const CATEGORIES = [...new Set(TEMPLATES.map((t) => t.category))]

const getIconComponent = (icon: string) => {
  switch (icon) {
    case "globe":
      return Globe
    case "server":
      return Server
    case "database":
      return Database
    case "code":
      return Code2
    case "boxes":
      return Boxes
    default:
      return Server
  }
}

// ─── Page component ──────────────────────────────────────────────────────────

export default function TemplatesPage() {
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [deployingTemplate, setDeployingTemplate] = useState<string | null>(null)
  const [deployedApp, setDeployedApp] = useState<string | null>(null)
  const [preDeployTemplate, setPreDeployTemplate] = useState<Template | null>(null)
  const [preDeployEnvVars, setPreDeployEnvVars] = useState<EnvVarEntry[]>([])

  const { orgId } = useOrganization()
  const { projectId } = useProjects(orgId)

  const createAppMutation = trpc.application.create.useMutation()
  const deployAppMutation = trpc.application.deploy.useMutation()

  const filteredTemplates = TEMPLATES.filter((t) => {
    const q = searchQuery.toLowerCase()
    const matchesSearch =
      !searchQuery ||
      t.name.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q) ||
      t.tags.some((tag) => tag.includes(q))
    const matchesCategory = !selectedCategory || t.category === selectedCategory
    return matchesSearch && matchesCategory
  })

  const popularTemplates = TEMPLATES.filter((t) => t.popular)

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
        // Git-based template — clone + build with Nixpacks
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
        // Docker image template
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
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold">Templates</h1>
        <p className="text-muted-foreground">
          Deploy pre-configured applications and frameworks with one click
        </p>
      </div>

      {/* Search and Filter */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search templates..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button
            variant={!selectedCategory ? "default" : "outline"}
            size="sm"
            onClick={() => setSelectedCategory(null)}
          >
            All
          </Button>
          {CATEGORIES.map((cat) => (
            <Button
              key={cat}
              variant={selectedCategory === cat ? "default" : "outline"}
              size="sm"
              onClick={() => setSelectedCategory(cat === selectedCategory ? null : cat)}
            >
              {cat}
            </Button>
          ))}
        </div>
      </div>

      {/* Popular Templates */}
      {!searchQuery && !selectedCategory && (
        <div>
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <Star className="h-5 w-5 text-yellow-500" />
            Popular Templates
          </h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {popularTemplates.map((template) => {
              const Icon = getIconComponent(template.icon)
              const isDeploying = deployingTemplate === template.id

              return (
                <Card
                  key={template.id}
                  className="hover:shadow-md transition-shadow cursor-pointer group"
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-primary/10 rounded-lg">
                        <Icon className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <CardTitle className="text-base">{template.name}</CardTitle>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground mb-3">
                      {template.description}
                    </p>
                    <div className="flex items-center justify-between">
                      <Badge variant="secondary" className="text-xs">
                        {template.sourceKind === "git" ? (
                          <span className="flex items-center gap-1">
                            <GitBranch className="h-3 w-3" />
                            Nixpacks
                          </span>
                        ) : (
                          template.dockerImage
                        )}
                      </Badge>
                      <Button
                        size="sm"
                        disabled={isDeploying || !projectId}
                        onClick={() => openPreDeployDialog(template)}
                      >
                        {isDeploying ? (
                          <Loader2 className="h-3 w-3 animate-spin mr-1" />
                        ) : (
                          <Rocket className="h-3 w-3 mr-1" />
                        )}
                        Deploy
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </div>
      )}

      {/* All Templates */}
      <div>
        {(searchQuery || selectedCategory) && (
          <h2 className="text-lg font-semibold mb-3">
            {filteredTemplates.length} template{filteredTemplates.length !== 1 ? "s" : ""} found
          </h2>
        )}
        {!searchQuery && !selectedCategory && (
          <h2 className="text-lg font-semibold mb-3">
            All Templates ({TEMPLATES.length})
          </h2>
        )}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredTemplates.map((template) => {
            const Icon = getIconComponent(template.icon)
            const isDeploying = deployingTemplate === template.id

            return (
              <Card
                key={template.id}
                className="hover:shadow-md transition-shadow"
              >
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-primary/10 rounded-lg">
                        <Icon className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <CardTitle className="text-base">{template.name}</CardTitle>
                        <CardDescription className="text-xs">
                          {template.category}
                        </CardDescription>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {template.sourceKind === "git" && (
                        <Badge variant="outline" className="text-xs border-blue-200 text-blue-700 bg-blue-50">
                          <GitBranch className="h-3 w-3 mr-1" />
                          Git
                        </Badge>
                      )}
                      {template.popular && (
                        <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground mb-3">
                    {template.description}
                  </p>
                  <div className="flex flex-wrap gap-1 mb-3">
                    {template.tags.map((tag) => (
                      <Badge key={tag} variant="outline" className="text-xs">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t">
                    <code className="text-xs text-muted-foreground truncate mr-2">
                      {template.sourceKind === "git"
                        ? `nixpacks/${template.buildPath}`
                        : template.dockerImage}
                    </code>
                    <Button
                      size="sm"
                      disabled={isDeploying || !projectId}
                      onClick={() => openPreDeployDialog(template)}
                    >
                      {isDeploying ? (
                        <Loader2 className="h-3 w-3 animate-spin mr-1" />
                      ) : (
                        <Rocket className="h-3 w-3 mr-1" />
                      )}
                      Deploy
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>

        {filteredTemplates.length === 0 && (
          <Card className="text-center py-12">
            <CardContent>
              <Search className="mx-auto h-12 w-12 text-muted-foreground mb-4 opacity-30" />
              <h3 className="text-lg font-semibold mb-2">No templates found</h3>
              <p className="text-muted-foreground">
                Try adjusting your search or filter
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Pre-Deploy Configuration Dialog */}
      {preDeployTemplate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <Card className="w-full max-w-lg mx-4 max-h-[80vh] overflow-y-auto">
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
        <div className="fixed bottom-6 right-6 bg-green-50 border border-green-200 rounded-lg p-4 shadow-lg flex items-center gap-3 animate-in slide-in-from-bottom-5">
          <CheckCircle className="h-5 w-5 text-green-600" />
          <div>
            <p className="font-medium text-green-900">Deployment started!</p>
            <p className="text-sm text-green-700">
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
