"use client"

import { useState, useMemo, useEffect } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { trpc } from "@/components/trpc-provider"
import { useOrganization, useProjects, useCurrentUser } from "@/hooks/use-auth"
import { formatDateTime } from "@/lib/utils"
import { toast } from "sonner"
import { EnvVarEditor, type EnvVarEntry } from "@/components/env-var-editor"
import { ConfirmDialog, useConfirmDialog } from "@/components/ui/confirm-dialog"
import {
  Plus,
  Search,
  Rocket,
  ExternalLink,
  Settings,
  Play,
  Pause,
  MoreHorizontal,
  Loader2,
  GitBranch,
  Container,
  RefreshCw,
  Trash2,
  X,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  Link2,
  ChevronDown,
  Server,
  Monitor,
  Info,
  Star,
  Download,
  Lock,
  ShieldCheck,
} from "lucide-react"
import { AppListSkeleton } from "@/components/skeletons/app-list-skeleton"
import { EmptyState } from "@/components/empty-state"
import { AnimatedList, AnimatedItem } from "@/components/motion/animated-list"
import { ResponsiveModal } from "@/components/ui/responsive-modal"
import { CardLinkOverlay } from "@/components/ui/card-link-overlay"

const API_URL = process.env.NEXT_PUBLIC_API_BASE_URL || ""

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
  )
}

function GitLabIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M23.955 8.468a.952.952 0 0 0-.256-.838l-4.706-4.814-1.959-6.024A.944.944 0 0 0 16.14.004a.944.944 0 0 0-.853.64l-1.933 5.952H10.64L8.71.643a.944.944 0 0 0-.853-.64A.944.944 0 0 0 6.963.792L5.004 6.816.298 11.63a.952.952 0 0 0-.256.838.948.948 0 0 0 .524.717l11.434 8.577 11.431-8.577a.948.948 0 0 0 .524-.717z"/>
    </svg>
  )
}

function BitbucketIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M.76 1.139a.76.76 0 0 1 .737-.584h21.006a.76.76 0 0 1 .737.584L20.89 16.634a1.861 1.861 0 0 1-1.789 1.409H4.898A1.861 1.861 0 0 1 3.11 16.634L.76 1.139zm13.112 9.531L15.344 6.64H8.656l1.472 4.03h3.744z"/>
    </svg>
  )
}


const compactFormatter = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 })
const formatCompact = (n: number) => compactFormatter.format(n || 0)

const getStatusColor = (status: string) => {
  switch (status) {
    case "running":
      return "bg-green-50 text-green-700 border-green-200"
    case "stopped":
      return "bg-yellow-50 text-yellow-700 border-yellow-200"
    case "deploying":
    case "building":
      return "bg-blue-50 text-blue-700 border-blue-200"
    case "failed":
      return "bg-red-50 text-red-700 border-red-200"
    default:
      return "bg-gray-50 text-gray-700 border-gray-200"
  }
}

const getStatusIcon = (status: string) => {
  switch (status) {
    case "running":
      return <CheckCircle className="h-4 w-4 text-green-500" />
    case "deploying":
    case "building":
      return <Clock className="h-4 w-4 text-blue-500 animate-pulse" />
    case "failed":
      return <XCircle className="h-4 w-4 text-red-500" />
    case "stopped":
      return <AlertTriangle className="h-4 w-4 text-yellow-500" />
    default:
      return <Rocket className="h-4 w-4 text-muted-foreground" />
  }
}

export default function ApplicationsPage() {
  const searchParams = useSearchParams()
  const [searchQuery, setSearchQuery] = useState("")
  const [showCreateModal, setShowCreateModal] = useState(searchParams.get("action") === "create")
  const [createMode, setCreateMode] = useState<"docker" | "git">(
    searchParams.get("mode") === "git" ? "git" : "docker"
  )

  // Form state
  const [appName, setAppName] = useState("")
  const [dockerImage, setDockerImage] = useState("nginx")
  const [dockerTag, setDockerTag] = useState("alpine")
  // Docker source sub-mode: search Docker Hub, type manually, or use a private registry
  const [dockerMode, setDockerMode] = useState<"search" | "manual" | "registry">("search")
  const [imageSearch, setImageSearch] = useState("")
  const [debouncedImageSearch, setDebouncedImageSearch] = useState("")
  const [selectedImage, setSelectedImage] = useState<string | null>(null)
  const [registryUrl, setRegistryUrl] = useState("")
  const [registryUsername, setRegistryUsername] = useState("")
  const [registryPassword, setRegistryPassword] = useState("")
  const [repository, setRepository] = useState("")
  const [branch, setBranch] = useState("main")
  const [createEnvVars, setCreateEnvVars] = useState<EnvVarEntry[]>([{ key: "", value: "" }])
  const [deployTarget, setDeployTarget] = useState<"docker-local" | "proxmox">("docker-local")
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null)

  // GitHub repo browser state
  const [repoSearch, setRepoSearch] = useState("")
  const [selectedRepo, setSelectedRepo] = useState<{ owner: string; name: string; fullName: string; url: string; defaultBranch: string } | null>(null)
  const [selectedGitProvider, setSelectedGitProvider] = useState<"github" | "gitlab" | "bitbucket">("github")


  const { confirm: showConfirm, dialogProps: confirmDialogProps } = useConfirmDialog()

  const { orgId, currentOrg, isLoading: orgLoading } = useOrganization()
  const { projectId } = useProjects(orgId)
  const { isAdmin } = useCurrentUser()

  // UUID validation to prevent queries with empty/invalid IDs
  const isValidUUID = (s: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)

  // Real data queries - only fetch when we have a valid org UUID
  const appsQuery = trpc.application.listByOrg.useQuery(
    { organizationId: orgId },
    { enabled: isValidUUID(orgId), refetchInterval: 30000 }
  )

  const utils = trpc.useUtils()

  // Mutations
  const createApp = trpc.application.create.useMutation({
    onSuccess: () => {
      toast.success("Application created!")
      utils.application.listByOrg.invalidate({ organizationId: orgId })
      setShowCreateModal(false)
      resetForm()
    },
    onError: (err) => toast.error(err.message),
  })

  const deployApp = trpc.application.deploy.useMutation({
    // Optimistic: immediately show "deploying" status
    onMutate: async ({ id }) => {
      await utils.application.listByOrg.cancel()
      const previous = utils.application.listByOrg.getData({ organizationId: orgId })
      utils.application.listByOrg.setData({ organizationId: orgId }, (old: any) =>
        old?.map((a: any) => (a.id === id ? { ...a, status: "deploying" } : a))
      )
      return { previous }
    },
    onSuccess: () => {
      toast.success("Deployment started!")
    },
    onError: (err, _vars, ctx: any) => {
      if (ctx?.previous) utils.application.listByOrg.setData({ organizationId: orgId }, ctx.previous)
      toast.error(err.message)
    },
    onSettled: () => utils.application.listByOrg.invalidate({ organizationId: orgId }),
  })

  const restartApp = trpc.application.restart.useMutation({
    onSuccess: () => {
      toast.success("Application restarted!")
      utils.application.listByOrg.invalidate({ organizationId: orgId })
    },
    onError: (err) => toast.error(err.message),
  })

  const deleteApp = trpc.application.delete.useMutation({
    // Optimistic: remove from list immediately
    onMutate: async ({ id }) => {
      await utils.application.listByOrg.cancel()
      const previous = utils.application.listByOrg.getData({ organizationId: orgId })
      utils.application.listByOrg.setData({ organizationId: orgId }, (old: any) =>
        old?.filter((a: any) => a.id !== id)
      )
      return { previous }
    },
    onSuccess: () => {
      toast.success("Application deleted!")
    },
    onError: (err, _vars, ctx: any) => {
      if (ctx?.previous) utils.application.listByOrg.setData({ organizationId: orgId }, ctx.previous)
      toast.error(err.message)
    },
    onSettled: () => utils.application.listByOrg.invalidate({ organizationId: orgId }),
  })

  // Git Provider integration queries
  const connectedAccountsQuery = trpc.github.getConnectedAccounts.useQuery(undefined, { retry: false })
  const connectedProviders = useMemo(() => {
    return (connectedAccountsQuery.data ?? []).map((a: any) => a.provider)
  }, [connectedAccountsQuery.data])
  
  const gitProviderConnected = connectedProviders.includes(selectedGitProvider)

  const reposQuery = trpc.github.listRepos.useQuery({ provider: selectedGitProvider }, {
    enabled: gitProviderConnected && createMode === "git" && showCreateModal,
    retry: false,
  })

  const branchesQuery = trpc.github.listBranches.useQuery(
    { owner: selectedRepo?.owner ?? "", repo: selectedRepo?.name ?? "", provider: selectedGitProvider },
    {
      enabled: !!selectedRepo && !!selectedRepo.owner && !!selectedRepo.name,
      retry: false,
    }
  )

  // Proxmox providers query — only admins can see/choose deploy targets
  const providersQuery = trpc.provider.list.useQuery(undefined, {
    enabled: showCreateModal && isAdmin,
  })
  const proxmoxProviders = useMemo(() => {
    return (providersQuery.data ?? []).filter((p: any) => p.type === "proxmox" && p.status === "connected")
  }, [providersQuery.data])

  // Filter repos by search
  const filteredRepos = useMemo(() => {
    const repos = reposQuery.data ?? []
    if (!repoSearch.trim()) return repos.slice(0, 20)
    return repos.filter((r: any) =>
      r.fullName?.toLowerCase().includes(repoSearch.toLowerCase()) ||
      r.name?.toLowerCase().includes(repoSearch.toLowerCase())
    ).slice(0, 20)
  }, [reposQuery.data, repoSearch])

  // Debounce the Docker Hub search input to avoid hammering the API
  useEffect(() => {
    const t = setTimeout(() => setDebouncedImageSearch(imageSearch.trim()), 300)
    return () => clearTimeout(t)
  }, [imageSearch])

  const imageSearchQuery = trpc.application.searchDockerImages.useQuery(
    { query: debouncedImageSearch },
    {
      enabled: showCreateModal && createMode === "docker" && dockerMode === "search" && debouncedImageSearch.length > 0,
      retry: false,
    }
  )

  const imageTagsQuery = trpc.application.listDockerImageTags.useQuery(
    { repository: selectedImage ?? "" },
    { enabled: !!selectedImage, retry: false }
  )

  const resetForm = () => {
    setAppName("")
    setDockerImage("nginx")
    setDockerTag("alpine")
    setRepository("")
    setBranch("main")
    setCreateMode("docker")
    setDockerMode("search")
    setImageSearch("")
    setDebouncedImageSearch("")
    setSelectedImage(null)
    setRegistryUrl("")
    setRegistryUsername("")
    setRegistryPassword("")
    setCreateEnvVars([{ key: "", value: "" }])
    setSelectedRepo(null)
    setRepoSearch("")
    setShowBranchDropdown(false)
    setDeployTarget("docker-local")
    setSelectedProviderId(null)
  }

  const handleCreate = () => {
    if (!appName.trim()) {
      toast.error("Application name is required")
      return
    }

    if (!isValidUUID(projectId)) {
      toast.error("You need to create an organization first. Go to Dashboard → Get Started.")
      return
    }

    // Convert env var array to Record, filtering empty keys
    const envRecord: Record<string, string> = {}
    for (const entry of createEnvVars) {
      if (entry.key.trim()) {
        envRecord[entry.key.trim()] = entry.value
      }
    }

    const data: any = {
      name: appName.trim(),
      projectId,
      buildType: "dockerfile",
      environment: envRecord,
      deploymentTarget: deployTarget,
    }

    if (deployTarget === "proxmox" && selectedProviderId) {
      data.providerId = selectedProviderId
    }

    if (createMode === "docker") {
      if (!dockerImage.trim()) {
        toast.error("Please select or enter a Docker image")
        return
      }
      data.sourceType = "docker"
      data.dockerTag = (dockerTag || "latest").trim()
      if (dockerMode === "registry") {
        const host = registryUrl.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "")
        const img = dockerImage.trim().replace(/^\/+/, "")
        // Include the registry host in the image reference so Docker pulls from the right registry
        data.dockerImage = host && !img.startsWith(`${host}/`) ? `${host}/${img}` : img
        data.registryUrl = host || null
        data.registryUsername = registryUsername.trim() || null
        data.registryPassword = registryPassword || null
      } else {
        data.dockerImage = dockerImage.trim()
      }
    } else {
      if (repository.includes("gitlab.com")) {
        data.sourceType = "gitlab"
      } else if (repository.includes("bitbucket.org")) {
        data.sourceType = "bitbucket"
      } else if (repository.includes("gitea")) {
        data.sourceType = "gitea"
      } else if (repository.includes("github.com") || repository.indexOf("http") === -1) {
        data.sourceType = "github"
      } else {
        data.sourceType = "git"
      }
      data.repository = repository
      data.branch = branch
    }

    createApp.mutate(data)
  }

  const handleDeploy = (appId: string) => {
    deployApp.mutate({ id: appId })
  }

  const handleRestart = (appId: string) => {
    restartApp.mutate({ id: appId })
  }

  const handleDelete = (appId: string, appName: string) => {
    showConfirm({
      title: `Delete "${appName}"?`,
      description: "This will permanently stop and remove the container. This action cannot be undone.",
      confirmLabel: "Delete",
      variant: "danger",
      onConfirm: () => deleteApp.mutate({ id: appId }),
    })
  }

  const allApps = appsQuery.data ?? []
  const filteredApps = allApps.filter((app: any) =>
    app.appName.toLowerCase().includes(searchQuery.toLowerCase())
  )

  // If no organization exists, prompt the user to create one first
  if (!orgLoading && !currentOrg) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Applications</h1>
          <p className="text-muted-foreground">
            Deploy and manage your applications
          </p>
        </div>
        <Card className="text-center py-12">
          <CardContent>
            <Rocket className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">Create an organization first</h3>
            <p className="text-muted-foreground mb-6">
              You need an organization and project before deploying applications
            </p>
            <Link href="/dashboard/onboarding">
              <Button size="lg">
                <Plus className="mr-2 h-4 w-4" />
                Get Started
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Applications</h1>
          <p className="text-muted-foreground">
            Deploy and manage your applications
          </p>
        </div>
        <Button onClick={() => setShowCreateModal(true)}>
          <Plus className="mr-2 h-4 w-4" />
          New Application
        </Button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search applications..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Loading skeleton */}
      {appsQuery.isLoading && appsQuery.isFetching && (
        <AppListSkeleton />
      )}

      {/* Applications Grid */}
      {!(appsQuery.isLoading && appsQuery.isFetching) && (
        <AnimatedList className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {filteredApps.map((app: any) => (
            <AnimatedItem key={app.id}>
            <Card
              className="relative group cursor-pointer hover:shadow-md hover:border-primary/30 hover:-translate-y-0.5 transition-all duration-200"
            >
              {/* Whole-card click target → opens the application detail page.
                  Action buttons below sit above this overlay via relative z-10. */}
              <CardLinkOverlay
                href={`/dashboard/applications/${app.id}`}
                label={`Open ${app.appName}`}
                onMouseEnter={() => utils.application.getById.prefetch({ id: app.id })}
                onFocus={() => utils.application.getById.prefetch({ id: app.id })}
              />
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {getStatusIcon(app.status)}
                    <CardTitle className="text-lg group-hover:text-primary transition-colors">{app.appName}</CardTitle>
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <Badge
                    variant="outline"
                    className={getStatusColor(app.status)}
                  >
                    {app.status}
                  </Badge>
                  <Badge variant="secondary">
                    {app.sourceType === "docker" ? (
                      <><Container className="mr-1 h-3 w-3" />Docker</>
                    ) : (
                      <><GitBranch className="mr-1 h-3 w-3" />{app.sourceType}</>
                    )}
                  </Badge>
                  {app.deploymentTarget === "proxmox" && (
                    <Badge variant="secondary" className="text-orange-600 border-orange-200">
                      <Server className="mr-1 h-3 w-3" />Proxmox
                    </Badge>
                  )}
                </div>
              </CardHeader>

              <CardContent className="space-y-4">
                <div className="space-y-2 text-sm">
                  {/* Access URL */}
                  {(() => {
                    const primaryDomain = app.domains?.find((d: any) => d.isPrimary && d.status === "active")
                      || app.domains?.find((d: any) => d.status === "active");
                    return primaryDomain ? (
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">URL:</span>
                        <a
                          href={`https://${primaryDomain.domain}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="relative z-10 text-xs text-blue-500 hover:underline flex items-center gap-1 truncate ml-2"
                        >
                          {primaryDomain.domain}
                          <ExternalLink className="h-3 w-3 flex-shrink-0" />
                        </a>
                      </div>
                    ) : null;
                  })()}
                  {app.sourceType === "docker" ? (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Image:</span>
                      <span className="font-mono text-xs">{app.dockerImage}:{app.dockerTag || "latest"}</span>
                    </div>
                  ) : (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Repo:</span>
                      <span className="truncate ml-2 text-xs">{app.repository}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Updated:</span>
                    <span className="text-xs">{formatDateTime(app.updatedAt)}</span>
                  </div>
                </div>

                <div className="relative z-10 flex gap-2">
                  <Button
                    variant="default"
                    size="sm"
                    className="flex-1"
                    onClick={() => handleDeploy(app.id)}
                    disabled={deployApp.isLoading}
                  >
                    {deployApp.isLoading ? (
                      <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                    ) : (
                      <Rocket className="mr-2 h-3 w-3" />
                    )}
                    Deploy
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleRestart(app.id)}
                    disabled={restartApp.isLoading}
                    title="Restart"
                  >
                    <RefreshCw className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDelete(app.id, app.appName)}
                    disabled={deleteApp.isLoading}
                    className="text-red-600 hover:text-red-700"
                    title="Delete"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </CardContent>
            </Card>
            </AnimatedItem>
          ))}
        </AnimatedList>
      )}

      {/* Empty State */}
      {!(appsQuery.isLoading && appsQuery.isFetching) && filteredApps.length === 0 && (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={Rocket}
              title={searchQuery ? "No applications found" : "No applications yet"}
              description={
                searchQuery
                  ? "No applications match your search criteria. Try a different search term."
                  : "Get started by deploying your first application from Docker or Git."
              }
              action={
                searchQuery
                  ? { label: "Clear search", onClick: () => setSearchQuery(""), icon: Search }
                  : { label: "New Application", onClick: () => setShowCreateModal(true), icon: Plus }
              }
            />
          </CardContent>
        </Card>
      )}

      {/* Confirm Dialog */}
      <ConfirmDialog {...confirmDialogProps} />

      {/* Create Modal — responsive: drawer on mobile, modal on desktop */}
      <ResponsiveModal
        open={showCreateModal}
        onClose={() => { setShowCreateModal(false); resetForm() }}
        title="New Application"
        footer={
          <div className="flex w-full gap-3">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => { setShowCreateModal(false); resetForm() }}
            >
              Cancel
            </Button>
            <Button
              className="flex-1"
              onClick={handleCreate}
              disabled={createApp.isPending}
            >
              {createApp.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="mr-2 h-4 w-4" />
              )}
              Create Application
            </Button>
          </div>
        }
      >
        <div className="space-y-6">
              {/* App Name */}
              <div className="space-y-2">
                <Label htmlFor="appName">Application Name</Label>
                <Input
                  id="appName"
                  value={appName}
                  onChange={(e) => setAppName(e.target.value)}
                  placeholder="my-awesome-app"
                />
              </div>

              {/* Source Type Toggle */}
              <div className="space-y-2">
                <Label>Source Type</Label>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant={createMode === "docker" ? "default" : "outline"}
                    onClick={() => setCreateMode("docker")}
                    className="justify-start"
                  >
                    <Container className="mr-2 h-4 w-4" />
                    Docker Image
                  </Button>
                  <Button
                    variant={createMode === "git" ? "default" : "outline"}
                    onClick={() => setCreateMode("git")}
                    className="justify-start"
                  >
                    <GitBranch className="mr-2 h-4 w-4" />
                    Git Repository
                  </Button>
                </div>
              </div>

              {/* Docker fields */}
              {createMode === "docker" && (
                <div className="space-y-4">
                  {/* Docker source mode */}
                  <div className="grid grid-cols-3 gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={dockerMode === "search" ? "default" : "outline"}
                      onClick={() => setDockerMode("search")}
                    >
                      <Search className="mr-1.5 h-3.5 w-3.5" />
                      Docker Hub
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={dockerMode === "manual" ? "default" : "outline"}
                      onClick={() => setDockerMode("manual")}
                    >
                      <Container className="mr-1.5 h-3.5 w-3.5" />
                      Manual
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={dockerMode === "registry" ? "default" : "outline"}
                      onClick={() => setDockerMode("registry")}
                    >
                      <Lock className="mr-1.5 h-3.5 w-3.5" />
                      Private
                    </Button>
                  </div>

                  {/* Search Docker Hub */}
                  {dockerMode === "search" && (
                    <div className="space-y-3">
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          value={imageSearch}
                          onChange={(e) => setImageSearch(e.target.value)}
                          placeholder="Search Docker Hub — e.g. nginx, redis, postgres"
                          className="pl-9"
                          autoFocus
                        />
                      </div>

                      {imageSearchQuery.isFetching && (
                        <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Searching Docker Hub…
                        </div>
                      )}

                      {imageSearchQuery.isError && (
                        <p className="text-sm text-red-600">
                          Couldn&apos;t reach Docker Hub. Try again or enter the image manually.
                        </p>
                      )}

                      {!imageSearchQuery.isFetching &&
                        debouncedImageSearch.length > 0 &&
                        (imageSearchQuery.data?.length ?? 0) === 0 &&
                        !imageSearchQuery.isError && (
                          <p className="py-4 text-center text-sm text-muted-foreground">
                            No images found for &quot;{debouncedImageSearch}&quot;
                          </p>
                        )}

                      {!imageSearchQuery.isFetching && (imageSearchQuery.data?.length ?? 0) > 0 && (
                        <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border p-1">
                          {imageSearchQuery.data!.map((img: any) => {
                            const isSelected = selectedImage === img.name
                            return (
                              <button
                                key={img.name}
                                type="button"
                                onClick={() => {
                                  setSelectedImage(img.name)
                                  setDockerImage(img.name)
                                  setDockerTag("latest")
                                }}
                                className={`flex w-full items-start gap-2 rounded-md px-3 py-2 text-left transition-colors hover:bg-muted ${
                                  isSelected ? "bg-muted ring-1 ring-ring" : ""
                                }`}
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-1.5">
                                    <span className="truncate font-mono text-sm font-medium">{img.displayName}</span>
                                    {img.isOfficial && (
                                      <Badge variant="secondary" className="h-4 shrink-0 px-1 text-[10px]">
                                        <ShieldCheck className="mr-0.5 h-2.5 w-2.5" />
                                        Official
                                      </Badge>
                                    )}
                                  </div>
                                  {img.description && (
                                    <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{img.description}</p>
                                  )}
                                </div>
                                <div className="flex shrink-0 flex-col items-end gap-0.5 text-[11px] text-muted-foreground">
                                  <span className="flex items-center gap-0.5">
                                    <Star className="h-3 w-3" />
                                    {formatCompact(img.starCount)}
                                  </span>
                                  <span className="flex items-center gap-0.5">
                                    <Download className="h-3 w-3" />
                                    {formatCompact(img.pullCount)}
                                  </span>
                                </div>
                              </button>
                            )
                          })}
                        </div>
                      )}

                      {/* Tag selector for the chosen image */}
                      {selectedImage && (
                        <div className="space-y-2 rounded-md border bg-muted/30 p-3">
                          <div className="flex items-center justify-between">
                            <Label className="text-xs">Tag for <span className="font-mono">{selectedImage}</span></Label>
                            {imageTagsQuery.isFetching && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
                          </div>
                          <Select value={dockerTag} onValueChange={setDockerTag}>
                            <SelectTrigger>
                              <SelectValue placeholder="latest" />
                            </SelectTrigger>
                            <SelectContent>
                              {!imageTagsQuery.data?.some((t: any) => t.name === "latest") && (
                                <SelectItem value="latest">latest</SelectItem>
                              )}
                              {(imageTagsQuery.data ?? []).map((t: any) => (
                                <SelectItem key={t.name} value={t.name}>
                                  {t.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Manual entry */}
                  {dockerMode === "manual" && (
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="dockerImage">Docker Image</Label>
                        <Input
                          id="dockerImage"
                          value={dockerImage}
                          onChange={(e) => setDockerImage(e.target.value)}
                          placeholder="nginx or grafana/grafana"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="dockerTag">Tag</Label>
                        <Input
                          id="dockerTag"
                          value={dockerTag}
                          onChange={(e) => setDockerTag(e.target.value)}
                          placeholder="latest"
                        />
                      </div>
                    </div>
                  )}

                  {/* Private registry */}
                  {dockerMode === "registry" && (
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="registryUrl">Registry URL</Label>
                        <Input
                          id="registryUrl"
                          value={registryUrl}
                          onChange={(e) => setRegistryUrl(e.target.value)}
                          placeholder="ghcr.io or registry.example.com:5000"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <Label htmlFor="dockerImage">Image</Label>
                          <Input
                            id="dockerImage"
                            value={dockerImage}
                            onChange={(e) => setDockerImage(e.target.value)}
                            placeholder="org/app"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="dockerTag">Tag</Label>
                          <Input
                            id="dockerTag"
                            value={dockerTag}
                            onChange={(e) => setDockerTag(e.target.value)}
                            placeholder="latest"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <Label htmlFor="registryUsername">Username</Label>
                          <Input
                            id="registryUsername"
                            value={registryUsername}
                            onChange={(e) => setRegistryUsername(e.target.value)}
                            placeholder="username"
                            autoComplete="off"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="registryPassword">Password / Token</Label>
                          <Input
                            id="registryPassword"
                            type="password"
                            value={registryPassword}
                            onChange={(e) => setRegistryPassword(e.target.value)}
                            placeholder="••••••••"
                            autoComplete="new-password"
                          />
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Credentials are used only to pull the image at deploy time. Leave blank for a public image.
                      </p>
                    </div>
                  )}

                  {/* Resolved selection */}
                  {dockerImage.trim() && (
                    <p className="text-xs text-muted-foreground">
                      Deploys{" "}
                      <code className="rounded bg-muted px-1 py-0.5 font-mono text-foreground">
                        {registryUrl.trim() ? `${registryUrl.trim()}/` : ""}
                        {dockerImage.trim()}:{(dockerTag || "latest").trim()}
                      </code>
                    </p>
                  )}
                </div>
              )}

              {/* Git fields */}
              {createMode === "git" && (
                <div className="space-y-4">
                  {/* Provider Tabs */}
                      <div className="flex space-x-2">
                        <Button 
                          type="button"
                          variant={selectedGitProvider === "github" ? "default" : "outline"} 
                          onClick={() => { setSelectedGitProvider("github"); setSelectedRepo(null) }}
                          className="flex-1"
                        >
                          <GitHubIcon className="mr-2 h-4 w-4" /> GitHub
                        </Button>
                        <Button 
                          type="button"
                          variant={selectedGitProvider === "gitlab" ? "default" : "outline"} 
                          onClick={() => { setSelectedGitProvider("gitlab"); setSelectedRepo(null) }}
                          className="flex-1"
                        >
                          <GitLabIcon className="mr-2 h-4 w-4" /> GitLab
                        </Button>
                        <Button 
                          type="button"
                          variant={selectedGitProvider === "bitbucket" ? "default" : "outline"} 
                          onClick={() => { setSelectedGitProvider("bitbucket"); setSelectedRepo(null) }}
                          className="flex-1"
                        >
                          <BitbucketIcon className="mr-2 h-4 w-4" /> Bitbucket
                        </Button>
                      </div>

                  {gitProviderConnected ? (
                    <>
                      {/* Git Repo Browser */}
                      {!selectedRepo ? (
                        <div className="space-y-3">
                          <Label>Select a Repository</Label>
                          <div className="relative">
                            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                              placeholder="Search your repositories..."
                              value={repoSearch}
                              onChange={(e) => setRepoSearch(e.target.value)}
                              className="pl-10"
                            />
                          </div>
                          <div className="border rounded-lg max-h-48 overflow-y-auto">
                            {reposQuery.isLoading ? (
                              <div className="flex items-center justify-center py-6">
                                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                                <span className="ml-2 text-sm text-muted-foreground">Loading repos...</span>
                              </div>
                            ) : reposQuery.error ? (
                              <div className="text-center py-6 px-4 space-y-3">
                                <p className="text-sm text-destructive">
                                  {reposQuery.error.message || "Failed to load repositories."}
                                </p>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    const returnUrl = encodeURIComponent("/dashboard/applications?action=create&mode=git")
                                    window.location.href = `${API_URL}/auth/${selectedGitProvider}?scope=repo&returnTo=${returnUrl}`
                                  }}
                                >
                                  <Link2 className="mr-1.5 h-3.5 w-3.5" />
                                  Reconnect {selectedGitProvider === "github" ? "GitHub" : selectedGitProvider === "gitlab" ? "GitLab" : "Bitbucket"}
                                </Button>
                              </div>
                            ) : filteredRepos.length === 0 ? (
                              <div className="text-center py-6 text-sm text-muted-foreground">
                                {repoSearch ? "No repositories match your search" : "No repositories found"}
                              </div>
                            ) : (
                              filteredRepos.map((repo: any) => (
                                <button
                                  key={repo.fullName}
                                  type="button"
                                  className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-accent text-left transition-colors border-b last:border-b-0"
                                  onClick={() => {
                                    setSelectedRepo({
                                      owner: repo.owner,
                                      name: repo.name,
                                      fullName: repo.fullName,
                                      url: repo.url || `https://github.com/${repo.fullName}`,
                                      defaultBranch: repo.defaultBranch || "main",
                                    })
                                    setRepository(repo.url || `https://github.com/${repo.fullName}`)
                                    setBranch(repo.defaultBranch || "main")
                                  }}
                                >
                                  <GitBranch className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                                  <div className="min-w-0 flex-1">
                                    <div className="text-sm font-medium truncate">{repo.fullName}</div>
                                  </div>
                                  {repo.private && (
                                    <Badge variant="secondary" className="text-xs flex-shrink-0">Private</Badge>
                                  )}
                                </button>
                              ))
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Or enter a URL manually below
                          </p>
                          <Input
                            value={repository}
                            onChange={(e) => setRepository(e.target.value)}
                            placeholder="https://github.com/user/repo"
                          />
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {/* Selected Repo Display */}
                          <Label>Repository</Label>
                          <div className="flex items-center gap-2 p-3 border rounded-lg bg-accent/50">
                            {selectedGitProvider === "github" ? <GitHubIcon className="h-4 w-4 flex-shrink-0" /> : selectedGitProvider === "gitlab" ? <GitLabIcon className="h-4 w-4 flex-shrink-0" /> : <BitbucketIcon className="h-4 w-4 flex-shrink-0" /> }
                            <span className="text-sm font-medium flex-1 truncate">{selectedRepo.fullName}</span>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2"
                              onClick={() => {
                                setSelectedRepo(null)
                                setRepository("")
                                setBranch("main")
                                setRepoSearch("")
                              }}
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          </div>

                          {/* Branch Selector */}
                          <div className="space-y-2">
                            <Label>Branch</Label>
                            <Select 
                              value={branch} 
                              onValueChange={setBranch} 
                              disabled={branchesQuery.isLoading || branchesQuery.isError}
                            >
                              <SelectTrigger className="w-full">
                                <div className="flex items-center gap-2">
                                  <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
                                  <SelectValue placeholder="Select branch" />
                                </div>
                              </SelectTrigger>
                              <SelectContent>
                                {branchesQuery.isLoading ? (
                                  <div className="flex items-center justify-center py-3">
                                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                  </div>
                                ) : branchesQuery.isError ? (
                                  <div className="px-3 py-3 text-sm text-muted-foreground">
                                    <p>Could not load branches.</p>
                                  </div>
                                ) : (
                                  (branchesQuery.data ?? []).map((branchName: string) => (
                                    <SelectItem key={branchName} value={branchName}>
                                      {branchName}
                                      {branchName === selectedRepo?.defaultBranch && (
                                        <span className="ml-2 text-xs text-muted-foreground">(default)</span>
                                      )}
                                    </SelectItem>
                                  ))
                                )}
                              </SelectContent>
                            </Select>
                            {branchesQuery.isError && (
                              <p className="text-xs text-muted-foreground mt-1">You may need to grant repo access in Settings.</p>
                            )}
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    /* Manual input when not connected */
                    <div className="space-y-4">
                      {!connectedAccountsQuery.isLoading && (
                        <div className="flex items-center gap-3 p-3 border rounded-lg bg-muted/50">
                          {selectedGitProvider === "github" ? <GitHubIcon className="h-5 w-5 flex-shrink-0" /> : selectedGitProvider === "gitlab" ? <GitLabIcon className="h-5 w-5 flex-shrink-0" /> : <BitbucketIcon className="h-5 w-5 flex-shrink-0" />}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium capitalize">Connect {selectedGitProvider} for easy repo selection</p>
                            <p className="text-xs text-muted-foreground">Browse and select repos</p>
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              const returnUrl = encodeURIComponent("/dashboard/applications?action=create&mode=git")
                              window.location.href = `${API_URL}/auth/${selectedGitProvider}?scope=repo&returnTo=${returnUrl}`
                            }}
                          >
                            <Link2 className="mr-1.5 h-3.5 w-3.5" />
                            Connect
                          </Button>
                        </div>
                      )}
                      <div className="space-y-2">
                        <Label htmlFor="repository">Repository URL</Label>
                        <Input
                          id="repository"
                          value={repository}
                          onChange={(e) => setRepository(e.target.value)}
                          placeholder="https://github.com/user/repo, or GitLab/Bitbucket URL"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="branch">Branch</Label>
                        <Input
                          id="branch"
                          value={branch}
                          onChange={(e) => setBranch(e.target.value)}
                          placeholder="main"
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Deploy Target — only visible to admins */}
              {isAdmin && (
              <div className="space-y-3">
                <Label>Deploy Target</Label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    className={`flex items-center gap-3 p-3 border rounded-lg transition-colors text-left ${
                      deployTarget === "docker-local"
                        ? "border-primary bg-primary/5 ring-1 ring-primary"
                        : "hover:bg-accent"
                    }`}
                    onClick={() => {
                      setDeployTarget("docker-local")
                      setSelectedProviderId(null)
                    }}
                  >
                    <Monitor className="h-5 w-5 text-blue-500 flex-shrink-0" />
                    <div>
                      <div className="text-sm font-medium">Local Docker</div>
                      <div className="text-xs text-muted-foreground">Deploy on this server</div>
                    </div>
                  </button>
                  <button
                    type="button"
                    className={`flex items-center gap-3 p-3 border rounded-lg transition-colors text-left ${
                      deployTarget === "proxmox"
                        ? "border-primary bg-primary/5 ring-1 ring-primary"
                        : "hover:bg-accent"
                    } ${proxmoxProviders.length === 0 ? "opacity-50" : ""}`}
                    onClick={() => {
                      if (proxmoxProviders.length > 0) {
                        setDeployTarget("proxmox")
                      }
                    }}
                    disabled={proxmoxProviders.length === 0}
                  >
                    <Server className="h-5 w-5 text-orange-500 flex-shrink-0" />
                    <div>
                      <div className="text-sm font-medium">Proxmox Node</div>
                      <div className="text-xs text-muted-foreground">
                        {proxmoxProviders.length > 0
                          ? `${proxmoxProviders.length} node${proxmoxProviders.length > 1 ? "s" : ""} available`
                          : "No nodes configured"
                        }
                      </div>
                    </div>
                  </button>
                </div>

                {/* Proxmox node selector */}
                {deployTarget === "proxmox" && proxmoxProviders.length > 0 && (
                  <div className="space-y-2 pl-1">
                    <Label className="text-xs text-muted-foreground">Select a node</Label>
                    <div className="space-y-1.5">
                      <button
                        type="button"
                        className={`w-full flex items-center gap-2 px-3 py-2 border rounded-md text-sm transition-colors text-left ${
                          selectedProviderId === null
                            ? "border-primary bg-primary/5"
                            : "hover:bg-accent"
                        }`}
                        onClick={() => setSelectedProviderId(null)}
                      >
                        <Rocket className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                        <span className="flex-1">Auto (best available)</span>
                        {selectedProviderId === null && (
                          <CheckCircle className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                        )}
                      </button>
                      {proxmoxProviders.map((provider: any) => (
                        <button
                          key={provider.id}
                          type="button"
                          className={`w-full flex items-center gap-2 px-3 py-2 border rounded-md text-sm transition-colors text-left ${
                            selectedProviderId === provider.id
                              ? "border-primary bg-primary/5"
                              : "hover:bg-accent"
                          }`}
                          onClick={() => setSelectedProviderId(provider.id)}
                        >
                          <Server className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                          <span className="flex-1">{provider.name}</span>
                          {provider.region && (
                            <span className="text-xs text-muted-foreground">{provider.region}</span>
                          )}
                          {selectedProviderId === provider.id && (
                            <CheckCircle className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* No Proxmox nodes hint */}
                {deployTarget === "docker-local" && proxmoxProviders.length === 0 && (
                  <div className="flex items-start gap-2 p-2.5 rounded-md bg-muted/50 text-xs text-muted-foreground">
                    <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                    <span>
                      Want to deploy on remote infrastructure?{" "}
                      <Link href="/dashboard/admin/infrastructure" className="text-primary hover:underline">
                        Add a Proxmox node
                      </Link>{" "}
                      in the Admin section to unlock multi-node deployments.
                    </span>
                  </div>
                )}
              </div>
              )}

              {/* Environment Variables */}
              <EnvVarEditor
                value={createEnvVars}
                onChange={setCreateEnvVars}
                collapsible={true}
                label="Environment Variables (optional)"
              />
        </div>
      </ResponsiveModal>
    </div>
  )
}
