"use client"
import { useState } from "react"
import { trpc } from "@/components/trpc-provider"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { toast } from "sonner"
export function DatabaseConnection({ id, name }: { id: string; name: string }) {
  const [open, setOpen] = useState(false)
  const [target, setTarget] = useState<"internal" | "external">("external")
  const [reveal, setReveal] = useState(false)
  const info = trpc.database.getConnectionInfo.useQuery({ id, target, includePassword: reveal }, { enabled: open, cacheTime: 0 })
  return <><Button variant="outline" size="sm" onClick={() => setOpen(true)}>Connection details</Button>
    <Dialog open={open} onOpenChange={value => { setOpen(value); if (!value) setReveal(false) }}><DialogContent>
      <DialogTitle>Connect to {name}</DialogTitle>
      <DialogDescription>Use an external address from your computer, or the internal address from applications on this server.</DialogDescription>
      <label className="text-sm">Connect from<select aria-label="Connection location" value={target} onChange={e => { setTarget(e.target.value as typeof target); setReveal(false) }} className="ml-2 rounded-md border bg-background p-2"><option value="external">My computer</option><option value="internal">An app on this server</option></select></label>
      {info.error && <p role="alert" className="text-sm text-destructive">{info.error.message}</p>}
      {info.isLoading ? <p>Loading connection details…</p> : info.data && <>
        <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 text-sm"><dt>Host</dt><dd className="break-all font-mono">{info.data.host}</dd><dt>Port</dt><dd>{info.data.port}</dd><dt>Database</dt><dd>{info.data.database}</dd><dt>Username</dt><dd>{info.data.username}</dd></dl>
        <Input aria-label="Database connection URL" type={reveal ? "text" : "password"} value={info.data.connectionString} readOnly />
        <div className="flex gap-2"><Button variant="outline" onClick={() => setReveal(value => !value)}>{reveal ? "Hide credentials" : "Reveal credentials"}</Button><Button disabled={!reveal || info.isFetching} onClick={async () => { try { await navigator.clipboard.writeText(info.data!.connectionString); toast.success("Connection URL copied") } catch { toast.error("Could not copy. Select and copy the URL manually.") } }}>Copy connection URL</Button></div>
        <p className="text-xs text-muted-foreground">Paste these settings into a database client such as DBeaver, pgAdmin, MongoDB Compass, or RedisInsight. This is a database connection, not a browser URL.</p>
      </>}
    </DialogContent></Dialog></>
}
