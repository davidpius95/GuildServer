"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { trpc } from "@/lib/trpc";

interface Bucket { id: string; name: string; public: boolean }
interface StorageObject { name: string; metadata?: { size?: number; mimetype?: string } }

export default function StoragePage() {
  const { projectId } = useParams<{ projectId: string }>();
  const conn = trpc.baasProject.connectionInfo.useQuery({ projectId });
  const [buckets, setBuckets]   = useState<Bucket[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [objects, setObjects]   = useState<StorageObject[]>([]);

  const base = conn.data?.projectUrl;
  const key  = conn.data?.serviceRoleKey;
  const hdrs = { apikey: key ?? "", Authorization: `Bearer ${key}` };

  useEffect(() => {
    if (!base || !key) return;
    fetch(`${base}/storage/v1/bucket`, { headers: hdrs }).then((r) => r.json()).then((d) => setBuckets(Array.isArray(d) ? d : [])).catch(() => {});
  }, [base, key]);

  const loadBucket = (id: string) => {
    if (!base || !key) return;
    setSelected(id);
    fetch(`${base}/storage/v1/object/list/${id}`, { method: "POST", headers: { ...hdrs, "Content-Type": "application/json" }, body: JSON.stringify({ limit: 100, offset: 0 }) })
      .then((r) => r.json()).then((d) => setObjects(Array.isArray(d) ? d : [])).catch(() => {});
  };

  return (
    <div className="flex h-full">
      <div className="w-48 border-r bg-card flex flex-col">
        <div className="px-3 py-3 border-b"><span className="text-xs font-medium text-muted-foreground uppercase">Buckets</span></div>
        <div className="flex-1 overflow-y-auto py-1">
          {buckets.map((b) => (
            <button key={b.id} onClick={() => loadBucket(b.id)}
              className={`w-full text-left px-3 py-2 text-sm transition-colors ${selected === b.id ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}>
              <div>{b.name}</div>
              <div className="text-xs opacity-60">{b.public ? "public" : "private"}</div>
            </button>
          ))}
          {buckets.length === 0 && <p className="px-3 py-4 text-xs text-muted-foreground">No buckets</p>}
        </div>
      </div>
      <div className="flex-1 overflow-auto p-4">
        {!selected ? (
          <div className="h-full flex items-center justify-center"><div className="text-center space-y-2"><p className="text-3xl">◫</p><p className="text-sm text-muted-foreground">Select a bucket</p></div></div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {objects.map((o) => (
              <div key={o.name} className="border rounded-lg p-3 text-xs space-y-1">
                <p className="font-mono truncate">{o.name}</p>
                {o.metadata?.size && <p className="text-muted-foreground">{(o.metadata.size / 1024).toFixed(1)} KB</p>}
                {o.metadata?.mimetype && <p className="text-muted-foreground">{o.metadata.mimetype}</p>}
              </div>
            ))}
            {objects.length === 0 && <p className="text-sm text-muted-foreground col-span-4">Bucket is empty</p>}
          </div>
        )}
      </div>
    </div>
  );
}
