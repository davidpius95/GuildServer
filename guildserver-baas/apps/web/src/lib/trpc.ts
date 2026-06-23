"use client";
import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink } from "@trpc/client";
import type { AppRouter } from "@guildserver/baas-api";

export const trpc = createTRPCReact<AppRouter>();

export function getToken() {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("baas-token") ?? "";
}

export function setToken(token: string) {
  localStorage.setItem("baas-token", token);
}

export function clearToken() {
  localStorage.removeItem("baas-token");
}

export function makeTrpcClient() {
  return trpc.createClient({
    links: [
      httpBatchLink({
        url: `${process.env.NEXT_PUBLIC_BAAS_API_URL}/trpc`,
        headers: () => ({ Authorization: `Bearer ${getToken()}` }),
      }),
    ],
  });
}
