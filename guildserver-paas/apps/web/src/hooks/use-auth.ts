"use client"

import { useEffect, useState, useMemo, useCallback } from "react"
import { useRouter } from "next/navigation"
import { trpc } from "@/components/trpc-provider"

// Validate UUID format to prevent invalid API calls
const isValidUUID = (s: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)

// Read token synchronously to avoid extra render cycle
function getToken() {
  if (typeof window === "undefined") return null
  return localStorage.getItem("guildserver-token")
}

export function useAuth(options?: { redirect?: boolean }) {
  const router = useRouter()
  const redirect = options?.redirect ?? true
  // Initialize token synchronously from localStorage — no useEffect delay
  const [token, setToken] = useState<string | null>(getToken)
  const isReady = typeof window !== "undefined"

  useEffect(() => {
    // Re-check on mount in case token changed between SSR and hydration
    const t = getToken()
    if (t !== token) setToken(t)
    if (!t && redirect) {
      router.replace("/auth/login")
    }
  }, [redirect, router, token])

  const logout = useCallback(() => {
    localStorage.removeItem("guildserver-token")
    setToken(null)
    router.push("/auth/login")
  }, [router])

  return {
    token,
    isAuthenticated: !!token,
    isReady,
    logout,
  }
}

export function useCurrentUser() {
  const { isReady, isAuthenticated } = useAuth({ redirect: false })

  const meQuery = trpc.auth.me.useQuery(undefined, {
    enabled: isReady && isAuthenticated,
    staleTime: 10 * 60 * 1000, // Cache for 10 minutes — user data rarely changes
    cacheTime: 30 * 60 * 1000, // Keep in cache for 30 minutes
    refetchOnWindowFocus: false,
  })

  return {
    user: meQuery.data ?? null,
    isAdmin: meQuery.data?.role === "admin",
    isLoading: meQuery.isLoading,
  }
}

export function useOrganization() {
  const { isReady, isAuthenticated } = useAuth()

  const orgsQuery = trpc.organization.list.useQuery(undefined, {
    enabled: isReady && isAuthenticated,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes — orgs change infrequently
    cacheTime: 15 * 60 * 1000,
    refetchOnWindowFocus: false,
  })

  const currentOrg = orgsQuery.data?.[0] ?? null

  return {
    organizations: orgsQuery.data ?? [],
    currentOrg,
    isLoading: orgsQuery.isLoading,
    orgId: currentOrg?.id ?? "",
  }
}

export function useProjects(organizationId: string) {
  const projectsQuery = trpc.project.list.useQuery(
    { organizationId },
    {
      enabled: isValidUUID(organizationId),
      staleTime: 5 * 60 * 1000,
      cacheTime: 15 * 60 * 1000,
    }
  )

  return {
    projects: projectsQuery.data ?? [],
    isLoading: projectsQuery.isLoading,
    currentProject: projectsQuery.data?.[0] ?? null,
    projectId: projectsQuery.data?.[0]?.id ?? "",
  }
}
