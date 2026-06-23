"use client";
import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

export default function SettingsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const router = useRouter();
  const query  = trpc.baasProject.get.useQuery({ projectId });
  const p      = query.data;

  const [name,         setName]         = useState(p?.name ?? "");
  const [idleTimeout,  setIdleTimeout]  = useState<string>(String(p?.idleTimeoutMinutes ?? 30));
  const [backupDays,   setBackupDays]   = useState(p?.backupRetentionDays ?? 7);
  const [walEnabled,   setWalEnabled]   = useState(p?.walArchiveEnabled ?? false);
  const [confirmName,  setConfirmName]  = useState("");

  const update  = trpc.baasProject.update.useMutation({ onSuccess: () => { toast.success("Settings saved"); query.refetch(); } });
  const del     = trpc.baasProject.delete.useMutation({ onSuccess: () => { toast.success("Project deleted"); router.push("/dashboard"); } });
  const domains = trpc.baasDomain.list.useQuery({ projectId });
  const addDomain  = trpc.baasDomain.add.useMutation({ onSuccess: () => domains.refetch() });
  const checkDomain = trpc.baasDomain.checkVerification.useMutation({ onSuccess: () => domains.refetch() });
  const rmDomain   = trpc.baasDomain.remove.useMutation({ onSuccess: () => domains.refetch() });

  const [newHostname, setNewHostname] = useState("");

  return (
    <div className="p-6 max-w-2xl space-y-8">
      <h2 className="font-semibold text-lg">Settings</h2>

      {/* General */}
      <section className="border rounded-xl p-4 space-y-4">
        <h3 className="font-medium text-sm">General</h3>
        <div className="space-y-1.5">
          <label className="text-xs font-medium">Project name</label>
          <input value={name || (p?.name ?? "")} onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 text-sm border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/50" />
        </div>
        <button onClick={() => update.mutate({ projectId, name: name || p?.name })}
          className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90">
          Save
        </button>
      </section>

      {/* Auto-pause */}
      <section className="border rounded-xl p-4 space-y-4">
        <h3 className="font-medium text-sm">Auto-pause</h3>
        <p className="text-xs text-muted-foreground">Pause the project after N minutes of zero database connections. Set to 0 to disable.</p>
        <div className="flex gap-2 items-center">
          <input type="number" min={0} max={1440} value={idleTimeout} onChange={(e) => setIdleTimeout(e.target.value)}
            className="w-24 px-3 py-2 text-sm border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/50" />
          <span className="text-sm text-muted-foreground">minutes (0 = never)</span>
        </div>
        <button onClick={() => update.mutate({ projectId, idleTimeoutMinutes: parseInt(idleTimeout) || null })}
          className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90">
          Save
        </button>
      </section>

      {/* WAL archiving / PITR */}
      <section className="border rounded-xl p-4 space-y-4">
        <h3 className="font-medium text-sm">WAL archiving</h3>
        <p className="text-xs text-muted-foreground">Enable continuous WAL archiving for Point-in-Time Recovery. Requires remounting the DB container (brief downtime).</p>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={walEnabled} onChange={(e) => setWalEnabled(e.target.checked)} className="rounded" />
          <span className="text-sm">Enable WAL archiving (PITR)</span>
        </label>
        <button onClick={() => update.mutate({ projectId, walArchiveEnabled: walEnabled })}
          className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90">
          Save
        </button>
      </section>

      {/* Backups */}
      <section className="border rounded-xl p-4 space-y-4">
        <h3 className="font-medium text-sm">Backup retention</h3>
        <div className="flex gap-2 items-center">
          <input type="number" min={1} max={365} value={backupDays} onChange={(e) => setBackupDays(Number(e.target.value))}
            className="w-20 px-3 py-2 text-sm border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/50" />
          <span className="text-sm text-muted-foreground">days</span>
        </div>
        <button onClick={() => update.mutate({ projectId, backupRetentionDays: backupDays })}
          className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90">
          Save
        </button>
      </section>

      {/* Custom domains */}
      <section className="border rounded-xl p-4 space-y-4">
        <h3 className="font-medium text-sm">Custom domains</h3>
        {domains.data?.map((d) => (
          <div key={d.id} className="flex items-center gap-3 py-2 border-b last:border-0">
            <div className="flex-1">
              <p className="text-sm font-mono">{d.hostname}</p>
              <p className="text-xs text-muted-foreground">{d.verified ? "Active" : `Pending — add TXT: ${d.cfOwnershipTxtName} = ${d.cfOwnershipTxtValue}`}</p>
            </div>
            {!d.verified && (
              <button onClick={() => checkDomain.mutate({ hostnameId: d.id })}
                className="text-xs px-2 py-1 border rounded hover:bg-muted">Verify</button>
            )}
            <button onClick={() => rmDomain.mutate({ hostnameId: d.id })}
              className="text-xs text-destructive hover:underline">Remove</button>
          </div>
        ))}
        <div className="flex gap-2">
          <input value={newHostname} onChange={(e) => setNewHostname(e.target.value)} placeholder="api.yourdomain.com"
            className="flex-1 px-3 py-2 text-sm border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/50" />
          <button onClick={() => { addDomain.mutate({ projectId, hostname: newHostname }); setNewHostname(""); }}
            disabled={!newHostname.trim()}
            className="px-3 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 disabled:opacity-50">
            Add
          </button>
        </div>
      </section>

      {/* Danger zone */}
      <section className="border border-destructive/30 rounded-xl p-4 space-y-4">
        <h3 className="font-medium text-sm text-destructive">Danger zone</h3>
        <p className="text-xs text-muted-foreground">Permanently delete this project and all its data. This cannot be undone.</p>
        <div className="space-y-1.5">
          <label className="text-xs font-medium">Type project name to confirm: <span className="font-mono text-destructive">{p?.name}</span></label>
          <input value={confirmName} onChange={(e) => setConfirmName(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-destructive/30 rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-destructive/50" />
        </div>
        <button disabled={confirmName !== p?.name || del.isLoading}
          onClick={() => del.mutate({ projectId })}
          className="px-4 py-2 bg-destructive text-destructive-foreground text-sm font-medium rounded-lg hover:bg-destructive/90 disabled:opacity-50">
          {del.isLoading ? "Deleting…" : "Delete project"}
        </button>
      </section>
    </div>
  );
}
