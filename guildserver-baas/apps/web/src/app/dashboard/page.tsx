"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

const STATUS_COLOR: Record<string, string> = {
  active:       "text-success",
  provisioning: "text-warning animate-pulse",
  paused:       "text-muted-foreground",
  error:        "text-destructive",
  deleting:     "text-destructive animate-pulse",
};

export default function DashboardPage() {
  const router = useRouter();
  const [orgId, setOrgId]       = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [name, setName]          = useState("");
  const [ramMb, setRamMb]        = useState(2048);

  const meQuery = trpc.auth.me.useQuery(undefined, { retry: false,
    onError: () => router.push("/auth/login") });

  // Derive orgId from membership — in a real app you'd store it in context
  useEffect(() => {
    if (meQuery.data) {
      // Org ID is returned via connectionInfo; for now we pass from localStorage
      const stored = localStorage.getItem("baas-org-id");
      if (stored) setOrgId(stored);
    }
  }, [meQuery.data]);

  const listQuery = trpc.baasProject.list.useQuery(
    { organizationId: orgId! },
    { enabled: !!orgId, refetchInterval: 10_000 }
  );

  const createMutation = trpc.baasProject.create.useMutation({
    onSuccess: () => { toast.success("Project created — provisioning…"); setShowModal(false); setName(""); listQuery.refetch(); },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="min-h-screen bg-background">
      {/* Top nav */}
      <header className="border-b px-6 py-3 flex items-center justify-between bg-card">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center text-primary-foreground font-bold text-sm">G</div>
          <span className="font-semibold text-sm">GuildServer BaaS</span>
        </div>
        <button onClick={() => setShowModal(true)}
          className="px-3 py-1.5 bg-primary text-primary-foreground text-xs font-medium rounded-lg hover:bg-primary/90">
          New project
        </button>
      </header>

      <main className="max-w-5xl mx-auto p-6 space-y-4">
        <h2 className="font-semibold">All projects</h2>

        {listQuery.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {listQuery.data?.map((p) => (
            <button key={p.id} onClick={() => router.push(`/dashboard/${p.id}`)}
              className="border rounded-xl p-4 text-left hover:border-primary/50 hover:bg-muted/20 transition-colors space-y-2">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium text-sm">{p.name}</p>
                  <p className="text-xs text-muted-foreground font-mono">{p.slug}</p>
                </div>
                <span className={`text-xs font-medium ${STATUS_COLOR[p.status ?? ""] ?? ""}`}>
                  {p.status}
                </span>
              </div>
              <div className="text-xs text-muted-foreground">
                {p.ramMbLimit ? `${p.ramMbLimit}MB RAM · ` : ""}{p.storageGbLimit ?? 8}GB storage
              </div>
            </button>
          ))}
        </div>

        {listQuery.data?.length === 0 && (
          <div className="border-2 border-dashed rounded-xl p-12 text-center space-y-3">
            <p className="text-3xl">▦</p>
            <p className="font-medium">No projects yet</p>
            <p className="text-sm text-muted-foreground">Create your first BaaS project to get started.</p>
            <button onClick={() => setShowModal(true)}
              className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90">
              Create project
            </button>
          </div>
        )}
      </main>

      {/* Create modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-card border rounded-xl w-full max-w-md p-6 space-y-4">
            <h3 className="font-semibold">New project</h3>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Project name</label>
              <input value={name} onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 text-sm border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/50" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">RAM allocation</label>
              <select value={ramMb} onChange={(e) => setRamMb(Number(e.target.value))}
                className="w-full px-3 py-2 text-sm border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/50">
                <option value={512}>512 MB (Micro)</option>
                <option value={1024}>1 GB (Small)</option>
                <option value={2048}>2 GB (Medium)</option>
                <option value={4096}>4 GB (Large)</option>
                <option value={8192}>8 GB (XL)</option>
              </select>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowModal(false)}
                className="px-4 py-2 text-sm border rounded-lg hover:bg-muted">Cancel</button>
              <button disabled={!name.trim() || !orgId || createMutation.isLoading}
                onClick={() => orgId && createMutation.mutate({ organizationId: orgId, name: name.trim(), ramMbLimit: ramMb })}
                className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 disabled:opacity-50">
                {createMutation.isLoading ? "Creating…" : "Create project"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
