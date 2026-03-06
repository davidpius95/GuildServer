"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { trpc } from "@/components/trpc-provider"

// Validate UUID format to prevent invalid API calls
const isValidUUID = (s: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)

export function useAuth(options?: { redirect?: boolean }) {
  const router = useRouter()
  const redirect = options?.redirect ?? true
  const [token, setToken] = useState<string | null>(null)
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    const t = localStorage.getItem("guildserver-token")
    setToken(t)
    setIsReady(true)

    if (!t && redirect) {
      router.replace("/auth/login")
    }
  }, [redirect, router])

  const logout = () => {
    localStorage.removeItem("guildserver-token")
    router.push("/auth/login")
  }

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
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
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
    { enabled: isValidUUID(organizationId) }
  )

  return {
    projects: projectsQuery.data ?? [],
    isLoading: projectsQuery.isLoading,
    currentProject: projectsQuery.data?.[0] ?? null,
    projectId: projectsQuery.data?.[0]?.id ?? "",
  }
}
