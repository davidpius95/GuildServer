"use client";
import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { trpc } from "@/lib/trpc";

interface TableRow { table_name: string }
interface Column   { column_name: string; data_type: string }

export default function TableEditorPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const conn = trpc.baasProject.connectionInfo.useQuery({ projectId });
  const [tables, setTables]   = useState<TableRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [columns, setColumns] = useState<Column[]>([]);
  const [rows,    setRows]    = useState<object[]>([]);
  const [loading, setLoading] = useState(false);

  const base = conn.data?.projectUrl;
  const key  = conn.data?.serviceRoleKey;
  const hdrs = { apikey: key ?? "", Authorization: `Bearer ${key}` };

  useEffect(() => {
    if (!base || !key) return;
    fetch(`${base}/pg/tables?schema=public`, { headers: hdrs })
      .then((r) => r.json()).then((d) => setTables(Array.isArray(d) ? d : [])).catch(() => {});
  }, [base, key]);

  const load = async (name: string) => {
    if (!base || !key) return;
    setLoading(true); setSelected(name);
    try {
      const [colRes, rowRes] = await Promise.all([
        fetch(`${base}/pg/columns?table=${name}&schema=public`, { headers: hdrs }),
        fetch(`${base}/rest/v1/${name}?select=*&limit=100`, { headers: { ...hdrs, Accept: "application/json", Prefer: "count=exact" } }),
      ]);
      setColumns(await colRes.json()); setRows(await rowRes.json());
    } finally { setLoading(false); }
  };

  return (
    <div className="flex h-full">
      <div className="w-48 border-r bg-card flex flex-col">
        <div className="px-3 py-3 border-b"><span className="text-xs font-medium text-muted-foreground uppercase">Tables</span></div>
        <div className="flex-1 overflow-y-auto py-1">
          {tables.map((t) => (
            <button key={t.table_name} onClick={() => load(t.table_name)}
              className={`w-full text-left px-3 py-2 text-sm transition-colors ${selected === t.table_name ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}>
              {t.table_name}
            </button>
          ))}
          {tables.length === 0 && <p className="px-3 py-4 text-xs text-muted-foreground">No tables</p>}
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        {!selected ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center space-y-2"><p className="text-3xl">▦</p><p className="text-sm text-muted-foreground">Select a table</p></div>
          </div>
        ) : loading ? <div className="p-6 text-sm text-muted-foreground animate-pulse">Loading…</div> : (
          <>
            <div className="px-4 py-2 border-b flex items-center justify-between bg-card sticky top-0">
              <span className="text-sm font-medium font-mono">{selected}</span>
              <span className="text-xs text-muted-foreground">{rows.length} rows</span>
            </div>
            <table className="w-full text-xs font-mono border-collapse">
              <thead className="bg-muted sticky top-10">
                <tr>{columns.map((c) => <th key={c.column_name} className="text-left px-3 py-2 border-b border-r text-muted-foreground font-medium whitespace-nowrap"><div>{c.column_name}</div><div className="opacity-60 font-normal">{c.data_type}</div></th>)}</tr>
              </thead>
              <tbody>
                {rows.map((row, i) => <tr key={i} className="hover:bg-muted/30">{Object.values(row as object).map((v, j) => <td key={j} className="px-3 py-1.5 border-b border-r max-w-xs truncate">{v === null ? <span className="text-muted-foreground italic">null</span> : String(v)}</td>)}</tr>)}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}
