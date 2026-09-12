"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { AlertTriangle, BookOpen, Boxes, ChevronDown, ChevronRight, Globe, Loader2, Search, ShieldCheck, Sparkles } from "lucide-react"
import { trpc } from "@/components/trpc-provider"
import { useOrganization, useProjects } from "@/hooks/use-auth"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ResponsiveModal } from "@/components/ui/responsive-modal"
import { getFriendlyMessage } from "@/lib/errors"
import { cn } from "@/lib/utils"

const FRIENDLY_VARIABLE_LABELS: Record<string, string> = {
  OPENAI_API_KEY: "OpenAI API Key",
  ANTHROPIC_API_KEY: "Anthropic API Key",
  DEEPSEEK_API_KEY: "DeepSeek API Key",
  GEMINI_API_KEY: "Google Gemini API Key",
  GROQ_API_KEY: "Groq API Key",
  OPENROUTER_API_KEY: "OpenRouter API Key",
  OPENCLAW_PRIMARY_MODEL: "Primary AI Model",
  DISCORD_BOT_TOKEN: "Discord Bot Token",
  TELEGRAM_BOT_TOKEN: "Telegram Bot Token",
  SLACK_BOT_TOKEN: "Slack Bot Token",
  SLACK_APP_TOKEN: "Slack App Token",
  WHATSAPP_ENABLED: "Enable WhatsApp Integration",
  MISTRAL_API_KEY: "Mistral API Key",
  VOYAGE_API_KEY: "Voyage API Key",
  COHERE_API_KEY: "Cohere API Key",
  CEREBRAS_API_KEY: "Cerebras API Key",
  KIMI_API_KEY: "Kimi API Key",
  MINIMAX_API_KEY: "MiniMax API Key",
  MOONSHOT_API_KEY: "Moonshot API Key",
}

function getVariableLabel(key: string): string {
  if (FRIENDLY_VARIABLE_LABELS[key]) return FRIENDLY_VARIABLE_LABELS[key]
  return key
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}

function isSecretKey(key: string): boolean {
  const upper = key.toUpperCase()
  return upper.includes("KEY") || upper.includes("SECRET") || upper.includes("PASSWORD") || upper.includes("TOKEN")
}

interface CatalogueEntry {
  id: string
  name: string
  description: string
  category: string
  tags: string[]
  documentationUrl: string | null
  notices: string[]
  services: Array<{ name: string; image: string | null }>
  userVariables: Array<{ key: string; required: boolean; defaultValue: string | null }>
  publicServices: string[]
}

const STACK_NAME = /^[a-zA-Z0-9][a-zA-Z0-9 _-]*$/

export type CatalogueView = "apps" | "services"

export function CatalogueViewToggle({ view, onChange }: { view: CatalogueView; onChange: (view: CatalogueView) => void }) {
  return (
    <div role="tablist" aria-label="Template type" className="inline-flex rounded-xl border border-border/60 bg-muted/40 p-1">
      {(
        [
          { id: "apps", label: "App templates" },
          { id: "services", label: "One-click services" },
        ] as const
      ).map((option) => (
        <button
          key={option.id}
          type="button"
          role="tab"
          aria-selected={view === option.id}
          onClick={() => onChange(option.id)}
          className={cn(
            "rounded-lg px-4 py-1.5 text-sm font-medium transition-colors",
            view === option.id ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/**
 * Verified Compose templates, deployed as stacks. Every entry passed the
 * deployment gate and is accepted by the stack deployer; see
 * apps/api/src/services/templates/catalogue.ts.
 */
export function ServiceCatalogue() {
  const router = useRouter()
  const { orgId } = useOrganization()
  const { projectId } = useProjects(orgId)
  const [search, setSearch] = useState("")
  const [category, setCategory] = useState<string | null>(null)
  const [selected, setSelected] = useState<CatalogueEntry | null>(null)
  const [stackName, setStackName] = useState("")
  const [values, setValues] = useState<Record<string, string>>({})
  const [showAdvanced, setShowAdvanced] = useState(false)

  const listQuery = trpc.serviceTemplate.list.useQuery(undefined, { staleTime: 5 * 60 * 1000 })
  const deployMutation = trpc.serviceTemplate.deploy.useMutation({
    onSuccess: (result) => {
      toast.success("Stack created — deploying now")
      for (const warning of result.warnings) toast.warning(warning)
      setSelected(null)
      router.push(`/dashboard/stacks/${result.stackId}`)
    },
    onError: (err) => toast.error(getFriendlyMessage(err)),
  })

  const templates = useMemo(() => {
    const all: CatalogueEntry[] = listQuery.data?.templates ?? []
    const q = search.trim().toLowerCase()
    return all.filter((entry) => {
      if (category && entry.category !== category) return false
      if (!q) return true
      return (
        entry.name.toLowerCase().includes(q) ||
        entry.description.toLowerCase().includes(q) ||
        entry.tags.some((tag) => tag.toLowerCase().includes(q))
      )
    })
  }, [listQuery.data, search, category])

  const openDeploy = (entry: CatalogueEntry) => {
    setSelected(entry)
    setShowAdvanced(false)
    setStackName(entry.id.slice(0, 63))
    setValues(Object.fromEntries(entry.userVariables.map((v) => [v.key, v.defaultValue ?? ""])))
  }

  const missing = selected?.userVariables.filter((v) => v.required && !(values[v.key] ?? "").trim()).map((v) => v.key) ?? []
  const nameError =
    stackName.trim().length === 0
      ? "Give the stack a name."
      : !STACK_NAME.test(stackName.trim()) || stackName.trim().length > 63
        ? "Use up to 63 letters, numbers, spaces, hyphens and underscores."
        : null
  const canDeploy = !!selected && !!projectId && !nameError && missing.length === 0 && !deployMutation.isLoading

  const submit = () => {
    if (!selected || !projectId || !canDeploy) return
    const provided = Object.fromEntries(Object.entries(values).filter(([, value]) => value !== ""))
    deployMutation.mutate({ templateId: selected.id, projectId, name: stackName.trim(), values: provided })
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">One-click services</h2>
          <p className="text-sm text-muted-foreground">
            {listQuery.data
              ? `${listQuery.data.total} self-hosted services, each verified to deploy. Secrets are generated for you.`
              : "Self-hosted services, each verified to deploy."}
          </p>
        </div>
        <div className="relative sm:w-80">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search services"
            placeholder="Search services..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {listQuery.data && listQuery.data.categories.length > 1 && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant={category === null ? "default" : "outline"} onClick={() => setCategory(null)}>
            All
          </Button>
          {listQuery.data.categories.map((c: string) => (
            <Button key={c} size="sm" variant={category === c ? "default" : "outline"} onClick={() => setCategory(c)}>
              {c}
            </Button>
          ))}
        </div>
      )}

      {listQuery.isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : listQuery.isError ? (
        <p className="text-sm text-destructive">{getFriendlyMessage(listQuery.error)}</p>
      ) : templates.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">No services match your search.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {templates.map((entry) => (
            <Card key={entry.id} className="flex flex-col">
              <CardHeader className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base">{entry.name}</CardTitle>
                  <Badge variant="outline" className="shrink-0 text-xs">
                    {entry.category}
                  </Badge>
                </div>
                <CardDescription className="line-clamp-3">{entry.description}</CardDescription>
              </CardHeader>
              <CardContent className="mt-auto space-y-3">
                <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <Boxes className="h-3.5 w-3.5" />
                    {entry.services.length} service{entry.services.length === 1 ? "" : "s"}
                  </span>
                  {entry.publicServices.length > 0 && (
                    <span className="inline-flex items-center gap-1">
                      <Globe className="h-3.5 w-3.5" />
                      Public URL
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    Verified
                  </span>
                </div>
                <Button className="w-full" onClick={() => openDeploy(entry)} disabled={!projectId}>
                  Deploy {entry.name}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <ResponsiveModal
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected ? `Deploy ${selected.name}` : "Deploy"}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setSelected(null)} disabled={deployMutation.isLoading}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={!canDeploy}>
              {deployMutation.isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Deploy stack
            </Button>
          </div>
        }
      >
        {selected && (
          <div className="space-y-4">
            {selected.notices.map((notice) => (
              <p key={notice} className="flex gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {notice}
              </p>
            ))}
            <div className="space-y-1.5">
              <Label htmlFor="catalogue-stack-name">Stack name</Label>
              <Input id="catalogue-stack-name" value={stackName} onChange={(e) => setStackName(e.target.value)} />
              {nameError && <p className="text-xs text-destructive">{nameError}</p>}
            </div>
            {selected.userVariables.length > 0 && (() => {
              const requiredVars = selected.userVariables.filter((v) => v.required)
              const optionalVars = selected.userVariables.filter((v) => !v.required)

              return (
                <div className="space-y-4">
                  {requiredVars.length > 0 && (
                    <div className="space-y-3">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                        <Sparkles className="h-3.5 w-3.5 text-primary" />
                        Required Configuration
                      </div>
                      {requiredVars.map((variable) => (
                        <div key={variable.key} className="space-y-1.5">
                          <Label htmlFor={`catalogue-var-${variable.key}`} className="flex items-center justify-between text-xs font-medium">
                            <span>
                              {getVariableLabel(variable.key)}
                              <span className="text-destructive"> *</span>
                            </span>
                            <span className="font-mono text-[10px] text-muted-foreground font-normal">{variable.key}</span>
                          </Label>
                          <Input
                            id={`catalogue-var-${variable.key}`}
                            type={isSecretKey(variable.key) ? "password" : "text"}
                            placeholder="Required"
                            value={values[variable.key] ?? ""}
                            onChange={(e) => setValues((prev) => ({ ...prev, [variable.key]: e.target.value }))}
                          />
                        </div>
                      ))}
                    </div>
                  )}

                  {optionalVars.length > 0 && (
                    <div className="rounded-lg border border-border/50 bg-muted/20 p-3">
                      <button
                        type="button"
                        onClick={() => setShowAdvanced(!showAdvanced)}
                        className="flex items-center justify-between w-full text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <span className="flex items-center gap-1.5">
                          {showAdvanced ? (
                            <ChevronDown className="h-3.5 w-3.5 text-primary" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                          )}
                          Optional settings & integrations ({optionalVars.length})
                        </span>
                        <span className="text-[10px] text-muted-foreground/80">
                          {showAdvanced ? "Collapse" : "Expand"}
                        </span>
                      </button>

                      {showAdvanced && (
                        <div className="mt-3 space-y-3 pt-2 border-t border-border/40">
                          {optionalVars.map((variable) => (
                            <div key={variable.key} className="space-y-1">
                              <Label htmlFor={`catalogue-var-${variable.key}`} className="flex items-center justify-between text-xs font-medium">
                                <span>{getVariableLabel(variable.key)}</span>
                                <span className="font-mono text-[10px] text-muted-foreground font-normal">{variable.key}</span>
                              </Label>
                              <Input
                                id={`catalogue-var-${variable.key}`}
                                type={isSecretKey(variable.key) ? "password" : "text"}
                                placeholder={variable.defaultValue ? `Default: ${variable.defaultValue}` : "Optional"}
                                value={values[variable.key] ?? ""}
                                onChange={(e) => setValues((prev) => ({ ...prev, [variable.key]: e.target.value }))}
                              />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })()}
            <p className="text-xs text-muted-foreground">
              Passwords and keys are generated and stored encrypted with the stack. Services:{" "}
              {selected.services.map((s) => s.name).join(", ")}.
            </p>
            {selected.documentationUrl && (
              <a
                href={selected.documentationUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <BookOpen className="h-3.5 w-3.5" />
                Documentation
              </a>
            )}
          </div>
        )}
      </ResponsiveModal>
    </div>
  )
}
