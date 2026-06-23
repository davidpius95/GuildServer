"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { trpc, setToken } from "@/lib/trpc";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState("");

  const login = trpc.auth.login.useMutation({
    onSuccess: (data) => { setToken(data.token); router.push("/dashboard"); },
    onError:   (err)  => setError(err.message),
  });

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-1">
          <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-primary text-primary-foreground font-bold text-lg mb-2">G</div>
          <h1 className="text-2xl font-bold">Sign in to BaaS</h1>
          <p className="text-sm text-muted-foreground">GuildServer Backend-as-a-Service</p>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); setError(""); login.mutate({ email, password }); }} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
              className="w-full px-3 py-2 text-sm border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/50" />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
              className="w-full px-3 py-2 text-sm border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/50" />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <button type="submit" disabled={login.isLoading}
            className="w-full py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 disabled:opacity-50">
            {login.isLoading ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <p className="text-center text-sm text-muted-foreground">
          No account? <Link href="/auth/register" className="text-primary hover:underline font-medium">Create one</Link>
        </p>
        <p className="text-center text-sm text-muted-foreground">
          Looking for PaaS?{" "}
          <a href={process.env.NEXT_PUBLIC_PAAS_WEB_URL} className="text-primary hover:underline font-medium">GuildServer PaaS →</a>
        </p>
      </div>
    </div>
  );
}
