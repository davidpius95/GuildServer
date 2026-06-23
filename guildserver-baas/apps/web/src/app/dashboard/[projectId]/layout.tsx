"use client";
import { useParams, usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { trpc } from "@/lib/trpc";

const NAV = [
  { href: "",           label: "Overview",      icon: "⬡" },
  { href: "/editor",    label: "Table Editor",  icon: "▦" },
  { href: "/sql",       label: "SQL Editor",    icon: "◈" },
  { href: "/auth-users",label: "Auth / Users",  icon: "◉" },
  { href: "/storage",   label: "Storage",       icon: "◫" },
  { href: "/functions", label: "Edge Functions",icon: "⚡" },
  { href: "/logs",      label: "Logs",          icon: "≡" },
  { href: "/metrics",   label: "Metrics",       icon: "◎" },
  { href: "/api-keys",  label: "API Keys",      icon: "⬡" },
  { href: "/settings",  label: "Settings",      icon: "⚙" },
];

export default function ProjectLayout({ children }: { children: React.ReactNode }) {
  const { projectId } = useParams<{ projectId: string }>();
  const pathname = usePathname();
  const router   = useRouter();

  const query = trpc.baasProject.get.useQuery({ projectId }, { retry: false });
  const pause = trpc.baasProject.pause.useMutation();
  const wake  = trpc.baasProject.wake.useMutation({
    onSuccess: () => query.refetch(),
  });

  const project = query.data;
  const base    = `/dashboard/${projectId}`;

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Sidebar */}
      <aside className="w-52 border-r bg-card flex flex-col flex-shrink-0">
        {/* Back + project name */}
        <div className="px-3 py-3 border-b">
          <button onClick={() => router.push("/dashboard")}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 mb-2">
            ← All projects
          </button>
          <p className="font-semibold text-sm truncate">{project?.name ?? "Loading…"}</p>
          <div className="flex items-center gap-1.5 mt-1">
            <span className={`w-1.5 h-1.5 rounded-full ${project?.status === "active" ? "bg-success" : project?.status === "paused" ? "bg-muted-foreground" : "bg-warning"}`} />
            <span className="text-xs text-muted-foreground capitalize">{project?.status ?? "…"}</span>
          </div>
        </div>

        {/* Nav items */}
        <nav className="flex-1 overflow-y-auto py-1">
          {NAV.map(({ href, label, icon }) => {
            const to      = `${base}${href}`;
            const isActive = href === "" ? pathname === base : pathname.startsWith(to);
            return (
              <Link key={href} href={to}
                className={`flex items-center gap-2.5 px-3 py-2 text-sm transition-colors ${
                  isActive ? "text-foreground bg-accent" : "text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}>
                <span className="text-xs w-4 text-center">{icon}</span>
                {label}
              </Link>
            );
          })}
        </nav>

        {/* Pause / wake control */}
        <div className="p-3 border-t space-y-2">
          <button onClick={() => {
            localStorage.setItem("guildserver-preferred-product", "paas");
            window.location.href = "/dashboard";
          }}
            className="w-full text-xs py-1.5 border border-primary/20 bg-primary/5 rounded-lg hover:bg-primary/10 text-primary transition-colors">
            Switch to PaaS
          </button>
          {project?.status === "active" ? (
            <button onClick={() => pause.mutate({ projectId })} disabled={pause.isLoading}
              className="w-full text-xs py-1.5 border rounded-lg hover:bg-muted disabled:opacity-50 text-muted-foreground">
              Pause project
            </button>
          ) : project?.status === "paused" ? (
            <button onClick={() => wake.mutate({ projectId })} disabled={wake.isLoading}
              className="w-full text-xs py-1.5 border border-primary/50 rounded-lg hover:bg-primary/10 text-primary disabled:opacity-50">
              {wake.isLoading ? "Waking…" : "Wake project"}
            </button>
          ) : null}
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}
