"use client";
import { useParams } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { useState } from "react";

function CopyField({ label, value, mono = true }: { label: string; value?: string | null; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="flex items-center gap-2 bg-muted/50 border rounded-lg px-3 py-2">
        <span className={`flex-1 text-xs truncate ${mono ? "font-mono" : ""}`}>{value}</span>
        <button
          onClick={() => { navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
          className="text-[11px] text-muted-foreground hover:text-foreground shrink-0 transition-colors"
        >
          {copied ? "✓" : "Copy"}
        </button>
      </div>
    </div>
  );
}

const STATUS_STYLES: Record<string, string> = {
  active:       "bg-green-50 text-green-700 border-green-200",
  paused:       "bg-zinc-100 text-zinc-500 border-zinc-200",
  provisioning: "bg-amber-50 text-amber-700 border-amber-200",
  error:        "bg-red-50 text-red-700 border-red-200",
};

export default function ProjectOverviewPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const query    = trpc.baasProject.get.useQuery({ projectId });
  const connInfo = trpc.baasProject.connectionInfo.useQuery({ projectId });
  const metricsQ = trpc.baasMetrics.latest.useQuery({ projectId, limit: 1 });

  const project = query.data;
  const conn    = connInfo.data;
  const latest  = metricsQ.data?.[0];
  const status  = project?.status ?? "provisioning";

  return (
    <div className="p-6 space-y-6 max-w-4xl">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">{project?.name ?? "Loading…"}</h1>
          <p className="text-sm text-muted-foreground font-mono mt-0.5">{project?.slug}</p>
        </div>
        <span className={`text-xs font-medium px-2.5 py-1 rounded-full border capitalize ${STATUS_STYLES[status] ?? STATUS_STYLES.provisioning}`}>
          {status}
        </span>
      </div>

      {/* Provisioning banner */}
      {status === "provisioning" && (
        <div className="border border-amber-200 bg-amber-50 rounded-xl p-4 flex items-center gap-3">
          <span className="text-amber-500 text-lg animate-spin inline-block">⟳</span>
          <div>
            <p className="text-sm font-medium text-amber-800">Setting up your project</p>
            <p className="text-xs text-amber-700/70 mt-0.5">
              Pulling Supabase images and starting services. This takes 2–5 minutes on first run.
            </p>
          </div>
        </div>
      )}

      {/* Open Studio CTA */}
      {conn?.studioUrl && status === "active" && (
        <div className="border rounded-xl p-4 bg-card flex items-center justify-between gap-4">
          <div>
            <p className="font-medium text-sm">Supabase Studio</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Full-featured database, auth, storage, and edge functions dashboard
            </p>
          </div>
          <a
            href={conn.studioUrl}
            target="_blank"
            rel="noreferrer"
            className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors shrink-0"
          >
            Open Studio ↗
          </a>
        </div>
      )}

      {/* Resource metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Database size",  value: latest ? `${parseFloat(String(latest.dbSizeMb ?? 0)).toFixed(1)} MB` : "—" },
          { label: "Active conns",   value: latest ? String(latest.activeConnections ?? 0) : "—" },
          { label: "RAM used",       value: latest ? `${latest.ramMbUsed} MB` : `${project?.ramMbLimit ?? "—"} MB alloc` },
          { label: "CPU",            value: latest ? `${parseFloat(String(latest.cpuPercent ?? 0)).toFixed(1)}%` : "—" },
        ].map(({ label, value }) => (
          <div key={label} className="border rounded-xl p-4 bg-card">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="font-semibold text-lg mt-1 tabular-nums">{value}</p>
          </div>
        ))}
      </div>

      {/* Connection details */}
      {conn && (
        <div className="border rounded-xl p-5 bg-card space-y-4">
          <h2 className="font-medium text-sm">Connection details</h2>
          <CopyField label="Project URL"          value={conn.projectUrl} />
          <CopyField label="Anon (public) key"    value={conn.anonKey} />
          <CopyField label="Service role key"     value={conn.serviceRoleKey} />
          <CopyField label="DB connection string" value={conn.dbConnectionString} />
          {conn.studioUrl && <CopyField label="Studio URL" value={conn.studioUrl} mono={false} />}
        </div>
      )}

      {/* Quick start */}
      {conn && (
        <div className="border rounded-xl p-5 bg-card space-y-3">
          <h2 className="font-medium text-sm">Quick start</h2>
          <pre className="bg-muted text-xs p-4 rounded-lg font-mono overflow-auto leading-relaxed">{`npm install @supabase/supabase-js

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  '${conn.projectUrl ?? "<project-url>"}',
  '${conn.anonKey    ?? "<anon-key>"}'
)

// Query data
const { data, error } = await supabase
  .from('your_table')
  .select('*')

// Auth
const { data: { user } } = await supabase.auth.signUp({
  email: 'user@example.com',
  password: 'password',
})`}</pre>
        </div>
      )}

      {/* Resource allocation */}
      <div className="border rounded-xl p-5 bg-card">
        <h2 className="font-medium text-sm mb-4">Resource allocation</h2>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <p className="text-xs text-muted-foreground mb-1">Compute</p>
            <p className="font-medium text-sm">{project?.vcpuLimit ?? "—"} vCPU</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">Memory</p>
            <p className="font-medium text-sm">{project?.ramMbLimit ? `${project.ramMbLimit} MB` : "—"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">Storage</p>
            <p className="font-medium text-sm">{project?.storageGbLimit ? `${project.storageGbLimit} GB` : "—"}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
