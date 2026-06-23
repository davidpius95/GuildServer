"use client";
import { useParams } from "next/navigation";
import { trpc } from "@/lib/trpc";

export default function SqlEditorPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const conn = trpc.baasProject.connectionInfo.useQuery({ projectId });
  const studioUrl = conn.data?.studioUrl;

  if (conn.isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;

  if (!studioUrl) return (
    <div className="p-6 text-sm text-muted-foreground">
      Studio not available yet — project may still be provisioning.
    </div>
  );

  return (
    <div className="p-6 space-y-4 max-w-lg">
      <div>
        <h2 className="font-semibold text-lg">SQL Editor</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Run SQL queries, create saved snippets, and explore your schema in the Studio.
        </p>
      </div>
      <a
        href={`${studioUrl}/project/default/sql`}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors"
      >
        Open SQL Editor in Studio ↗
      </a>
    </div>
  );
}
