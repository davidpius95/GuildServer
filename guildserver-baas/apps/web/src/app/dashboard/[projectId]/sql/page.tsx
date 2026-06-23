"use client";
import { useState } from "react";
import { useParams } from "next/navigation";
import { trpc } from "@/lib/trpc";

export default function SqlEditorPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const conn = trpc.baasProject.connectionInfo.useQuery({ projectId });
  const [sql,     setSql]     = useState("SELECT version();");
  const [result,  setResult]  = useState<object[] | null>(null);
  const [error,   setError]   = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const run = async () => {
    if (!conn.data?.projectUrl || !conn.data.serviceRoleKey) return;
    setRunning(true); setError(null); setResult(null);
    try {
      const res = await fetch(`${conn.data.projectUrl}/pg/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: conn.data.serviceRoleKey, Authorization: `Bearer ${conn.data.serviceRoleKey}` },
        body: JSON.stringify({ query: sql }),
      });
      const json = await res.json();
      if (!res.ok) setError(json.message ?? JSON.stringify(json));
      else setResult(Array.isArray(json) ? json : json.rows ?? [json]);
    } catch (e) { setError(String(e)); }
    finally { setRunning(false); }
  };

  const cols = result?.[0] ? Object.keys(result[0]) : [];

  return (
    <div className="flex flex-col h-full">
      <div className="border-b px-4 py-2 flex gap-2 items-center bg-card">
        <span className="text-sm font-medium">SQL Editor</span>
        <button onClick={run} disabled={running}
          className="ml-auto px-3 py-1 bg-primary text-primary-foreground text-xs font-medium rounded-lg hover:bg-primary/90 disabled:opacity-50">
          {running ? "Running…" : "▶ Run"}
        </button>
      </div>
      <textarea value={sql} onChange={(e) => setSql(e.target.value)}
        className="flex-1 font-mono text-xs p-4 bg-background resize-none focus:outline-none border-b"
        style={{ minHeight: 180 }} />
      <div className="flex-1 overflow-auto">
        {error && <div className="p-4 text-sm text-destructive font-mono bg-destructive/5">{error}</div>}
        {result && result.length === 0 && <div className="p-4 text-sm text-muted-foreground">Query returned 0 rows</div>}
        {result && cols.length > 0 && (
          <table className="w-full text-xs font-mono border-collapse">
            <thead className="bg-muted sticky top-0">
              <tr>{cols.map((c) => <th key={c} className="text-left px-3 py-2 border-b border-r text-muted-foreground font-medium">{c}</th>)}</tr>
            </thead>
            <tbody>
              {result.map((row, i) => <tr key={i} className="hover:bg-muted/20">
                {cols.map((c) => { const v = (row as Record<string, unknown>)[c]; return <td key={c} className="px-3 py-1.5 border-b border-r max-w-xs truncate">{v === null ? <span className="opacity-40 italic">null</span> : String(v)}</td>; })}
              </tr>)}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
