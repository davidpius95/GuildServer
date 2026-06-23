"use client";
import { useState } from "react";
import { useParams } from "next/navigation";
import { trpc } from "@/lib/trpc";

function RevealField({ label, description, value }: { label: string; description: string; value?: string | null }) {
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  const display = show ? value : value.slice(0, 20) + "…";
  return (
    <div className="border rounded-xl p-4 space-y-2">
      <div><p className="font-medium text-sm">{label}</p><p className="text-xs text-muted-foreground">{description}</p></div>
      <div className="flex items-center gap-2">
        <code className="flex-1 text-xs bg-muted px-3 py-2 rounded-lg font-mono break-all">{display}</code>
        <button onClick={() => setShow((s) => !s)} className="text-xs border px-2 py-1 rounded hover:bg-muted">{show ? "Hide" : "Show"}</button>
        <button onClick={() => { navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
          className="text-xs border px-2 py-1 rounded hover:bg-muted">{copied ? "Copied" : "Copy"}</button>
      </div>
    </div>
  );
}

export default function ApiKeysPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const conn = trpc.baasProject.connectionInfo.useQuery({ projectId });
  const d    = conn.data;
  return (
    <div className="p-6 space-y-4 max-w-2xl">
      <div><h2 className="font-semibold text-lg">API Keys</h2><p className="text-sm text-muted-foreground">Use these in your client and server-side code.</p></div>
      <RevealField label="Project URL"      description="The base URL for all API calls."                value={d?.projectUrl} />
      <RevealField label="Anon (public) key" description="Safe to use in browsers and mobile apps."       value={d?.anonKey} />
      <RevealField label="Service role key" description="Bypasses RLS — use only in server-side code."   value={d?.serviceRoleKey} />
      <RevealField label="DB connection"    description="Direct Postgres connection via Supavisor."      value={d?.dbConnectionString} />
    </div>
  );
}
