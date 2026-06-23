"use client";
import { useState } from "react";
import { useParams } from "next/navigation";
import { trpc } from "@/lib/trpc";

const RANGES = [
  { label: "1h",  hours: 1 },
  { label: "6h",  hours: 6 },
  { label: "24h", hours: 24 },
  { label: "7d",  hours: 168 },
];

function Sparkline({ values, color = "stroke-primary" }: { values: number[]; color?: string }) {
  if (values.length < 2) return <div className="h-14 flex items-center justify-center text-xs text-muted-foreground">No data</div>;
  const max  = Math.max(...values, 1);
  const w    = 260;
  const h    = 56;
  const pts  = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - (v / max) * h}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-14">
      <polyline fill="none" className={color} strokeWidth="2" points={pts} />
    </svg>
  );
}

function StatCard({ title, value, unit, sparkValues, color }: { title: string; value: string | number; unit: string; sparkValues: number[]; color?: string }) {
  return (
    <div className="border rounded-xl p-4 space-y-2">
      <p className="text-xs text-muted-foreground">{title}</p>
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-semibold">{value}</span>
        <span className="text-xs text-muted-foreground">{unit}</span>
      </div>
      <Sparkline values={sparkValues} color={color} />
    </div>
  );
}

export default function MetricsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [range, setRange] = useState(RANGES[1]);

  const from = new Date(Date.now() - range.hours * 3600 * 1000).toISOString();
  const query = trpc.baasMetrics.range.useQuery(
    { projectId, from },
    { refetchInterval: 60_000 }
  );

  const rows = query.data ?? [];

  const cpuVals      = rows.map((r) => parseFloat(String(r.cpuPercent   ?? 0)));
  const ramVals      = rows.map((r) => r.ramMbUsed   ?? 0);
  const connVals     = rows.map((r) => r.activeConnections ?? 0);
  const storageVals  = rows.map((r) => parseFloat(String(r.storageGbUsed ?? 0)));
  const txVals       = rows.map((r) => (r.txCommitted ?? 0));

  const latest = rows[rows.length - 1];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-lg">Metrics</h2>
          <p className="text-sm text-muted-foreground">Collected every 2 minutes from docker stats + pg_stat_database</p>
        </div>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button key={r.label} onClick={() => setRange(r)}
              className={`px-2.5 py-1 text-xs rounded-lg transition-colors ${range.label === r.label ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground"}`}>
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {query.isLoading && <p className="text-sm text-muted-foreground animate-pulse">Loading metrics…</p>}

      {rows.length === 0 && !query.isLoading && (
        <div className="border-2 border-dashed rounded-xl p-10 text-center text-sm text-muted-foreground">
          No metrics collected yet — data appears after the first 2-minute collection cycle.
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard title="CPU Usage"     value={latest ? parseFloat(String(latest.cpuPercent ?? 0)).toFixed(1) : "—"} unit="%" sparkValues={cpuVals} color="stroke-primary" />
        <StatCard title="RAM Used"      value={latest?.ramMbUsed ?? "—"} unit="MB" sparkValues={ramVals} color="stroke-blue-500" />
        <StatCard title="Connections"   value={latest?.activeConnections ?? "—"} unit="active" sparkValues={connVals} color="stroke-green-500" />
        <StatCard title="Storage Used"  value={latest ? parseFloat(String(latest.storageGbUsed ?? 0)).toFixed(2) : "—"} unit="GB" sparkValues={storageVals} color="stroke-orange-400" />
        <StatCard title="Transactions"  value={latest?.txCommitted ?? "—"} unit="committed" sparkValues={txVals} color="stroke-purple-400" />
        <StatCard title="DB Size"       value={latest ? parseFloat(String(latest.dbSizeMb ?? 0)).toFixed(1) : "—"} unit="MB" sparkValues={rows.map((r) => parseFloat(String(r.dbSizeMb ?? 0)))} color="stroke-yellow-400" />
      </div>

      {rows.length > 0 && (
        <div className="border rounded-xl overflow-auto">
          <table className="w-full text-xs font-mono">
            <thead className="bg-muted/50">
              <tr className="border-b">
                {["Time","CPU %","RAM MB","Connections","DB Size MB","TX Committed"].map((h) => (
                  <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...rows].reverse().slice(0, 50).map((r, i) => (
                <tr key={i} className="border-b hover:bg-muted/20">
                  <td className="px-3 py-1.5 text-muted-foreground">{new Date(r.collectedAt!).toLocaleTimeString()}</td>
                  <td className="px-3 py-1.5">{parseFloat(String(r.cpuPercent ?? 0)).toFixed(1)}%</td>
                  <td className="px-3 py-1.5">{r.ramMbUsed}</td>
                  <td className="px-3 py-1.5">{r.activeConnections}</td>
                  <td className="px-3 py-1.5">{parseFloat(String(r.dbSizeMb ?? 0)).toFixed(1)}</td>
                  <td className="px-3 py-1.5">{r.txCommitted}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
