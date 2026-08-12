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
  Github,
  Shield,
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
import {
  FILTER_SECTIONS,
  GRADIENT_MAP,
  TEMPLATES,
  SOURCE_LABELS,
  getFilterLabel,
  getLogoSpec,
  getTrackLabel,
  type FilterSection,
  type Template,
} from "./templates-data"

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
              {getFilterLabel(section.id, option)}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

function TemplateLogo({
  template,
  className,
  tone = "brand",
}: {
  template: Template
  className?: string
  tone?: "brand" | "white"
}) {
  const [failed, setFailed] = useState(false)
  const spec = getLogoSpec(template)
  const fallback = getIconComponent(spec.fallbackIcon || template.icon)
  const Fallback = fallback

  if (failed) {
    return (
      <div
        className={cn(
          tone === "white"
            ? "flex items-center justify-center rounded-2xl bg-white/10 border border-white/10"
            : "flex items-center justify-center rounded-2xl bg-background/70 border border-border/60",
          className
        )}
      >
        <Fallback className={cn("h-1/2 w-1/2", tone === "white" ? "text-white/70" : "text-foreground/70")} />
      </div>
    )
  }

  return (
    <div
      className={cn(
        tone === "white"
          ? "flex items-center justify-center overflow-hidden rounded-2xl bg-white/10 border border-white/10"
          : "flex items-center justify-center overflow-hidden rounded-2xl bg-background/70 border border-border/60",
        className
      )}
      aria-label={spec.label}
      title={spec.label}
    >
      <img
        src={
          tone === "white"
            ? `https://cdn.simpleicons.org/${spec.slug}/ffffff?viewbox=auto&size=96`
            : `https://cdn.simpleicons.org/${spec.slug}?viewbox=auto&size=96`
        }
        alt={spec.label}
        className="h-full w-full object-contain p-2.5"
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
      />
    </div>
  )
}

const getIconComponent = (icon: string) => {
  switch (icon) {
    case "globe": return Globe
    case "server": return Server
    case "database": return Database
    case "code": return Code2
    case "boxes": return Boxes
    case "shield": return Shield
    default: return Server
  }
}

const TRACK_ACCENT_MAP: Record<string, string> = {
  ai: "from-emerald-400 via-cyan-400 to-sky-400",
  "open-source": "from-slate-400 via-emerald-400 to-teal-400",
  starter: "from-amber-300 via-orange-400 to-rose-400",
  production: "from-rose-400 via-fuchsia-400 to-purple-400",
  ops: "from-blue-400 via-sky-400 to-cyan-400",
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
  const gradient = template.framework
    ? GRADIENT_MAP[template.framework] || GRADIENT_MAP.default
    : GRADIENT_MAP.default
  const sourceLabel = SOURCE_LABELS[template.sourceKind]

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
      className="group cursor-pointer overflow-hidden border-border/40 hover:border-primary/40 hover:-translate-y-0.5 transition-all duration-300 hover:shadow-xl hover:shadow-black/10 bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <div className={cn("h-1 bg-gradient-to-r", TRACK_ACCENT_MAP[template.track || "starter"] || TRACK_ACCENT_MAP.starter)} />

      {/* Top text section */}
      <CardHeader className="p-4 pb-3 pt-3">
        <div className="flex items-start gap-3">
          <TemplateLogo template={template} className="h-12 w-12 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <CardTitle className="text-[15px] font-semibold leading-tight line-clamp-1 group-hover:text-primary transition-colors">
                {template.name}
              </CardTitle>
              {template.popular && (
                <Badge variant="secondary" className="h-5 px-1.5 text-[10px] font-semibold uppercase tracking-wide">
                  Popular
                </Badge>
              )}
            </div>
            <CardDescription className="text-xs text-muted-foreground line-clamp-2 mt-1 leading-relaxed">
              {template.description}
            </CardDescription>
          </div>
        </div>
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

        {/* Centered logo */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-20 h-20 rounded-[1.25rem] bg-white/[0.08] backdrop-blur-sm border border-white/[0.08] shadow-2xl p-3 group-hover:scale-110 transition-transform duration-500">
            <TemplateLogo template={template} tone="white" className="h-full w-full rounded-[1rem] bg-transparent border-0" />
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
                <Github className="h-2.5 w-2.5" />
                {sourceLabel}
              </span>
            ) : (
              sourceLabel
            )}
          </Badge>
        </div>

        {template.track && (
          <div className="absolute bottom-2 left-2">
            <Badge
              variant="secondary"
              className="text-[10px] px-1.5 py-0.5 bg-black/30 text-white/70 border-white/10 backdrop-blur-sm"
            >
              {getTrackLabel(template.track)}
            </Badge>
          </div>
        )}

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

      <CardContent className="px-4 pb-4 pt-0">
        <div className="flex flex-wrap gap-2">
          {template.framework && (
            <Badge variant="outline" className="text-[11px] font-medium">
              {template.framework}
            </Badge>
          )}
          {template.useCase.slice(0, 2).map((useCase) => (
            <Badge key={useCase} variant="secondary" className="text-[11px] font-medium">
              {getFilterLabel("useCase", useCase)}
            </Badge>
          ))}
        </div>
      </CardContent>
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
    track: new Set(),
    sourceKind: new Set(),
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
  const isFilterSelected = (sectionId: string, value: string) => selectedFilters[sectionId]?.has(value)

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
      track: new Set(),
      sourceKind: new Set(),
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
        t.tags.some((tag) => tag.toLowerCase().includes(q))

      // Use Case filter
      const useCaseFilter = selectedFilters.useCase
      const matchesUseCase = useCaseFilter.size === 0 || t.useCase.some((uc) => useCaseFilter.has(uc))

      // Framework filter
      const frameworkFilter = selectedFilters.framework
      const matchesFramework = frameworkFilter.size === 0 || (t.framework && frameworkFilter.has(t.framework))

      // Category filter
      const categoryFilter = selectedFilters.category
      const matchesCategory = categoryFilter.size === 0 || categoryFilter.has(t.category)

      // Track filter
      const trackFilter = selectedFilters.track
      const matchesTrack = trackFilter.size === 0 || (t.track && trackFilter.has(t.track))

      // Source filter
      const sourceFilter = selectedFilters.sourceKind
      const matchesSource = sourceFilter.size === 0 || sourceFilter.has(t.sourceKind)

      return matchesSearch && matchesUseCase && matchesFramework && matchesCategory && matchesTrack && matchesSource
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
      <div className="rounded-3xl border border-border/60 bg-gradient-to-br from-background via-background to-muted/25 p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/80 px-3 py-1 text-xs font-medium text-muted-foreground">
              <Star className="h-3.5 w-3.5 text-yellow-500 fill-yellow-500" />
              Curated deployable templates
            </div>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">Find your template</h1>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                Start with a goal, narrow by stack, then deploy a ready-made app or service with the right brand logo and source clearly visible.
              </p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 lg:min-w-[34rem]">
            {[
              { label: "AI", sectionId: "track", value: "ai", helper: "Agents, chat, and LLM tools" },
              { label: "Open source", sectionId: "track", value: "open-source", helper: "Repo-backed templates" },
              { label: "Ops", sectionId: "track", value: "ops", helper: "Infrastructure and service tools" },
              { label: "Starter", sectionId: "track", value: "starter", helper: "Simple foundations for new apps" },
            ].map((item) => {
              const selected = isFilterSelected(item.sectionId, item.value)
              return (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => toggleFilter(item.sectionId, item.value)}
                  className={cn(
                    "rounded-2xl border p-4 text-left transition-all duration-200 hover:-translate-y-0.5",
                    selected
                      ? "border-primary/40 bg-primary/5 shadow-sm"
                      : "border-border/60 bg-background hover:border-primary/30"
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold">{item.label}</span>
                    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide", selected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
                      {selected ? "Selected" : "Quick pick"}
                    </span>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{item.helper}</p>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* Full-width search bar */}
      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by template, stack, or use case..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-12 rounded-2xl border-border/60 bg-background pl-11 text-base focus:border-primary/40"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {(searchQuery || hasActiveFilters) && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Active filters
            </span>
            {searchQuery && (
              <Badge variant="secondary" className="gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium">
                Search: {searchQuery}
                <button type="button" onClick={() => setSearchQuery("")} aria-label="Clear search">
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            )}
            {Object.entries(selectedFilters).flatMap(([sectionId, values]) =>
              Array.from(values).map((value) => (
                <Badge
                  key={`${sectionId}-${value}`}
                  variant="secondary"
                  className="gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium"
                >
                  {getFilterLabel(sectionId, value)}
                  <button type="button" onClick={() => toggleFilter(sectionId, value)} aria-label={`Remove ${value}`}>
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))
            )}
            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearAllFilters}
                className="text-xs font-medium text-primary transition-colors hover:text-primary/80"
              >
                Clear all
              </button>
            )}
          </div>
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
          Filter templates
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
            "w-[248px] flex-shrink-0 space-y-1",
            "hidden lg:block",
            mobileSidebarOpen && "!block"
          )}
        >
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Refine results</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">Start with a track, then narrow by stack.</p>
            </div>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearAllFilters}
                className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
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
          <div className="mb-4 flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Showing {filteredTemplates.length} template{filteredTemplates.length !== 1 ? "s" : ""}{searchQuery ? ` for "${searchQuery}"` : ""}
            </p>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearAllFilters}
                className="text-xs font-medium text-primary transition-colors hover:text-primary/80"
              >
                Reset filters
              </button>
            )}
          </div>

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
                  <TemplateLogo key={preDeployTemplate.id} template={preDeployTemplate} className="h-12 w-12" />
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
              <div className="flex flex-wrap gap-2 text-sm">
                <Badge variant="secondary">
                  {preDeployTemplate.sourceKind === "git" ? (
                    <span className="flex items-center gap-1">
                      <Github className="h-3 w-3" />
                      Open source
                    </span>
                  ) : (
                    SOURCE_LABELS.docker
                  )}
                </Badge>
                {preDeployTemplate.framework && (
                  <Badge variant="outline">{preDeployTemplate.framework}</Badge>
                )}
                {preDeployTemplate.track && (
                  <Badge variant="outline">{getTrackLabel(preDeployTemplate.track)}</Badge>
                )}
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
