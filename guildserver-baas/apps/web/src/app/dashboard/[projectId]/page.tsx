"use client";
import { useParams } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { toast } from "sonner";

function CopyField({ label, value }: { label: string; value?: string | null }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="flex items-center gap-2">
        <code className="flex-1 text-xs bg-muted px-3 py-2 rounded-lg font-mono truncate">{value}</code>
        <button onClick={() => { navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
          className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 border rounded">
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

export default function ProjectOverviewPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const query    = trpc.baasProject.get.useQuery({ projectId });
  const connInfo = trpc.baasProject.connectionInfo.useQuery({ projectId });
  const metricsQ = trpc.baasMetrics.latest.useQuery({ projectId, limit: 1 });

  const project = query.data;
  const conn    = connInfo.data;
  const latest  = metricsQ.data?.[0];

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <div>
        <h2 className="font-semibold text-lg">{project?.name ?? "Loading…"}</h2>
        <p className="text-sm text-muted-foreground font-mono">{project?.slug}</p>
      </div>

      {/* Status cards */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Status",   value: project?.status ?? "—" },
          { label: "RAM",      value: latest ? `${latest.ramMbUsed}MB` : `${project?.ramMbLimit ?? "—"}MB alloc` },
          { label: "CPU",      value: latest ? `${parseFloat(String(latest.cpuPercent ?? 0)).toFixed(1)}%` : "—" },
        ].map(({ label, value }) => (
          <div key={label} className="border rounded-xl p-4">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="font-semibold mt-1 capitalize">{value}</p>
          </div>
        ))}
      </div>

      {/* Connection info */}
      <div className="border rounded-xl p-4 space-y-3">
        <h3 className="font-medium text-sm">Connection details</h3>
        <CopyField label="Project URL"          value={conn?.projectUrl} />
        <CopyField label="Anon (public) key"    value={conn?.anonKey} />
        <CopyField label="Service role key"     value={conn?.serviceRoleKey} />
        <CopyField label="DB connection string" value={conn?.dbConnectionString} />
      </div>

      {/* Quick start */}
      <div className="border rounded-xl p-4 space-y-3">
        <h3 className="font-medium text-sm">Quick start</h3>
        <pre className="bg-muted text-xs p-4 rounded-lg font-mono overflow-auto">{`npm install @supabase/supabase-js

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  '${conn?.projectUrl ?? "<project-url>"}',
  '${conn?.anonKey    ?? "<anon-key>"}'
)

const { data, error } = await supabase.from('my_table').select()`}</pre>
      </div>

      {conn?.studioUrl && (
        <a href={conn.studioUrl} target="_blank" rel="noreferrer"
          className="inline-flex items-center gap-2 px-4 py-2 border rounded-lg text-sm hover:bg-muted transition-colors">
          Open Supabase Studio ↗
        </a>
      )}
    </div>
  );
}
