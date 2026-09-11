"use client"

import { useMemo, useState } from "react"
import { toast } from "sonner"
import { Loader2, Plus, ScrollText, Send, Trash2, X } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { trpc } from "@/components/trpc-provider"
import { useOrganization, useProjects } from "@/hooks/use-auth"
import { getFriendlyMessage } from "@/lib/errors"
import { DeliveryStatus, NATIVE_SELECT_CLASS, useCanManage } from "./shared"

type DrainRow = {
  id: string
  name: string
  resource: { type: "application" | "service"; id: string }
  host: string
  headerNames: string[]
  format: string
  enabled: boolean
  lastDeliveryAt: string | Date | null
  lastDeliveryOk: boolean | null
  lastError: string | null
  recordsSent: number
  recordsDropped: number
}

type HeaderRow = { key: string; value: string }

export function LogDrainsCard() {
  const { orgId } = useOrganization()
  const canManage = useCanManage()
  const { projects } = useProjects(orgId)
  const drainsQuery = trpc.logDrain.list.useQuery({ organizationId: orgId }, { enabled: !!orgId })
  const appsQuery = trpc.application.listByOrg.useQuery({ organizationId: orgId }, { enabled: !!orgId })
  const serviceQueries = trpc.useQueries((t) => projects.map((project: { id: string }) => t.service.list({ projectId: project.id })))

  const resources = useMemo(() => {
    const apps = ((appsQuery.data ?? []) as Array<{ id: string; appName?: string; name?: string }>).map((app) => ({
      type: "application" as const,
      id: app.id,
      name: app.appName || app.name || app.id,
    }))
    const stacks = serviceQueries.flatMap((query) =>
      ((query.data ?? []) as Array<{ id: string; name: string }>).map((stack) => ({ type: "service" as const, id: stack.id, name: stack.name })),
    )
    return [...apps, ...stacks]
  }, [appsQuery.data, serviceQueries])

  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [resourceType, setResourceType] = useState<"application" | "service">("application")
  const [resourceId, setResourceId] = useState("")
  const [url, setUrl] = useState("")
  const [format, setFormat] = useState<"json" | "ndjson">("json")
  const [headers, setHeaders] = useState<HeaderRow[]>([])
  const [deleting, setDeleting] = useState<DrainRow | null>(null)

  const refetch = () => drainsQuery.refetch()
  const onError = (err: unknown) => toast.error(getFriendlyMessage(err))

  function resetForm() {
    setName("")
    setResourceType("application")
    setResourceId("")
    setUrl("")
    setFormat("json")
    setHeaders([])
  }

  const createMutation = trpc.logDrain.create.useMutation({
    onSuccess: () => {
      toast.success("Log drain added. Forwarding starts within 30 seconds.")
      setOpen(false)
      resetForm()
      refetch()
    },
    onError,
  })
  const updateMutation = trpc.logDrain.update.useMutation({ onSuccess: refetch, onError })
  const deleteMutation = trpc.logDrain.delete.useMutation({
    onSuccess: () => {
      toast.success("Log drain deleted")
      setDeleting(null)
      refetch()
    },
    onError,
  })
  const testMutation = trpc.logDrain.test.useMutation({
    onSuccess: (result: { ok: boolean; error?: string }) => {
      if (result.ok) toast.success("Test record delivered")
      else toast.error(`Test failed: ${result.error}`)
      refetch()
    },
    onError,
  })

  const drains = (drainsQuery.data ?? []) as DrainRow[]
  const resourceName = (drain: DrainRow) => resources.find((r) => r.id === drain.resource.id)?.name ?? drain.resource.id
  const choices = resources.filter((r) => r.type === resourceType)

  const handleCreate = () => {
    const headerObject = Object.fromEntries(headers.filter((h) => h.key.trim()).map((h) => [h.key.trim(), h.value]))
    createMutation.mutate({
      organizationId: orgId,
      name: name.trim(),
      resource: { type: resourceType, id: resourceId },
      target: { url: url.trim(), headers: headerObject, format },
    })
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div className="space-y-1.5">
          <CardTitle className="flex items-center gap-2">
            <ScrollText className="h-5 w-5" />
            Log Drains
          </CardTitle>
          <CardDescription>
            Forward an application&apos;s or stack&apos;s container logs to Fluent Bit, Vector, Axiom, Better Stack or any HTTP endpoint.
          </CardDescription>
        </div>
        {canManage && (
          <Button onClick={() => setOpen(true)} disabled={!orgId}>
            <Plus className="mr-2 h-4 w-4" />
            Add drain
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {drainsQuery.isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : drains.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No log drains yet.</p>
        ) : (
          <div className="divide-y rounded-md border">
            {drains.map((drain) => (
              <div key={drain.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{drain.name}</span>
                    <Badge variant="secondary">{drain.format.toUpperCase()}</Badge>
                    <DeliveryStatus ok={drain.lastDeliveryOk} error={drain.lastError} at={drain.lastDeliveryAt} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {resourceName(drain)} ({drain.resource.type === "application" ? "application" : "stack"}) → {drain.host}
                    {drain.headerNames.length > 0 && ` · headers: ${drain.headerNames.join(", ")}`}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {drain.recordsSent.toLocaleString()} sent · {drain.recordsDropped.toLocaleString()} dropped
                  </p>
                  {drain.lastDeliveryOk === false && drain.lastError && (
                    <p className="text-xs text-red-600 dark:text-red-400">{drain.lastError}</p>
                  )}
                </div>
                {canManage && (
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={drain.enabled}
                      aria-label={`${drain.enabled ? "Disable" : "Enable"} ${drain.name}`}
                      onCheckedChange={(checked: boolean) => updateMutation.mutate({ id: drain.id, enabled: checked })}
                    />
                    <Button variant="outline" size="sm" onClick={() => testMutation.mutate({ id: drain.id })} disabled={testMutation.isPending}>
                      <Send className="mr-1 h-3.5 w-3.5" />
                      Test
                    </Button>
                    <Button variant="ghost" size="sm" aria-label={`Delete ${drain.name}`} onClick={() => setDeleting(drain)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) resetForm() }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add log drain</DialogTitle>
            <DialogDescription>The URL and header values are stored encrypted and never shown again.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="drain-name">Name</Label>
              <Input id="drain-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Production logs" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="drain-resource-type">Source</Label>
                <select
                  id="drain-resource-type"
                  className={NATIVE_SELECT_CLASS}
                  value={resourceType}
                  onChange={(e) => {
                    setResourceType(e.target.value as "application" | "service")
                    setResourceId("")
                  }}
                >
                  <option value="application">Application</option>
                  <option value="service">Compose stack</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="drain-resource">{resourceType === "application" ? "Application" : "Stack"}</Label>
                <select id="drain-resource" className={NATIVE_SELECT_CLASS} value={resourceId} onChange={(e) => setResourceId(e.target.value)}>
                  <option value="">Select…</option>
                  {choices.map((choice) => (
                    <option key={choice.id} value={choice.id}>{choice.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
              <div className="space-y-2">
                <Label htmlFor="drain-url">Endpoint URL</Label>
                <Input id="drain-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://logs.example.com/ingest" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="drain-format">Format</Label>
                <select id="drain-format" className={NATIVE_SELECT_CLASS} value={format} onChange={(e) => setFormat(e.target.value as "json" | "ndjson")}>
                  <option value="json">JSON array</option>
                  <option value="ndjson">NDJSON</option>
                </select>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Headers</Label>
                <Button variant="ghost" size="sm" onClick={() => setHeaders((rows) => [...rows, { key: "", value: "" }])} disabled={headers.length >= 10}>
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  Add header
                </Button>
              </div>
              {headers.map((header, index) => (
                <div key={index} className="flex gap-2">
                  <Input
                    aria-label={`Header ${index + 1} name`}
                    value={header.key}
                    onChange={(e) => setHeaders((rows) => rows.map((row, i) => (i === index ? { ...row, key: e.target.value } : row)))}
                    placeholder="Authorization"
                  />
                  <Input
                    aria-label={`Header ${index + 1} value`}
                    type="password"
                    value={header.value}
                    onChange={(e) => setHeaders((rows) => rows.map((row, i) => (i === index ? { ...row, value: e.target.value } : row)))}
                    placeholder="Bearer …"
                  />
                  <Button variant="ghost" size="sm" aria-label={`Remove header ${index + 1}`} onClick={() => setHeaders((rows) => rows.filter((_, i) => i !== index))}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={handleCreate} disabled={!name.trim() || !resourceId || !url.trim() || createMutation.isPending}>
                {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Add drain
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(next) => !next && setDeleting(null)}
        title="Delete log drain?"
        description={`Logs will stop being forwarded by "${deleting?.name ?? ""}".`}
        confirmLabel="Delete"
        variant="danger"
        loading={deleteMutation.isPending}
        onConfirm={() => deleting && deleteMutation.mutate({ id: deleting.id })}
      />
    </Card>
  )
}
