"use client"

import { useState, useMemo } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog"
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
import { CatalogueViewToggle, ServiceCatalogue, type CatalogueView } from "@/components/templates/service-catalogue"
import {
  FILTER_SECTIONS,
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
  const [isOpen, setIsOpen] = useState(section.id === "useCase" || section.id === "track")
  const activeCount = section.options.filter((o) => selected.has(o)).length

  return (
    <div className="border-b border-border/40 pb-3 mb-3 last:border-0 last:pb-0 last:mb-0">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
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
        <div className="mt-2 max-h-72 space-y-1 overflow-y-auto overscroll-contain ml-1">
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
        className={cn("h-full w-full object-contain p-2.5", ["nextdotjs", "express", "remix", "flask", "fastify", "deno"].includes(spec.slug) && "dark:invert")}
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

// Compact cards keep identity, source and the next action visible at every size.
function TemplateCard({ template, isDeploying, onDeploy }: {
  template: Template
  isDeploying: boolean
  onDeploy: (t: Template) => void
}) {
  return (
    <Card className="group flex h-full flex-col rounded-xl border-border bg-card transition-colors hover:border-primary/50">
      <CardHeader className="p-5 pb-3">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <TemplateLogo template={template} className="h-11 w-11 shrink-0" />
          {template.popular && <Badge variant="secondary" className="gap-1 text-[10px] font-medium"><Star className="h-3 w-3 text-amber-500" />Popular</Badge>}
        </div>
        <CardTitle className="break-words text-base font-semibold leading-snug">{template.name}</CardTitle>
        <CardDescription className="min-h-[3.75rem] line-clamp-3 text-sm leading-5">{template.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col px-5 pb-4 pt-0">
        <div className="mb-5 flex flex-wrap gap-1.5">
          {template.framework && <Badge variant="outline" className="rounded-md text-[11px] font-normal">{template.framework}</Badge>}
          {template.useCase.slice(0, 2).map((useCase) => <Badge key={useCase} variant="secondary" className="rounded-md text-[11px] font-normal">{getFilterLabel("useCase", useCase)}</Badge>)}
        </div>
        <div className="mt-auto flex items-center justify-between gap-2 border-t border-border/70 pt-3">
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            {template.sourceKind === "git" ? <Github className="h-3.5 w-3.5" /> : <Boxes className="h-3.5 w-3.5" />}
            {SOURCE_LABELS[template.sourceKind]}
          </span>
          <Button size="sm" variant="ghost" disabled={isDeploying} onClick={() => onDeploy(template)} aria-label={`Configure ${template.name}`} className="h-8 gap-1.5 px-2 text-primary hover:bg-primary/10 hover:text-primary">
            {isDeploying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <>Configure<ArrowRight className="h-3.5 w-3.5" /></>}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Page component ──────────────────────────────────────────────────────────

export default function TemplatesPage() {
  const [view, setView] = useState<CatalogueView>("apps")
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
      const q = searchQuery.trim().toLowerCase()
      const matchesSearch =
        !searchQuery ||
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.tags.some((tag) => tag.toLowerCase().includes(q)) ||
        (t.framework?.toLowerCase().includes(q) ?? false) ||
        t.useCase.some((value) => getFilterLabel("useCase", value).toLowerCase().includes(q))

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

  const recommendedTemplates = useMemo(() => {
    const trackWeight: Record<string, number> = {
      ai: 40,
      "open-source": 30,
      ops: 24,
      production: 18,
      starter: 12,
    }

    return [...filteredTemplates]
      .sort((a, b) => {
        const score = (template: Template) => {
          let total = 0
          if (template.popular) total += 18
          if (template.track) total += trackWeight[template.track] || 0
          if (template.useCase.includes("AI")) total += 10
          if (template.useCase.includes("Starter")) total += 6
          if (template.useCase.includes("SaaS")) total += 5
          if (template.useCase.includes("Backend")) total += 4
          if (template.sourceKind === "git") total += 2
          return total
        }

        return score(b) - score(a) || a.name.localeCompare(b.name)
      })
      .slice(0, 3)
  }, [filteredTemplates])

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

  if (view === "services") {
    return (
      <div className="space-y-6">
        <CatalogueViewToggle view={view} onChange={setView} />
        <ServiceCatalogue />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <CatalogueViewToggle view={view} onChange={setView} />
      {/* Page header */}
      <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
        <div className="flex flex-col gap-6">
          <div className="max-w-2xl space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/80 px-3 py-1 text-xs font-medium text-muted-foreground">
              <Star className="h-3.5 w-3.5 text-yellow-500 fill-yellow-500" />
              Template catalog
            </div>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">Find your template</h1>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                Launch your next project with a ready-made app. Explore by purpose, choose your stack, and make it yours.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
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
                  aria-pressed={selected}
                  className={cn(
                    "rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    selected
                      ? "border-primary/50 bg-primary/10 shadow-sm"
                      : "border-border bg-muted/30 hover:border-primary/30 hover:bg-muted/60"
                  )}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="text-sm font-semibold">{item.label}</span>
                    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide", selected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
                      {selected ? "Selected" : "Explore"}
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
            aria-label="Search templates"
            placeholder="Search templates, frameworks, or use cases…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-12 rounded-xl border-border bg-card pl-11 pr-12 text-sm focus:border-primary/50"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              aria-label="Clear search"
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
          aria-expanded={mobileSidebarOpen}
          aria-controls="catalog-filters"
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
      <div className="flex flex-col gap-6 lg:flex-row">
        {/* ── Sidebar ─────────────────────────────── */}
        <aside
          id="catalog-filters"
          aria-label="Template filters"
          className={cn(
            "w-full flex-shrink-0 self-start rounded-xl border border-border bg-card p-4 lg:w-[208px] space-y-1",
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
          {recommendedTemplates.length > 0 && !searchQuery && !hasActiveFilters && (
            <div className="mb-7 rounded-2xl border border-primary/20 bg-primary/[0.04] p-4 sm:p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold tracking-tight text-foreground">
                    Recommended
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    A few popular starting points to get you building.
                  </p>
                </div>
                <Badge variant="secondary" className="rounded-full px-2.5 py-1 text-[11px] font-medium">
                  Popular picks
                </Badge>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
                {recommendedTemplates.map((template) => (
                  <TemplateCard
                    key={`recommended-${template.id}`}
                    template={template}
                    isDeploying={deployingTemplate === template.id}
                    onDeploy={openPreDeployDialog}
                  />
                ))}
              </div>
            </div>
          )}

          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
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

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {filteredTemplates.map((template) => (
              <TemplateCard
                key={template.id}
                template={template}
                isDeploying={deployingTemplate === template.id}
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
              {(hasActiveFilters || searchQuery) && (
                <Button variant="outline" size="sm" className="mt-4" onClick={() => { clearAllFilters(); setSearchQuery("") }}>
                  Reset search and filters
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Pre-Deploy Configuration Dialog */}
      {preDeployTemplate && (
        <Dialog open onOpenChange={(open) => !open && setPreDeployTemplate(null)}>
          <DialogContent className="max-h-[85dvh] w-[calc(100%-2rem)] overflow-y-auto p-0">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <TemplateLogo key={preDeployTemplate.id} template={preDeployTemplate} className="h-12 w-12" />
                  <div>
                    <DialogTitle className="pr-6 text-lg leading-snug">Configure {preDeployTemplate.name}</DialogTitle>
                    <DialogDescription className="text-sm mt-1">
                      {preDeployTemplate.description}
                    </DialogDescription>
                  </div>
                </div>

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
          </DialogContent>
        </Dialog>
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
