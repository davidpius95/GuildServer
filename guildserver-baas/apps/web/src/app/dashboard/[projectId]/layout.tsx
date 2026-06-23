"use client";
import { useParams, usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { trpc } from "@/lib/trpc";

// Nav items that live inside the GuildServer management shell
const SHELL_NAV = [
  { href: "",          label: "Home",     icon: "⬡", section: "main" },
  { href: "/metrics",  label: "Reports",  icon: "◎", section: "main" },
  { href: "/logs",     label: "Logs",     icon: "≡", section: "main" },
  { href: "/api-keys", label: "API Docs", icon: "◈", section: "main" },
];

// Nav items that open the real Supabase Studio
const STUDIO_NAV: {
  label: string; icon: string; path: string;
  children?: { label: string; path: string }[];
}[] = [
  { label: "Table Editor",  icon: "▦", path: "/project/default/editor" },
  { label: "SQL Editor",    icon: "◈", path: "/project/default/sql" },
  {
    label: "Database", icon: "◫", path: "/project/default/database/tables",
    children: [
      { label: "Tables",            path: "/project/default/database/tables" },
      { label: "Views",             path: "/project/default/database/views" },
      { label: "Functions",         path: "/project/default/database/functions" },
      { label: "Triggers",          path: "/project/default/database/triggers" },
      { label: "Extensions",        path: "/project/default/database/extensions" },
      { label: "Roles",             path: "/project/default/database/roles" },
      { label: "Replication",       path: "/project/default/database/replication" },
      { label: "Column Encryption", path: "/project/default/database/column-encryption" },
    ],
  },
  {
    label: "Auth", icon: "◉", path: "/project/default/auth/users",
    children: [
      { label: "Users",             path: "/project/default/auth/users" },
      { label: "Providers",         path: "/project/default/auth/providers" },
      { label: "URL Configuration", path: "/project/default/auth/url-configuration" },
      { label: "Email Templates",   path: "/project/default/auth/templates" },
      { label: "Rate Limits",       path: "/project/default/auth/rate-limits" },
      { label: "Hooks",             path: "/project/default/auth/hooks" },
    ],
  },
  {
    label: "Storage", icon: "◫", path: "/project/default/storage/buckets",
    children: [
      { label: "Buckets",  path: "/project/default/storage/buckets" },
      { label: "Policies", path: "/project/default/storage/policies" },
    ],
  },
  { label: "Edge Functions", icon: "⚡", path: "/project/default/functions" },
  {
    label: "Realtime", icon: "⬤", path: "/project/default/realtime/inspector",
    children: [
      { label: "Inspector", path: "/project/default/realtime/inspector" },
      { label: "Schemas",   path: "/project/default/realtime/schemas" },
    ],
  },
];

export default function ProjectLayout({ children }: { children: React.ReactNode }) {
  const { projectId } = useParams<{ projectId: string }>();
  const pathname = usePathname();
  const router   = useRouter();

  const query = trpc.baasProject.get.useQuery({ projectId }, { retry: false });
  const conn  = trpc.baasProject.connectionInfo.useQuery({ projectId }, { retry: false });
  const pause = trpc.baasProject.pause.useMutation();
  const wake  = trpc.baasProject.wake.useMutation({ onSuccess: () => query.refetch() });

  const project   = query.data;
  const studioUrl = conn.data?.studioUrl ?? "";
  const base      = `/dashboard/${projectId}`;

  const isActive = (href: string) =>
    href === "" ? pathname === base : pathname.startsWith(`${base}${href}`);

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* ── Sidebar ── */}
      <aside className="w-56 border-r bg-card flex flex-col flex-shrink-0 text-sm">

        {/* Project header */}
        <div className="px-3 pt-3 pb-2 border-b">
          <button
            onClick={() => router.push("/dashboard")}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-2"
          >
            ← All projects
          </button>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-6 h-6 rounded bg-primary/10 flex items-center justify-center text-primary font-bold text-xs shrink-0">
              {(project?.name ?? "?")[0].toUpperCase()}
            </div>
            <p className="font-semibold truncate">{project?.name ?? "Loading…"}</p>
          </div>
          <div className="flex items-center gap-1.5 pl-8">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
              project?.status === "active"       ? "bg-green-500" :
              project?.status === "paused"       ? "bg-zinc-400" :
              project?.status === "provisioning" ? "bg-amber-500 animate-pulse" :
              project?.status === "error"        ? "bg-red-500" : "bg-zinc-300"
            }`} />
            <span className="text-xs text-muted-foreground capitalize">{project?.status ?? "…"}</span>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-2 space-y-0.5 px-1">

          {/* Shell-managed pages */}
          {SHELL_NAV.map(({ href, label, icon }) => (
            <Link
              key={href}
              href={`${base}${href}`}
              className={`flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors ${
                isActive(href)
                  ? "bg-accent text-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              <span className="text-[11px] w-3.5 text-center">{icon}</span>
              {label}
            </Link>
          ))}

          {/* Studio section */}
          {studioUrl ? (
            <>
              <div className="pt-3 pb-1 px-2">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
                  Supabase Studio
                </p>
              </div>

              {STUDIO_NAV.map(({ label, icon, path, children }) => (
                <div key={label}>
                  <a
                    href={`${studioUrl}${path}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 px-2 py-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  >
                    <span className="text-[11px] w-3.5 text-center">{icon}</span>
                    {label}
                    <span className="ml-auto text-[9px] opacity-30">↗</span>
                  </a>
                  {children && (
                    <div className="ml-5 mt-0.5 space-y-0.5">
                      {children.map((child) => (
                        <a
                          key={child.label}
                          href={`${studioUrl}${child.path}`}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center px-2 py-1 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                        >
                          {child.label}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </>
          ) : project?.status === "provisioning" ? (
            <div className="pt-3 px-3">
              <p className="text-xs text-muted-foreground/60 italic">
                Studio available after provisioning…
              </p>
            </div>
          ) : null}
        </nav>

        {/* Bottom controls */}
        <div className="p-2 border-t space-y-1">
          <Link
            href={`${base}/settings`}
            className={`flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors w-full ${
              isActive("/settings")
                ? "bg-accent text-foreground font-medium"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
          >
            <span className="text-[11px] w-3.5 text-center">⚙</span>
            Settings
          </Link>
          <button
            onClick={() => {
              localStorage.setItem("guildserver-preferred-product", "paas");
              window.location.href = "/dashboard";
            }}
            className="w-full text-xs py-1.5 border border-primary/20 bg-primary/5 rounded-lg hover:bg-primary/10 text-primary transition-colors"
          >
            ← Back to PaaS
          </button>
          {project?.status === "active" && (
            <button
              onClick={() => pause.mutate({ projectId })}
              disabled={pause.isLoading}
              className="w-full text-xs py-1.5 border rounded-lg hover:bg-muted disabled:opacity-50 text-muted-foreground"
            >
              Pause project
            </button>
          )}
          {project?.status === "paused" && (
            <button
              onClick={() => wake.mutate({ projectId })}
              disabled={wake.isLoading}
              className="w-full text-xs py-1.5 border border-primary/50 rounded-lg hover:bg-primary/10 text-primary disabled:opacity-50"
            >
              {wake.isLoading ? "Waking…" : "Resume project"}
            </button>
          )}
        </div>
      </aside>

      {/* ── Main content ── */}
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}
