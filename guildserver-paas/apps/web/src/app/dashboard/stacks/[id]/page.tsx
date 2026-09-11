"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { toast } from "sonner"
import { ArrowLeft, Check, Copy, ExternalLink, Globe, Loader2, Play, RefreshCw, RotateCw, Square, Terminal, Trash2 } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { EnvVarEditor, type EnvVarEntry } from "@/components/env-var-editor"
import { ErrorState } from "@/components/error-state"
import { StackStatusBadge } from "@/components/stacks/stack-status-badge"
import { NATIVE_SELECT_CLASS } from "@/components/settings/shared"
import { trpc } from "@/components/trpc-provider"
import { getFriendlyMessage } from "@/lib/errors"
import { entriesToEnv, envToEntries, parseDomainList, stackErrorMessage } from "@/lib/stacks"
import { formatDateTime } from "@/lib/utils"

type Container = {
  composeServiceName: string
  containerName?: string | null
  image?: string | null
  status?: string | null
  health?: string | null
  hostPort?: number | null
  containerPort?: number | null
}

type Deployment = { id: string; title?: string | null; status?: string | null; createdAt?: string | Date | null; completedAt?: string | Date | null }

export default function StackDetailPage() {
  const params = useParams()
  const id = String((params as { id?: string } | null)?.id ?? "")
  const router = useRouter()
  const [tab, setTab] = useState("services")

  const stackQuery = trpc.service.getById.useQuery(
    { id },
    { enabled: !!id, refetchInterval: (data: any) => (data?.status === "deploying" ? 3000 : 15000) },
  )
  const statusQuery = trpc.service.status.useQuery({ id }, { enabled: !!id && tab === "services", refetchInterval: 15000 })
  const previewQuery = trpc.service.preview.useQuery({ id }, { enabled: !!id && (tab === "compose" || tab === "domains"), retry: false })

  const [logService, setLogService] = useState("")
  const logsQuery = trpc.service.logs.useQuery(
    { id, composeServiceName: logService || undefined, tail: 300 },
    { enabled: !!id && tab === "logs", refetchInterval: tab === "logs" ? 3000 : false },
  )

  const stack = stackQuery.data as any

  const [composeFile, setComposeFile] = useState("")
  const [composeProblem, setComposeProblem] = useState<string | null>(null)
  const [envEntries, setEnvEntries] = useState<EnvVarEntry[]>([])
  const [domainText, setDomainText] = useState<Record<string, string>>({})
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [removeVolumes, setRemoveVolumes] = useState(false)
  const [copied, setCopied] = useState(false)

  // Seed the editors once per stack; later refetches must not clobber unsaved edits.
  useEffect(() => {
    if (!stack?.id) return
    setComposeFile(stack.composeFile ?? "")
    setEnvEntries(envToEntries(stack.environment))
    const domains = (stack.domains ?? {}) as Record<string, string[]>
    setDomainText(Object.fromEntries(Object.entries(domains).map(([service, list]) => [service, (list ?? []).join(", ")])))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stack?.id])

  const refresh = () => {
    stackQuery.refetch()
    statusQuery.refetch()
  }
  const onError = (err: unknown) => toast.error(stackErrorMessage(err, getFriendlyMessage))

  const deployMutation = trpc.service.deploy.useMutation({
    onSuccess: () => {
      toast.success("Deployment queued")
      refresh()
    },
    onError,
  })
  const stopMutation = trpc.service.stop.useMutation({
    onSuccess: (result: { success: boolean; output?: string }) => {
      result.success ? toast.success("Stack stopped") : toast.error(result.output || "Stop failed")
      refresh()
    },
    onError,
  })
  const restartMutation = trpc.service.restart.useMutation({
    onSuccess: (result: { success: boolean; output?: string }) => {
      result.success ? toast.success("Stack restarted") : toast.error(result.output || "Restart failed")
      refresh()
    },
    onError,
  })
  const updateMutation = trpc.service.update.useMutation({
    onSuccess: () => {
      toast.success("Saved. Deploy to apply the change.")
      setComposeProblem(null)
      stackQuery.refetch()
      previewQuery.refetch()
    },
    onError: (err: unknown) => {
      const message = stackErrorMessage(err, getFriendlyMessage)
      if (tab === "compose") setComposeProblem(message)
      else toast.error(message)
    },
  })
  const deleteMutation = trpc.service.delete.useMutation({
    onSuccess: () => {
      toast.success("Stack deleted")
      router.push("/dashboard/stacks")
    },
    onError,
  })

  if (stackQuery.isLoading) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }
  if (stackQuery.error || !stack) {
    return <ErrorState error={stackQuery.error ?? new Error("Stack not found")} onRetry={() => stackQuery.refetch()} />
  }

  const containers: Container[] = (statusQuery.data?.containers as Container[] | undefined) ?? (stack.containers as Container[]) ?? []
  const missing: string[] = (statusQuery.data?.missing as string[] | undefined) ?? []
  const previewServices = (previewQuery.data?.services ?? []) as Array<{ composeServiceName: string; routedPort?: number | null; domains?: string[] }>
  const busy = deployMutation.isPending || stopMutation.isPending || restartMutation.isPending

  const domainMap = (stack.domains ?? {}) as Record<string, string[]>
  const allDomains = Object.values(domainMap).flat().filter(Boolean)
  const primaryDomain = allDomains[0] ?? null
  const primaryUrl = primaryDomain ? `https://${primaryDomain}` : null

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Link href="/dashboard/stacks" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          Stacks
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-3xl font-semibold tracking-tight">{stack.name}</h1>
              <StackStatusBadge status={stack.status} />
            </div>
            <p className="text-sm text-muted-foreground">
              {stack.description || "Docker Compose stack"}
              {stack.templateId && stack.templateId !== "custom" ? ` · template ${stack.templateId}` : ""}
            </p>
            {primaryUrl && (
              <div className="flex flex-wrap items-center gap-2 pt-2">
                <a
                  href={primaryUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 font-mono text-xs font-medium text-primary transition-colors hover:bg-primary/10"
                >
                  <Globe className="h-3.5 w-3.5" />
                  {primaryDomain}
                </a>
                <Button variant="outline" size="sm" className="h-7 gap-1 px-2.5 text-xs" asChild>
                  <a href={primaryUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-3.5 w-3.5" />
                    Open
                  </a>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 px-2 text-xs"
                  onClick={() => {
                    navigator.clipboard.writeText(primaryUrl)
                    setCopied(true)
                    toast.success("URL copied to clipboard")
                    setTimeout(() => setCopied(false), 2000)
                  }}
                >
                  {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? "Copied" : "Copy URL"}
                </Button>
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => deployMutation.mutate({ id })} disabled={busy || stack.status === "deploying"}>
              {deployMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
              Deploy
            </Button>
            <Button variant="outline" onClick={() => restartMutation.mutate({ id })} disabled={busy}>
              <RotateCw className="mr-2 h-4 w-4" />
              Restart
            </Button>
            <Button variant="outline" onClick={() => stopMutation.mutate({ id })} disabled={busy}>
              <Square className="mr-2 h-4 w-4" />
              Stop
            </Button>
            <Button
              variant="outline"
              className="text-red-600 hover:text-red-700"
              onClick={() => {
                setRemoveVolumes(false)
                setDeleteOpen(true)
              }}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </Button>
          </div>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList className="flex h-auto flex-wrap justify-start">
          <TabsTrigger value="services">Services</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
          <TabsTrigger value="compose">Compose</TabsTrigger>
          <TabsTrigger value="environment">Environment</TabsTrigger>
          <TabsTrigger value="domains">Domains</TabsTrigger>
          <TabsTrigger value="deployments">Deployments</TabsTrigger>
        </TabsList>

        <TabsContent value="services">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle>Services</CardTitle>
                <CardDescription>One container per Compose service, checked against Docker every 15 seconds.</CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={refresh}>
                <RefreshCw className="mr-2 h-3.5 w-3.5" />
                Refresh
              </Button>
            </CardHeader>
            <CardContent>
              {missing.length > 0 && (
                <p className="mb-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-sm text-amber-700 dark:text-amber-400">
                  Not running in Docker: {missing.join(", ")}
                </p>
              )}
              {containers.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">No containers yet. Deploy the stack to start them.</p>
              ) : (
                <div className="divide-y rounded-md border">
                  {containers.map((container) => (
                    <div key={container.composeServiceName} className="flex flex-wrap items-center justify-between gap-3 p-3">
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{container.composeServiceName}</span>
                          <StackStatusBadge status={container.status} />
                          {container.health && <StackStatusBadge status={container.health} />}
                        </div>
                        <p className="truncate text-xs text-muted-foreground">
                          {container.image}
                          {container.hostPort ? ` · port ${container.hostPort} → ${container.containerPort ?? "?"}` : ""}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setLogService(container.composeServiceName)
                          setTab("logs")
                        }}
                      >
                        <Terminal className="mr-1 h-3.5 w-3.5" />
                        Logs
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="logs">
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Terminal className="h-4 w-4" />
                  Logs
                </CardTitle>
                <CardDescription>Last 300 lines, refreshed every 3 seconds.</CardDescription>
              </div>
              <select
                aria-label="Service"
                className={`${NATIVE_SELECT_CLASS} w-48`}
                value={logService}
                onChange={(e) => setLogService(e.target.value)}
              >
                <option value="">All services</option>
                {containers.map((container) => (
                  <option key={container.composeServiceName} value={container.composeServiceName}>
                    {container.composeServiceName}
                  </option>
                ))}
              </select>
            </CardHeader>
            <CardContent>
              <div className="max-h-[32rem] overflow-y-auto rounded-lg bg-gray-950 p-4 font-mono text-xs text-green-400">
                {logsQuery.error ? (
                  <p className="text-red-400">{getFriendlyMessage(logsQuery.error)}</p>
                ) : ((logsQuery.data?.logs as string[] | undefined) ?? []).length === 0 ? (
                  <p className="text-gray-500">{logsQuery.isLoading ? "Loading…" : "No log output."}</p>
                ) : (
                  (logsQuery.data!.logs as string[]).map((line, index) => (
                    <div key={index} className="whitespace-pre-wrap py-0.5">
                      {line}
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="compose" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Compose file</CardTitle>
              <CardDescription>Stored exactly as written. Saving checks it; deploying applies it.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                aria-label="Compose file"
                value={composeFile}
                onChange={(e) => setComposeFile(e.target.value)}
                rows={20}
                spellCheck={false}
                className="font-mono text-xs"
              />
              {composeProblem && (
                <div role="alert" className="whitespace-pre-wrap rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-400">
                  {composeProblem}
                </div>
              )}
              <div className="flex justify-end">
                <Button
                  onClick={() => updateMutation.mutate({ id, composeFile })}
                  disabled={updateMutation.isPending || composeFile === stack.composeFile || !composeFile.trim()}
                >
                  {updateMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save compose file
                </Button>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>What Docker receives</CardTitle>
              <CardDescription>The saved file after namespacing and routing. Generated credentials are redacted.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {previewQuery.isLoading ? (
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              ) : previewQuery.error ? (
                <p className="whitespace-pre-wrap text-sm text-red-600 dark:text-red-400">{stackErrorMessage(previewQuery.error, getFriendlyMessage)}</p>
              ) : previewQuery.data ? (
                <>
                  {(previewQuery.data.generatedVariables as string[]).length > 0 && (
                    <p className="text-xs text-muted-foreground">Generated: {(previewQuery.data.generatedVariables as string[]).join(", ")}</p>
                  )}
                  {(previewQuery.data.notes as string[]).map((note) => (
                    <p key={note} className="text-xs text-amber-700 dark:text-amber-400">{note}</p>
                  ))}
                  <pre className="max-h-96 overflow-auto rounded-lg bg-muted p-3 text-xs">{previewQuery.data.composeResolved as string}</pre>
                </>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="environment">
          <Card>
            <CardHeader>
              <CardTitle>Environment</CardTitle>
              <CardDescription>Values for ${"{VARIABLE}"} references in the Compose file.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <EnvVarEditor value={envEntries} onChange={setEnvEntries} />
              <div className="flex justify-end">
                <Button onClick={() => updateMutation.mutate({ id, environment: entriesToEnv(envEntries) })} disabled={updateMutation.isPending}>
                  Save environment
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="domains">
          <Card>
            <CardHeader>
              <CardTitle>Domains</CardTitle>
              <CardDescription>Route domains to a service. Point each domain&apos;s DNS at this server, then deploy.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {previewQuery.isLoading ? (
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              ) : previewServices.length === 0 ? (
                <p className="text-sm text-muted-foreground">Save a valid Compose file to configure domains.</p>
              ) : (
                previewServices.map((service) => (
                  <div key={service.composeServiceName} className="space-y-2">
                    <Label htmlFor={`domains-${service.composeServiceName}`}>
                      {service.composeServiceName}
                      {service.routedPort ? <span className="ml-2 text-xs font-normal text-muted-foreground">port {service.routedPort}</span> : null}
                    </Label>
                    <Input
                      id={`domains-${service.composeServiceName}`}
                      value={domainText[service.composeServiceName] ?? ""}
                      onChange={(e) => setDomainText((current) => ({ ...current, [service.composeServiceName]: e.target.value }))}
                      placeholder="app.example.com, www.example.com"
                    />
                  </div>
                ))
              )}
              <div className="rounded-lg border bg-muted/40 p-4 text-xs space-y-2 text-muted-foreground">
                <p className="font-semibold text-foreground">Configuring a Custom Domain:</p>
                <ol className="list-decimal pl-4 space-y-1.5">
                  <li>
                    Create a <strong className="text-foreground">CNAME</strong> record with your DNS provider pointing your domain to{" "}
                    <code className="rounded bg-background px-1.5 py-0.5 font-mono text-primary font-medium">
                      {stack.serviceName || stack.id.slice(0, 8)}.guild-technologies.com
                    </code>
                  </li>
                  <li>Enter the domain above (e.g. <code>app.yourdomain.com</code>) and click <strong>Save domains</strong>.</li>
                  <li>SSL is provisioned automatically, and traffic will route through Traefik securely.</li>
                </ol>
              </div>
              <div className="flex justify-end">
                <Button
                  onClick={() =>
                    updateMutation.mutate({
                      id,
                      domains: Object.fromEntries(
                        Object.entries(domainText)
                          .map(([service, text]) => [service, parseDomainList(text)] as const)
                          .filter(([, list]) => list.length > 0),
                      ),
                    })
                  }
                  disabled={updateMutation.isPending || previewServices.length === 0}
                >
                  Save domains
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="deployments">
          <Card>
            <CardHeader>
              <CardTitle>Deployments</CardTitle>
              <CardDescription>The last 10 deployments of this stack.</CardDescription>
            </CardHeader>
            <CardContent>
              {((stack.deployments as Deployment[]) ?? []).length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">Not deployed yet.</p>
              ) : (
                <div className="divide-y rounded-md border">
                  {(stack.deployments as Deployment[]).map((deployment) => (
                    <div key={deployment.id} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
                      <div className="flex items-center gap-2">
                        <StackStatusBadge status={deployment.status} />
                        <span>{deployment.title}</span>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {deployment.createdAt ? formatDateTime(deployment.createdAt) : ""}
                        {deployment.completedAt ? ` → ${formatDateTime(deployment.completedAt)}` : ""}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {stack.name}?</DialogTitle>
            <DialogDescription>This stops and removes the stack&apos;s containers and network.</DialogDescription>
          </DialogHeader>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={removeVolumes} onChange={(e) => setRemoveVolumes(e.target.checked)} />
            <span>
              Also delete its volumes
              <span className="block text-xs text-muted-foreground">Volumes hold the stack&apos;s data, such as databases. This cannot be undone.</span>
            </span>
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={() => deleteMutation.mutate({ id, removeVolumes })}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {removeVolumes ? "Delete stack and data" : "Delete stack"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
