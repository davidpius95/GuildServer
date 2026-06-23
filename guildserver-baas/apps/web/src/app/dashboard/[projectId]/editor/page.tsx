"use client";
import { useParams } from "next/navigation";
import { trpc } from "@/lib/trpc";

export default function TableEditorPage() {
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
        <h2 className="font-semibold text-lg">Table Editor</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Open the Supabase Studio Table Editor to create, browse, and edit your tables.
        </p>
      </div>
      <a
        href={`${studioUrl}/project/default/editor`}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors"
      >
        Open Table Editor in Studio ↗
      </a>
    </div>
  );
}
