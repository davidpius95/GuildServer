import { db } from "@guildserver/database";
import { projects, applications, databases, members } from "@guildserver/database";
import { eq, inArray } from "drizzle-orm";

export interface SecurityIssue {
  id: string;
  title: string;
  description: string;
  severity: "critical" | "high" | "medium" | "low";
  category: string;
  affectedResources: string[];
  discoveredAt: string;
  status: "open";
}

export interface SecurityPosture {
  score: number;
  totalIssues: number;
  criticalIssues: number;
  highIssues: number;
  mediumIssues: number;
  lowIssues: number;
  lastScan: string;
  categories: { name: string; score: number }[];
  issues: SecurityIssue[];
}

const PENALTY = { critical: 25, high: 15, medium: 7, low: 3 };

/**
 * Compute a real security posture by analysing the organisation's live
 * infrastructure (databases, applications, members) — no mock data.
 */
export async function computeSecurityPosture(organizationId: string): Promise<SecurityPosture> {
  const now = new Date().toISOString();
  const issues: SecurityIssue[] = [];

  const orgProjects = await db.query.projects.findMany({
    where: eq(projects.organizationId, organizationId),
    columns: { id: true },
  });
  const projectIds = orgProjects.map((p) => p.id);

  const [apps, dbs, mems] = await Promise.all([
    projectIds.length
      ? db.query.applications.findMany({ where: inArray(applications.projectId, projectIds) })
      : Promise.resolve([] as any[]),
    projectIds.length
      ? db.query.databases.findMany({ where: inArray(databases.projectId, projectIds) })
      : Promise.resolve([] as any[]),
    db.query.members.findMany({ where: eq(members.organizationId, organizationId) }),
  ]);

  // --- Data / database checks ---
  for (const d of dbs as any[]) {
    if (d.externalPort) {
      issues.push({
        id: `db-exposed-${d.id}`,
        title: "Database exposed on a public port",
        description: `Database "${d.name}" publishes port ${d.externalPort} to the host. Restrict access or use a private network.`,
        severity: "high",
        category: "Data",
        affectedResources: [d.name],
        discoveredAt: now,
        status: "open",
      });
    }
    if (typeof d.password === "string" && d.password.length < 12) {
      issues.push({
        id: `db-weakpw-${d.id}`,
        title: "Weak database password",
        description: `Database "${d.name}" uses a password shorter than 12 characters.`,
        severity: "high",
        category: "Data",
        affectedResources: [d.name],
        discoveredAt: now,
        status: "open",
      });
    }
    if (d.status && d.status !== "running") {
      issues.push({
        id: `db-down-${d.id}`,
        title: "Database not running",
        description: `Database "${d.name}" is in "${d.status}" state.`,
        severity: "medium",
        category: "Infrastructure",
        affectedResources: [d.name],
        discoveredAt: now,
        status: "open",
      });
    }
  }

  // --- Application checks ---
  for (const a of apps as any[]) {
    if (["failed", "error", "stopped"].includes(a.status)) {
      issues.push({
        id: `app-unhealthy-${a.id}`,
        title: "Application not healthy",
        description: `Application "${a.name}" is in "${a.status}" state.`,
        severity: "medium",
        category: "Application",
        affectedResources: [a.name],
        discoveredAt: now,
        status: "open",
      });
    }
  }

  // --- Identity checks ---
  const owners = (mems as any[]).filter((m) => m.role === "owner");
  if (owners.length === 0) {
    issues.push({
      id: "identity-no-owner",
      title: "No organization owner",
      description: "This organization has no owner account, which risks losing administrative access.",
      severity: "critical",
      category: "Identity",
      affectedResources: ["Organization"],
      discoveredAt: now,
      status: "open",
    });
  } else if (owners.length === 1) {
    issues.push({
      id: "identity-single-owner",
      title: "Single owner account (bus-factor risk)",
      description: "Only one owner exists. Add a second owner to avoid losing access.",
      severity: "low",
      category: "Identity",
      affectedResources: ["Organization"],
      discoveredAt: now,
      status: "open",
    });
  }

  const criticalIssues = issues.filter((i) => i.severity === "critical").length;
  const highIssues = issues.filter((i) => i.severity === "high").length;
  const mediumIssues = issues.filter((i) => i.severity === "medium").length;
  const lowIssues = issues.filter((i) => i.severity === "low").length;

  const penalty = issues.reduce((sum, i) => sum + PENALTY[i.severity], 0);
  const score = Math.max(0, Math.min(100, 100 - penalty));

  const categoryScore = (name: string) => {
    const catPenalty = issues
      .filter((i) => i.category === name)
      .reduce((s, i) => s + PENALTY[i.severity], 0);
    return Math.max(0, 100 - catPenalty);
  };

  return {
    score,
    totalIssues: issues.length,
    criticalIssues,
    highIssues,
    mediumIssues,
    lowIssues,
    lastScan: now,
    categories: [
      { name: "Infrastructure", score: categoryScore("Infrastructure") },
      { name: "Application", score: categoryScore("Application") },
      { name: "Data", score: categoryScore("Data") },
      { name: "Identity", score: categoryScore("Identity") },
    ],
    issues,
  };
}
