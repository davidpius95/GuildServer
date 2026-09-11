"use client"

import { useMemo, useState } from "react"
import { toast } from "sonner"
import { HardDrive, Loader2, ShieldCheck } from "lucide-react"
import { trpc } from "@/components/trpc-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { getFriendlyMessage } from "@/lib/errors"

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B"
  const units = ["B", "KB", "MB", "GB", "TB"]
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** exponent
  return `${value >= 10 || exponent === 0 ? Math.round(value) : value.toFixed(1)} ${units[exponent]}`
}

interface CleanupOutcome {
  dryRun: boolean
  images: Array<{ id: string; tags: string[]; sizeBytes: number }>
  skipped: Array<{ id: string; reason: string }>
  failed: Array<{ id: string; error: string }>
  buildCache: { idleForHours: number; bytesReclaimed: number | null } | null
}

/**
 * Platform-admin disk report and cleanup. Only "safe" image candidates can be
 * selected; the server re-checks each against a fresh plan, removes images
 * without force, and never touches volumes. See docs/disk-cleanup.md.
 */
export function DiskCleanupCard() {
  const [requested, setRequested] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [includeBuildCache, setIncludeBuildCache] = useState(false)
  const [outcome, setOutcome] = useState<CleanupOutcome | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const reportQuery = trpc.monitoring.diskReport.useQuery(undefined, { enabled: requested, staleTime: 0 })
  const cleanup = trpc.monitoring.diskCleanup.useMutation({
    onSuccess: (result) => {
      setOutcome(result)
      if (!result.dryRun) {
        setConfirmOpen(false)
        setSelected(new Set())
        toast.success(`Removed ${result.images.length} image(s)`)
        reportQuery.refetch()
      }
    },
    onError: (err) => toast.error(getFriendlyMessage(err)),
  })

  const report = reportQuery.data
  const safeIds = useMemo(
    () => new Set((report?.imageCandidates ?? []).filter((c) => c.confidence === "safe").map((c) => c.id)),
    [report],
  )
  const selectedBytes = (report?.imageCandidates ?? []).filter((c) => selected.has(c.id)).reduce((sum, c) => sum + c.sizeBytes, 0)
  const nothingChosen = selected.size === 0 && !includeBuildCache

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const run = (dryRun: boolean) =>
    cleanup.mutate({ imageIds: Array.from(selected), includeBuildCache, dryRun })

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HardDrive className="h-5 w-5" />
          Disk cleanup
        </CardTitle>
        <CardDescription>
          Reclaim space from old images and build cache. Rollback targets, images in use and configured images are
          protected, and volumes are never removed.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!requested ? (
          <Button onClick={() => setRequested(true)}>Generate disk report</Button>
        ) : reportQuery.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Inspecting the Docker host…
          </div>
        ) : reportQuery.isError ? (
          <p className="text-sm text-destructive">{getFriendlyMessage(reportQuery.error)}</p>
        ) : report ? (
          <>
            <div className="grid gap-3 text-sm sm:grid-cols-3">
              <div className="rounded-lg border p-3">
                <p className="text-muted-foreground">Disk</p>
                <p className="font-semibold">
                  {report.filesystem ? `${report.filesystem.usedPercent}% used (${report.filesystem.status})` : "Unknown"}
                </p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-muted-foreground">Image candidates</p>
                <p className="font-semibold">
                  {report.summary.imageCandidates} · up to {formatBytes(report.summary.imageBytesUpTo)}
                </p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-muted-foreground">Idle build cache</p>
                <p className="font-semibold">{formatBytes(report.summary.buildCacheReclaimableBytes)}</p>
              </div>
            </div>

            {report.imageCandidates.length === 0 ? (
              <p className="text-sm text-muted-foreground">No images can be removed.</p>
            ) : (
              <div className="max-h-80 overflow-y-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-muted/60 text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="w-10 p-2" />
                      <th className="p-2">Image</th>
                      <th className="p-2">Kind</th>
                      <th className="p-2 text-right">Size</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.imageCandidates.map((candidate) => {
                      const safe = safeIds.has(candidate.id)
                      const label = candidate.tags[0] ?? candidate.id.slice(7, 19)
                      return (
                        <tr key={candidate.id} className="border-t">
                          <td className="p-2">
                            <Checkbox
                              aria-label={`Select ${label}`}
                              checked={selected.has(candidate.id)}
                              disabled={!safe}
                              onCheckedChange={() => toggle(candidate.id)}
                            />
                          </td>
                          <td className="p-2 font-mono text-xs">{label}</td>
                          <td className="p-2">
                            {safe ? (
                              <Badge variant="outline">{candidate.category}</Badge>
                            ) : (
                              <Badge variant="outline" className="text-muted-foreground">
                                third-party: review by hand
                              </Badge>
                            )}
                          </td>
                          <td className="p-2 text-right">{formatBytes(candidate.sizeBytes)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={includeBuildCache} onCheckedChange={(v) => setIncludeBuildCache(v === true)} />
              Also prune build cache idle for over {report.policy.buildCacheIdleDays} days
            </label>

            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5" />
              {report.summary.volumesToReview} volume(s) listed for review are never removed here.
            </p>

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" disabled={nothingChosen || cleanup.isLoading} onClick={() => run(true)}>
                Dry run
              </Button>
              <Button
                variant="destructive"
                disabled={nothingChosen || cleanup.isLoading || !outcome?.dryRun}
                onClick={() => setConfirmOpen(true)}
              >
                Remove selected
              </Button>
              <Button variant="ghost" onClick={() => reportQuery.refetch()} disabled={reportQuery.isFetching}>
                Refresh report
              </Button>
            </div>

            {outcome && (
              <div className="rounded-lg border p-3 text-sm" aria-live="polite">
                <p className="font-medium">
                  {outcome.dryRun ? "Dry run: would remove" : "Removed"} {outcome.images.length} image(s),{" "}
                  up to {formatBytes(outcome.images.reduce((sum, i) => sum + i.sizeBytes, 0))}
                  {outcome.buildCache ? " and idle build cache" : ""}.
                </p>
                {outcome.skipped.map((s) => (
                  <p key={s.id} className="text-xs text-muted-foreground">
                    Kept {s.id.slice(7, 19)}: {s.reason}
                  </p>
                ))}
                {outcome.failed.map((f) => (
                  <p key={f.id} className="text-xs text-destructive">
                    Could not remove {f.id.slice(7, 19)}: {f.error}
                  </p>
                ))}
              </div>
            )}
          </>
        ) : null}

        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title="Remove selected images?"
          description={`This deletes ${selected.size} image(s) (up to ${formatBytes(selectedBytes)})${includeBuildCache ? " and idle build cache" : ""} from the Docker host. Each image is re-checked first; anything now in use or a rollback target is kept.`}
          confirmLabel="Remove images"
          variant="danger"
          loading={cleanup.isLoading}
          confirmationText="remove"
          onConfirm={() => run(false)}
        />
      </CardContent>
    </Card>
  )
}
