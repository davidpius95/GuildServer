"use client";
import { useParams } from "next/navigation";
import { trpc } from "@/lib/trpc";

export default function FunctionsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const conn = trpc.baasProject.connectionInfo.useQuery({ projectId });
  const url  = conn.data?.projectUrl ?? "<project-url>";
  const anon = conn.data?.anonKey    ?? "<anon-key>";

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <div><h2 className="font-semibold text-lg">Edge Functions</h2><p className="text-sm text-muted-foreground">TypeScript/JavaScript functions served by the Deno edge runtime.</p></div>
      <div className="border rounded-xl p-5 space-y-3">
        <h3 className="font-medium text-sm">Deploy via Supabase CLI</h3>
        <pre className="bg-muted px-4 py-3 rounded-lg text-xs font-mono overflow-auto">{`# Install CLI
npm install -g supabase

# Create a function
supabase functions new hello-world

# Deploy to your GuildServer BaaS project
supabase functions deploy hello-world \\
  --project-ref ${projectId.slice(0,8)} \\
  --endpoint ${url}

# Invoke
curl -X POST '${url}/functions/v1/hello-world' \\
  -H 'Authorization: Bearer ${anon}'`}</pre>
      </div>
      <div className="border rounded-xl p-5 bg-muted/20 text-sm text-muted-foreground space-y-1">
        <p>Functions live in <code className="font-mono text-xs">/opt/baas/{"{slug}"}/volumes/functions/</code> on the compute node.</p>
        <p>Served by <code className="font-mono text-xs">supabase/edge-runtime:v1.74.0</code> at <code className="font-mono text-xs">{url}/functions/v1/</code></p>
      </div>
    </div>
  );
}
