"use client"

import { useState, useMemo } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { trpc } from "@/components/trpc-provider"
import { useOrganization, useProjects } from "@/hooks/use-auth"
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
} from "lucide-react"
import { AppListSkeleton } from "@/components/skeletons/app-list-skeleton"
import { EmptyState } from "@/components/empty-state"
import { AnimatedList, AnimatedItem } from "@/components/motion/animated-list"
import { ResponsiveModal } from "@/components/ui/responsive-modal"

const API_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:4000"

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
  )
}

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
  const [createMode, setCreateMode] = useState<"docker" | "git">("docker")

  // Form state
  const [appName, setAppName] = useState("")
  const [dockerImage, setDockerImage] = useState("nginx")
  const [dockerTag, setDockerTag] = useState("alpine")
  const [repository, setRepository] = useState("")
  const [branch, setBranch] = useState("main")
  const [createEnvVars, setCreateEnvVars] = useState<EnvVarEntry[]>([{ key: "", value: "" }])
  const [deployTarget, setDeployTarget] = useState<"docker-local" | "proxmox">("docker-local")
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null)

  // GitHub repo browser state
  const [repoSearch, setRepoSearch] = useState("")
  const [selectedRepo, setSelectedRepo] = useState<{ owner: string; name: string; fullName: string; url: string; defaultBranch: string } | null>(null)
  const [showBranchDropdown, setShowBranchDropdown] = useState(false)

  const { confirm: showConfirm, dialogProps: confirmDialogProps } = useConfirmDialog()

  const { orgId } = useOrganization()
  const { projectId } = useProjects(orgId)

  // UUID validation to prevent queries with empty/invalid IDs
  const isValidUUID = (s: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)

  // Real data queries - only fetch when we have a valid project UUID
  const appsQuery = trpc.application.list.useQuery(
    { projectId },
    { enabled: isValidUUID(projectId), refetchInterval: 30000 }
  )

  const utils = trpc.useUtils()

  // Mutations
  const createApp = trpc.application.create.useMutation({
    onSuccess: () => {
      toast.success("Application created!")
      utils.application.list.invalidate()
      setShowCreateModal(false)
      resetForm()
    },
    onError: (err) => toast.error(err.message),
  })

  const deployApp = trpc.application.deploy.useMutation({
    // Optimistic: immediately show "deploying" status
    onMutate: async ({ id }) => {
      await utils.application.list.cancel()
      const previous = utils.application.list.getData({ projectId })
      utils.application.list.setData({ projectId }, (old: any) =>
        old?.map((a: any) => (a.id === id ? { ...a, status: "deploying" } : a))
      )
      return { previous }
    },
    onSuccess: () => {
      toast.success("Deployment started!")
    },
    onError: (err, _vars, ctx: any) => {
      if (ctx?.previous) utils.application.list.setData({ projectId }, ctx.previous)
      toast.error(err.message)
    },
    onSettled: () => utils.application.list.invalidate(),
  })

  const restartApp = trpc.application.restart.useMutation({
    onSuccess: () => {
      toast.success("Application restarted!")
      utils.application.list.invalidate()
    },
    onError: (err) => toast.error(err.message),
  })

  const deleteApp = trpc.application.delete.useMutation({
    // Optimistic: remove from list immediately
    onMutate: async ({ id }) => {
      await utils.application.list.cancel()
      const previous = utils.application.list.getData({ projectId })
      utils.application.list.setData({ projectId }, (old: any) =>
        old?.filter((a: any) => a.id !== id)
      )
      return { previous }
    },
    onSuccess: () => {
      toast.success("Application deleted!")
    },
    onError: (err, _vars, ctx: any) => {
      if (ctx?.previous) utils.application.list.setData({ projectId }, ctx.previous)
      toast.error(err.message)
    },
    onSettled: () => utils.application.list.invalidate(),
  })

  // GitHub integration queries
  const githubStatusQuery = trpc.github.getConnectionStatus.useQuery(undefined, { retry: false })
  const githubConnectedWithScope = githubStatusQuery.data?.connected === true && githubStatusQuery.data?.hasRepoScope === true
  const githubReposQuery = trpc.github.listRepos.useQuery(undefined, {
    enabled: githubConnectedWithScope && createMode === "git" && showCreateModal,
    retry: false,
  })
  const githubBranchesQuery = trpc.github.listBranches.useQuery(
    { owner: selectedRepo?.owner ?? "", repo: selectedRepo?.name ?? "" },
    {
      enabled: !!selectedRepo && !!selectedRepo.owner && !!selectedRepo.name,
      retry: false,
    }
  )

  const githubConnected = githubConnectedWithScope

  // Proxmox providers query — fetch available compute providers for deploy target
  const providersQuery = trpc.provider.list.useQuery(undefined, {
    enabled: showCreateModal,
  })
  const proxmoxProviders = useMemo(() => {
    return (providersQuery.data ?? []).filter((p: any) => p.type === "proxmox" && p.status === "connected")
  }, [providersQuery.data])

  // Filter repos by search
  const filteredRepos = useMemo(() => {
    const repos = githubReposQuery.data ?? []
    if (!repoSearch.trim()) return repos.slice(0, 20)
    return repos.filter((r: any) =>
      r.fullName?.toLowerCase().includes(repoSearch.toLowerCase()) ||
      r.name?.toLowerCase().includes(repoSearch.toLowerCase())
    ).slice(0, 20)
  }, [githubReposQuery.data, repoSearch])

  const resetForm = () => {
    setAppName("")
    setDockerImage("nginx")
    setDockerTag("alpine")
    setRepository("")
    setBranch("main")
    setCreateMode("docker")
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
      data.sourceType = "docker"
      data.dockerImage = dockerImage
      data.dockerTag = dockerTag
    } else {
      data.sourceType = "github"
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Applications</h1>
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
              className="relative group hover:shadow-md transition-shadow"
              onMouseEnter={() => {
                // Prefetch app detail data on hover
                utils.application.getById.prefetch({ id: app.id })
              }}
            >
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <Link
                    href={`/dashboard/applications/${app.id}`}
                    className="flex items-center gap-2 hover:underline"
                  >
                    {getStatusIcon(app.status)}
                    <CardTitle className="text-lg">{app.appName}</CardTitle>
                  </Link>
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
                          href={`http://${primaryDomain.domain}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-500 hover:underline flex items-center gap-1 truncate ml-2"
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

                <div className="flex gap-2">
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
                  <div className="space-y-2">
                    <Label htmlFor="dockerImage">Docker Image</Label>
                    <Input
                      id="dockerImage"
                      value={dockerImage}
                      onChange={(e) => setDockerImage(e.target.value)}
                      placeholder="nginx"
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

              {/* Git fields */}
              {createMode === "git" && (
                <div className="space-y-4">
                  {githubConnected ? (
                    <>
                      {/* GitHub Repo Browser */}
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
                            {githubReposQuery.isLoading ? (
                              <div className="flex items-center justify-center py-6">
                                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                                <span className="ml-2 text-sm text-muted-foreground">Loading repos...</span>
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
                            <GitHubIcon className="h-4 w-4 flex-shrink-0" />
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
                            <div className="relative">
                              <button
                                type="button"
                                className="w-full flex items-center justify-between px-3 py-2 border rounded-md text-sm hover:bg-accent transition-colors"
                                onClick={() => setShowBranchDropdown(!showBranchDropdown)}
                              >
                                <span className="flex items-center gap-2">
                                  <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
                                  {branch}
                                </span>
                                <ChevronDown className="h-4 w-4 text-muted-foreground" />
                              </button>
                              {showBranchDropdown && (
                                <div className="absolute z-10 mt-1 w-full border rounded-md bg-popover shadow-md max-h-40 overflow-y-auto">
                                  {githubBranchesQuery.isLoading ? (
                                    <div className="flex items-center justify-center py-3">
                                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                    </div>
                                  ) : githubBranchesQuery.isError ? (
                                    <div className="px-3 py-3 text-sm text-muted-foreground">
                                      <p>Could not load branches.</p>
                                      <p className="text-xs mt-1">You may need to grant repo access in Settings.</p>
                                    </div>
                                  ) : (
                                    (githubBranchesQuery.data ?? []).map((branchName: string) => (
                                      <button
                                        key={branchName}
                                        type="button"
                                        className={`w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors ${
                                          branchName === branch ? "bg-accent font-medium" : ""
                                        }`}
                                        onClick={() => {
                                          setBranch(branchName)
                                          setShowBranchDropdown(false)
                                        }}
                                      >
                                        {branchName}
                                        {branchName === selectedRepo.defaultBranch && (
                                          <span className="ml-2 text-xs text-muted-foreground">(default)</span>
                                        )}
                                      </button>
                                    ))
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    /* Manual input when GitHub not connected */
                    <div className="space-y-4">
                      {!githubStatusQuery.isLoading && (
                        <div className="flex items-center gap-3 p-3 border rounded-lg bg-muted/50">
                          <GitHubIcon className="h-5 w-5 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium">Connect GitHub for easy repo selection</p>
                            <p className="text-xs text-muted-foreground">Browse and select repos like Vercel</p>
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              window.location.href = `${API_URL}/auth/github?scope=repo`
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
                          placeholder="https://github.com/user/repo"
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

              {/* Deploy Target */}
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
                      <Link href="/dashboard/settings/infrastructure" className="text-primary hover:underline">
                        Add a Proxmox node
                      </Link>{" "}
                      in Settings to unlock multi-node deployments.
                    </span>
                  </div>
                )}
              </div>

              {/* Environment Variables */}
              <EnvVarEditor
                value={createEnvVars}
                onChange={setCreateEnvVars}
                collapsible={true}
                label="Environment Variables (optional)"
              />

              {/* Actions */}
              <div className="flex gap-3">
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
        </div>
      </ResponsiveModal>
    </div>
  )
}
