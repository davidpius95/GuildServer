"use client";
import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { setToken } from "@/lib/trpc";

function CallbackContent() {
  const router = useRouter();
  const params = useSearchParams();
  useEffect(() => {
    const token = params.get("token");
    if (token) { setToken(token); router.replace("/dashboard"); }
    else router.replace("/auth/login");
  }, [params, router]);
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full" />
    </div>
  );
}

export default function CallbackPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full" /></div>}>
      <CallbackContent />
    </Suspense>
  );
}
