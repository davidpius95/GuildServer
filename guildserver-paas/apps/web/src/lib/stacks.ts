import type { EnvVarEntry } from "@/components/env-var-editor"

export const EXAMPLE_COMPOSE = `services:
  web:
    image: nginx:alpine
    ports:
      - "80"
`

export function envToEntries(environment: unknown): EnvVarEntry[] {
  if (!environment || typeof environment !== "object") return []
  return Object.entries(environment as Record<string, unknown>).map(([key, value]) => ({ key, value: String(value ?? "") }))
}

export function entriesToEnv(entries: EnvVarEntry[]): Record<string, string> {
  return Object.fromEntries(entries.filter((entry) => entry.key.trim()).map((entry) => [entry.key.trim(), entry.value]))
}

/** "a.example.com, b.example.com" → ["a.example.com", "b.example.com"], lowercased and de-duplicated. */
export function parseDomainList(text: string): string[] {
  return Array.from(new Set(text.split(/[\s,]+/).map((d) => d.trim().toLowerCase()).filter(Boolean)))
}

/** tRPC BAD_REQUEST messages from the stack router list real Compose problems; show those verbatim. */
export function stackErrorMessage(error: unknown, fallback: (e: unknown) => string): string {
  const err = error as { message?: string; data?: { code?: string } } | null
  return err?.data?.code === "BAD_REQUEST" && err.message ? err.message : fallback(error)
}
