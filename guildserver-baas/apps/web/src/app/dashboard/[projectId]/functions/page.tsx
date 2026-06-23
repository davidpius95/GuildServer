"use client";
import { useParams } from "next/navigation";
import { trpc } from "@/lib/trpc";

export default function FunctionsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const conn = trpc.baasProject.connectionInfo.useQuery({ projectId });
  const studioUrl = conn.data?.studioUrl;
  const url  = conn.data?.projectUrl ?? "<project-url>";
  const anon = conn.data?.anonKey    ?? "<anon-key>";

  if (conn.isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <div>
        <h2 className="font-semibold text-lg">Edge Functions</h2>
        <p className="text-sm text-muted-foreground mt-1">
          TypeScript/JavaScript functions served by the Deno edge runtime.
        </p>
      </div>

      {studioUrl && (
        <a
          href={`${studioUrl}/project/default/functions`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors"
        >
          Manage Functions in Studio ↗
        </a>
      )}

      <div className="border rounded-xl p-5 space-y-3">
        <h3 className="font-medium text-sm">Deploy via Supabase CLI</h3>
        <pre className="bg-muted px-4 py-3 rounded-lg text-xs font-mono overflow-auto leading-relaxed">{`# Install CLI
npm install -g supabase

# Create a function
supabase functions new hello-world

# Deploy to your GuildServer BaaS project
supabase functions deploy hello-world \\
  --project-ref ${projectId.slice(0, 8)} \\
  --endpoint ${url}

# Invoke
curl -X POST '${url}/functions/v1/hello-world' \\
  -H 'Authorization: Bearer ${anon}'`}</pre>
      </div>
    </div>
  );
}
