"use client"

import { useState } from "react"
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
  AlertTriangle
} from "lucide-react"

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
    onSuccess: () => {
      toast.success("Deployment started!")
      utils.application.list.invalidate()
    },
    onError: (err) => toast.error(err.message),
  })

  const restartApp = trpc.application.restart.useMutation({
    onSuccess: () => {
      toast.success("Application restarted!")
      utils.application.list.invalidate()
    },
    onError: (err) => toast.error(err.message),
  })

  const deleteApp = trpc.application.delete.useMutation({
    onSuccess: () => {
      toast.success("Application deleted!")
      utils.application.list.invalidate()
    },
    onError: (err) => toast.error(err.message),
  })

  const resetForm = () => {
    setAppName("")
    setDockerImage("nginx")
    setDockerTag("alpine")
    setRepository("")
    setBranch("main")
    setCreateMode("docker")
    setCreateEnvVars([{ key: "", value: "" }])
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
    if (confirm(`Delete "${appName}"? This will stop and remove the container.`)) {
      deleteApp.mutate({ id: appId })
    }
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

      {/* Loading */}
      {appsQuery.isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      )}

      {/* Applications Grid */}
      {!appsQuery.isLoading && (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {filteredApps.map((app: any) => (
            <Card key={app.id} className="relative group hover:shadow-md transition-shadow">
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
          ))}
        </div>
      )}

      {/* Empty State */}
      {!appsQuery.isLoading && filteredApps.length === 0 && (
        <Card className="text-center py-12">
          <CardContent>
            <Rocket className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No applications found</h3>
            <p className="text-muted-foreground mb-4">
              {searchQuery
                ? "No applications match your search criteria"
                : "Get started by deploying your first application"
              }
            </p>
            <Button onClick={() => setShowCreateModal(true)}>
              <Plus className="mr-2 h-4 w-4" />
              New Application
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <Card className="w-full max-w-lg mx-4">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>New Application</CardTitle>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => { setShowCreateModal(false); resetForm() }}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
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
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
