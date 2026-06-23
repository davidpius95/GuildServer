"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { trpc } from "@/lib/trpc";

interface GoTrueUser { id: string; email: string; created_at: string; last_sign_in_at?: string; email_confirmed_at?: string }

export default function AuthUsersPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const conn = trpc.baasProject.connectionInfo.useQuery({ projectId });
  const [users, setUsers]   = useState<GoTrueUser[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!conn.data?.projectUrl || !conn.data.serviceRoleKey) return;
    setLoading(true);
    fetch(`${conn.data.projectUrl}/auth/v1/admin/users`, {
      headers: { apikey: conn.data.serviceRoleKey, Authorization: `Bearer ${conn.data.serviceRoleKey}` },
    }).then((r) => r.json()).then((d) => setUsers(d.users ?? [])).catch(() => {}).finally(() => setLoading(false));
  }, [conn.data]);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div><h2 className="font-semibold text-lg">Auth / Users</h2><p className="text-sm text-muted-foreground">{users.length} user(s) — powered by GoTrue</p></div>
      </div>
      {loading && <p className="text-sm text-muted-foreground animate-pulse">Loading…</p>}
      <div className="border rounded-xl overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 border-b">
            <tr>{["Email","Created","Last Sign-in","Verified"].map((h) => <th key={h} className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">{h}</th>)}</tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b hover:bg-muted/20">
                <td className="px-4 py-2.5">{u.email}</td>
                <td className="px-4 py-2.5 text-muted-foreground text-xs">{new Date(u.created_at).toLocaleDateString()}</td>
                <td className="px-4 py-2.5 text-muted-foreground text-xs">{u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleString() : "—"}</td>
                <td className="px-4 py-2.5"><span className={`text-xs px-2 py-0.5 rounded-full ${u.email_confirmed_at ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}`}>{u.email_confirmed_at ? "Yes" : "No"}</span></td>
              </tr>
            ))}
            {users.length === 0 && !loading && <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-muted-foreground">No users yet</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
