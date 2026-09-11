"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Cloud, Loader2, Plus, Send, Trash2 } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { trpc } from "@/components/trpc-provider"
import { useOrganization } from "@/hooks/use-auth"
import { getFriendlyMessage } from "@/lib/errors"
import { NATIVE_SELECT_CLASS, formatWhen, useCanManage } from "./shared"

type StorageRow = {
  id: string
  name: string
  endpoint: string
  region: string
  bucket: string
  pathPrefix: string | null
  lastTestedAt: string | Date | null
  lastTestOk: boolean | null
  lastTestError: string | null
}

type DatabaseRow = { id: string; name: string; type: string; backupStorageId?: string | null }

const EMPTY_FORM = { name: "", endpoint: "", region: "us-east-1", bucket: "", pathPrefix: "", accessKeyId: "", secretAccessKey: "", forcePathStyle: true }

function TestStatus({ storage }: { storage: StorageRow }) {
  if (storage.lastTestOk === null) return <Badge variant="outline">Not tested</Badge>
  return storage.lastTestOk ? (
    <Badge variant="outline" className="border-green-500/40 text-green-600 dark:text-green-400" title={`Tested ${formatWhen(storage.lastTestedAt)}`}>
      Connected
    </Badge>
  ) : (
    <Badge variant="outline" className="border-red-500/40 text-red-600 dark:text-red-400" title={storage.lastTestError ?? undefined}>
      Failing
    </Badge>
  )
}

export function BackupStorageCard() {
  const { orgId } = useOrganization()
  const canManage = useCanManage()
  const storagesQuery = trpc.backupStorage.list.useQuery({ organizationId: orgId }, { enabled: !!orgId })
  const databasesQuery = trpc.database.listByOrg.useQuery({ organizationId: orgId }, { enabled: !!orgId })

  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [deleting, setDeleting] = useState<StorageRow | null>(null)
  const set = <K extends keyof typeof EMPTY_FORM>(key: K, value: (typeof EMPTY_FORM)[K]) => setForm((current) => ({ ...current, [key]: value }))
  const onError = (err: unknown) => toast.error(getFriendlyMessage(err))

  const createMutation = trpc.backupStorage.create.useMutation({
    onSuccess: () => {
      toast.success("Storage connected and saved")
      setOpen(false)
      setForm(EMPTY_FORM)
      storagesQuery.refetch()
    },
    onError,
  })
  const testMutation = trpc.backupStorage.test.useMutation({
    onSuccess: (result: { ok: boolean; error?: string }) => {
      if (result.ok) toast.success("Storage connection works")
      else toast.error(`Test failed: ${result.error}`)
      storagesQuery.refetch()
    },
    onError,
  })
  const deleteMutation = trpc.backupStorage.delete.useMutation({
    onSuccess: () => {
      toast.success("Storage deleted")
      setDeleting(null)
      storagesQuery.refetch()
    },
    onError,
  })
  const assignMutation = trpc.database.updateBackupSettings.useMutation({
    onSuccess: () => {
      toast.success("Backup destination updated")
      databasesQuery.refetch()
    },
    onError,
  })

  const storages = (storagesQuery.data ?? []) as StorageRow[]
  const databases = (databasesQuery.data ?? []) as DatabaseRow[]

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div className="space-y-1.5">
          <CardTitle className="flex items-center gap-2">
            <Cloud className="h-5 w-5" />
            Off-site Backup Storage
          </CardTitle>
          <CardDescription>
            Copy database backups to S3-compatible storage (AWS S3, Cloudflare R2, Backblaze B2, MinIO). Restores check every copy&apos;s checksum.
          </CardDescription>
        </div>
        {canManage && (
          <Button onClick={() => setOpen(true)} disabled={!orgId}>
            <Plus className="mr-2 h-4 w-4" />
            Add storage
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-6">
        {storagesQuery.isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : storages.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No off-site storage yet. Backups stay on this server only.</p>
        ) : (
          <div className="divide-y rounded-md border">
            {storages.map((storage) => (
              <div key={storage.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{storage.name}</span>
                    <TestStatus storage={storage} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {storage.bucket}
                    {storage.pathPrefix ? `/${storage.pathPrefix}` : ""} · {storage.endpoint} · {storage.region}
                  </p>
                  {storage.lastTestOk === false && storage.lastTestError && (
                    <p className="text-xs text-red-600 dark:text-red-400">{storage.lastTestError}</p>
                  )}
                </div>
                {canManage && (
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => testMutation.mutate({ id: storage.id })} disabled={testMutation.isPending}>
                      <Send className="mr-1 h-3.5 w-3.5" />
                      Test
                    </Button>
                    <Button variant="ghost" size="sm" aria-label={`Delete ${storage.name}`} onClick={() => setDeleting(storage)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {databases.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Where each database&apos;s backups go</h3>
            <div className="divide-y rounded-md border">
              {databases.map((database) => (
                <div key={database.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                  <div>
                    <p className="text-sm font-medium">{database.name}</p>
                    <p className="text-xs text-muted-foreground">{database.type}</p>
                  </div>
                  <select
                    aria-label={`Backup destination for ${database.name}`}
                    className={`${NATIVE_SELECT_CLASS} w-56`}
                    value={database.backupStorageId ?? ""}
                    disabled={!canManage || assignMutation.isPending}
                    onChange={(e) => assignMutation.mutate({ id: database.id, backupStorageId: e.target.value || null })}
                  >
                    <option value="">This server only</option>
                    {storages.map((storage) => (
                      <option key={storage.id} value={storage.id}>Off-site: {storage.name}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) setForm(EMPTY_FORM) }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add backup storage</DialogTitle>
            <DialogDescription>GuildServer writes, reads and deletes a test object before saving. Keys are stored encrypted.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="storage-name">Name</Label>
              <Input id="storage-name" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="R2 backups" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="storage-endpoint">Endpoint</Label>
              <Input id="storage-endpoint" value={form.endpoint} onChange={(e) => set("endpoint", e.target.value)} placeholder="https://<account>.r2.cloudflarestorage.com" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="storage-bucket">Bucket</Label>
                <Input id="storage-bucket" value={form.bucket} onChange={(e) => set("bucket", e.target.value)} placeholder="guildserver-backups" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="storage-region">Region</Label>
                <Input id="storage-region" value={form.region} onChange={(e) => set("region", e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="storage-prefix">Path prefix (optional)</Label>
              <Input id="storage-prefix" value={form.pathPrefix} onChange={(e) => set("pathPrefix", e.target.value)} placeholder="production" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="storage-access-key">Access key ID</Label>
                <Input id="storage-access-key" value={form.accessKeyId} onChange={(e) => set("accessKeyId", e.target.value)} autoComplete="off" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="storage-secret-key">Secret access key</Label>
                <Input id="storage-secret-key" type="password" value={form.secretAccessKey} onChange={(e) => set("secretAccessKey", e.target.value)} autoComplete="off" />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={form.forcePathStyle} onCheckedChange={(checked: boolean) => set("forcePathStyle", checked)} aria-label="Path-style addressing" />
              Path-style addressing (needed for MinIO and most self-hosted S3)
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button
                onClick={() =>
                  createMutation.mutate({
                    organizationId: orgId,
                    name: form.name.trim(),
                    endpoint: form.endpoint.trim(),
                    region: form.region.trim() || "us-east-1",
                    bucket: form.bucket.trim(),
                    ...(form.pathPrefix.trim() ? { pathPrefix: form.pathPrefix.trim() } : {}),
                    accessKeyId: form.accessKeyId.trim(),
                    secretAccessKey: form.secretAccessKey,
                    forcePathStyle: form.forcePathStyle,
                  })
                }
                disabled={!form.name.trim() || !form.endpoint.trim() || !form.bucket.trim() || !form.accessKeyId.trim() || !form.secretAccessKey || createMutation.isPending}
              >
                {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {createMutation.isPending ? "Testing connection…" : "Test and save"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(next) => !next && setDeleting(null)}
        title="Delete storage?"
        description={`GuildServer will stop using "${deleting?.name ?? ""}". Storage still assigned to a database or holding backups cannot be deleted.`}
        confirmLabel="Delete"
        variant="danger"
        loading={deleteMutation.isPending}
        onConfirm={() => deleting && deleteMutation.mutate({ id: deleting.id })}
      />
    </Card>
  )
}
