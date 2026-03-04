"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { trpc } from "@/components/trpc-provider"
import { formatDateTime } from "@/lib/utils"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  ArrowLeft,
  Rocket,
  RefreshCw,
  Trash2,
  ExternalLink,
  Container,
  GitBranch,
  Clock,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Loader2,
  Terminal,
  Activity,
  Cpu,
  HardDrive,
  Wifi,
  Plus,
  Key,
  Globe,
  Eye,
  EyeOff,
  Copy,
  Shield,
  Link2,
  Radio,
  RotateCcw,
  Webhook,
  Send,
  ChevronDown,
  ChevronRight,
} from "lucide-react"
import { useDeploymentStream } from "@/hooks/useDeploymentStream"
import { ConfirmDialog, useConfirmDialog } from "@/components/ui/confirm-dialog"
import { AppDetailSkeleton } from "@/components/skeletons/app-detail-skeleton"
import { DeployStepper } from "@/components/deploy-stepper"

const getStatusColor = (status: string) => {
  const colors: Record<string, string> = {
    running: "bg-green-50 text-green-700",
    completed: "bg-green-50 text-green-700",
    deploying: "bg-blue-50 text-blue-700",
    building: "bg-blue-50 text-blue-700",
    failed: "bg-red-50 text-red-700",
    stopped: "bg-yellow-50 text-yellow-700",
    pending: "bg-gray-50 text-gray-700",
  }
  return colors[status] || "bg-gray-50 text-gray-700"
}

const getStatusIcon = (status: string) => {
  switch (status) {
    case "running":
    case "completed":
      return <CheckCircle className="h-4 w-4 text-green-500" />
    case "deploying":
    case "building":
    case "pending":
      return <Clock className="h-4 w-4 text-blue-500 animate-pulse" />
    case "failed":
      return <XCircle className="h-4 w-4 text-red-500" />
    default:
      return <AlertTriangle className="h-4 w-4 text-yellow-500" />
  }
}

export default function ApplicationDetailPage() {
  const params = useParams()
  const router = useRouter()
  const appId = params.id as string
  const [selectedDeployment, setSelectedDeployment] = useState<string | null>(null)
  const { confirm: showConfirm, dialogProps: confirmDialogProps } = useConfirmDialog()

  // Env var state
  const [newEnvKey, setNewEnvKey] = useState("")
  const [newEnvValue, setNewEnvValue] = useState("")
  const [newEnvSecret, setNewEnvSecret] = useState(false)
  const [envScope, setEnvScope] = useState<"production" | "preview" | "development">("production")
  const [showSecrets, setShowSecrets] = useState(false)

  // Domain state
  const [newDomain, setNewDomain] = useState("")

  // Build log streaming state
  const [followLogs, setFollowLogs] = useState(true)
  const [activeTab, setActiveTab] = useState("deployments")
  const buildLogsRef = useRef<HTMLDivElement>(null)

  // UUID validation
  const isValidUUID = (s: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
  const validAppId = isValidUUID(appId)

  // Queries — reduced polling frequency to avoid excessive API calls
  const appQuery = trpc.application.getById.useQuery(
    { id: appId },
    { enabled: validAppId, refetchInterval: 15000 }  // 15s (was 5s)
  )

  const logsQuery = trpc.application.getLogs.useQuery(
    { id: appId, lines: 50 },
    { enabled: validAppId, refetchInterval: 30000 }  // 30s (was 10s)
  )

  const metricsQuery = trpc.application.getMetrics.useQuery(
    { id: appId },
    { enabled: validAppId, refetchInterval: 30000 }  // 30s (was 15s)
  )

  const utils = trpc.useUtils()

  // Mutations
  const deployApp = trpc.application.deploy.useMutation({
    onSuccess: (data) => {
      toast.success("Deployment started!")
      // Clear previous stream and immediately connect to the new deployment's WS
      deploymentStream.clearLogs()
      setStreamingDeploymentId(data.id)
      utils.application.getById.invalidate()
      // Auto-switch to build logs tab
      setActiveTab("build-logs")
      setFollowLogs(true)
    },
    onError: (err) => toast.error(err.message),
  })

  const restartApp = trpc.application.restart.useMutation({
    onSuccess: () => {
      toast.success("Application restarted!")
      utils.application.getById.invalidate()
    },
    onError: (err) => toast.error(err.message),
  })

  const deleteApp = trpc.application.delete.useMutation({
    onSuccess: () => {
      toast.success("Application deleted!")
      router.push("/dashboard/applications")
    },
    onError: (err) => toast.error(err.message),
  })

  const rollbackMutation = trpc.deployment.rollback.useMutation({
    onSuccess: () => {
      toast.success("Rollback started!")
      utils.application.getById.invalidate()
      deploymentStream.clearLogs()
      setActiveTab("build-logs")
      setFollowLogs(true)
    },
    onError: (err) => toast.error(`Rollback failed: ${err.message}`),
  })

  const updatePreviewSettings = trpc.application.updatePreviewSettings.useMutation({
    onSuccess: () => {
      toast.success("Preview settings updated!")
      utils.application.getById.invalidate()
    },
    onError: (err) => toast.error(err.message),
  })

  // Webhooks
  const webhookUrlQuery = trpc.webhook.getWebhookUrl.useQuery(
    { applicationId: appId },
    { enabled: validAppId }
  )

  const webhookDeliveriesQuery = trpc.webhook.listDeliveries.useQuery(
    { applicationId: appId, limit: 20 },
    { enabled: validAppId && activeTab === "webhooks", refetchInterval: 30000 }
  )

  const sendTestWebhook = trpc.webhook.sendTestWebhook.useMutation({
    onSuccess: () => {
      toast.success("Test webhook sent! A deployment will be triggered.")
      utils.webhook.listDeliveries.invalidate()
      utils.application.getById.invalidate()
    },
    onError: (err) => toast.error(err.message),
  })

  const [expandedDeliveryId, setExpandedDeliveryId] = useState<string | null>(null)
  const [copiedField, setCopiedField] = useState<string | null>(null)

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text)
    setCopiedField(field)
    toast.success("Copied to clipboard!")
    setTimeout(() => setCopiedField(null), 2000)
  }

  // Environment Variables
  const envVarsQuery = trpc.environment.list.useQuery(
    { applicationId: appId, scope: envScope },
    { enabled: !!appId }
  )

  const setEnvVar = trpc.environment.set.useMutation({
    onSuccess: () => {
      toast.success("Environment variable saved!")
      setNewEnvKey("")
      setNewEnvValue("")
      setNewEnvSecret(false)
      utils.environment.list.invalidate()
    },
    onError: (err) => toast.error(err.message),
  })

  const deleteEnvVar = trpc.environment.delete.useMutation({
    onSuccess: () => {
      toast.success("Variable deleted")
      utils.environment.list.invalidate()
    },
    onError: (err) => toast.error(err.message),
  })

  // Domains
  const domainsQuery = trpc.domain.list.useQuery(
    { applicationId: appId },
    { enabled: !!appId }
  )

  const addDomain = trpc.domain.add.useMutation({
    onSuccess: () => {
      toast.success("Domain added!")
      setNewDomain("")
      utils.domain.list.invalidate()
    },
    onError: (err) => toast.error(err.message),
  })

  const removeDomain = trpc.domain.remove.useMutation({
    onSuccess: () => {
      toast.success("Domain removed")
      utils.domain.list.invalidate()
    },
    onError: (err) => toast.error(err.message),
  })

  const verifyDomain = trpc.domain.verify.useMutation({
    onSuccess: () => {
      toast.success("Domain verified!")
      utils.domain.list.invalidate()
    },
    onError: (err) => toast.error(err.message),
  })

  const setPrimaryDomain = trpc.domain.setPrimary.useMutation({
    onSuccess: () => {
      toast.success("Primary domain updated")
      utils.domain.list.invalidate()
    },
    onError: (err) => toast.error(err.message),
  })

  const generateAutoUrl = trpc.domain.generateAutoUrl.useMutation({
    onSuccess: () => {
      toast.success("Auto URL generated!")
      utils.domain.list.invalidate()
    },
    onError: (err) => toast.error(err.message),
  })

  const envVars = envVarsQuery.data ?? []
  const appDomains = domainsQuery.data ?? []

  const app = appQuery.data
  const deploymentsList = (app as any)?.deployments ?? []
  const logs = logsQuery.data ?? []
  const metrics = metricsQuery.data

  // Determine if the latest deployment is in-progress (for live streaming)
  const latestDeployment = deploymentsList[0]
  const isDeploymentActive = latestDeployment &&
    ["pending", "building", "deploying", "running"].includes(latestDeployment.status)
  const activeDeploymentId = isDeploymentActive ? latestDeployment.id : null

  // Track the streaming deployment ID so stepper/logs persist after completion.
  // Set when a deployment becomes active; cleared only when a NEW deploy starts.
  const [streamingDeploymentId, setStreamingDeploymentId] = useState<string | null>(null)
  useEffect(() => {
    if (activeDeploymentId && activeDeploymentId !== streamingDeploymentId) {
      setStreamingDeploymentId(activeDeploymentId)
    }
  }, [activeDeploymentId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Real-time build log streaming via WebSocket.
  // WS stays connected persistently so it's ready when a deploy fires.
  // The deploymentId controls which events are processed (not whether WS connects).
  const deploymentStream = useDeploymentStream({
    deploymentId: streamingDeploymentId,
    enabled: true,
  })

  // Auto-scroll build logs when following
  useEffect(() => {
    if (followLogs && buildLogsRef.current) {
      buildLogsRef.current.scrollTop = buildLogsRef.current.scrollHeight
    }
  }, [deploymentStream.logs, followLogs])

  // When stream reports deployment completed/failed, refetch app data
  useEffect(() => {
    if (deploymentStream.status === "completed" || deploymentStream.status === "failed") {
      utils.application.getById.invalidate()
    }
  }, [deploymentStream.status]) // eslint-disable-line react-hooks/exhaustive-deps

  if (appQuery.isLoading) {
    return <AppDetailSkeleton />
  }

  if (!app) {
    return (
      <div className="text-center py-20">
        <h2 className="text-xl font-semibold mb-2">Application not found</h2>
        <Link href="/dashboard/applications">
          <Button variant="outline">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Applications
          </Button>
        </Link>
      </div>
    )
  }

  const selectedDeploy = selectedDeployment
    ? deploymentsList.find((d: any) => d.id === selectedDeployment)
    : deploymentsList[0]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/dashboard/applications">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold">{app.appName}</h1>
            <Badge variant="outline" className={getStatusColor(app.status)}>
              {app.status}
            </Badge>
          </div>
          <p className="text-muted-foreground">
            {app.sourceType === "docker"
              ? `Docker: ${app.dockerImage}:${app.dockerTag || "latest"}`
              : app.repository || "No source configured"
            }
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => deployApp.mutate({ id: appId })}
            disabled={deployApp.isLoading}
          >
            {deployApp.isLoading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Rocket className="mr-2 h-4 w-4" />
            )}
            Deploy
          </Button>
          <Button
            variant="outline"
            onClick={() => restartApp.mutate({ id: appId })}
            disabled={restartApp.isLoading}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Restart
          </Button>
          <Button
            variant="outline"
            className="text-red-600"
            onClick={() => {
              showConfirm({
                title: `Delete "${app.appName}"?`,
                description: "This will permanently stop and remove the container. This action cannot be undone.",
                confirmLabel: "Delete",
                variant: "danger",
                onConfirm: () => deleteApp.mutate({ id: appId }),
              })
            }}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete
          </Button>
        </div>
      </div>

      {/* Metrics Cards */}
      {metrics && (
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Status</CardTitle>
              <Activity className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                {getStatusIcon(metrics.status)}
                <span className="text-lg font-bold capitalize">{metrics.status}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">CPU Usage</CardTitle>
              <Cpu className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {typeof metrics.cpu?.current === 'number' ? `${metrics.cpu.current.toFixed(1)}%` : 'N/A'}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Memory</CardTitle>
              <HardDrive className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {typeof metrics.memory?.current === 'number' ? `${metrics.memory.current.toFixed(1)} MB` : 'N/A'}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Network</CardTitle>
              <Wifi className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {typeof metrics.network?.rxBytes === 'number'
                  ? `${(metrics.network.rxBytes / 1024).toFixed(0)} KB`
                  : 'N/A'
                }
              </div>
              <p className="text-xs text-muted-foreground">received</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="deployments">Deployments</TabsTrigger>
          <TabsTrigger value="preview">Preview</TabsTrigger>
          <TabsTrigger value="env-vars">Environment</TabsTrigger>
          <TabsTrigger value="domains">Domains</TabsTrigger>
          <TabsTrigger value="logs">Container Logs</TabsTrigger>
          <TabsTrigger value="build-logs">Build Logs</TabsTrigger>
          <TabsTrigger value="webhooks">Webhooks</TabsTrigger>
        </TabsList>

        {/* Deployments Tab */}
        <TabsContent value="deployments" className="space-y-4">
          {deploymentsList.length === 0 ? (
            <Card className="text-center py-8">
              <CardContent>
                <p className="text-muted-foreground mb-3">No deployments yet</p>
                <Button onClick={() => deployApp.mutate({ id: appId })}>
                  <Rocket className="mr-2 h-4 w-4" />
                  Deploy Now
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {deploymentsList.map((deploy: any) => (
                <Card
                  key={deploy.id}
                  className={`cursor-pointer transition-colors ${
                    selectedDeploy?.id === deploy.id ? "ring-2 ring-primary" : "hover:bg-accent/50"
                  }`}
                  onClick={() => setSelectedDeployment(deploy.id)}
                >
                  <CardContent className="py-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {getStatusIcon(deploy.status)}
                        <div>
                          <p className="text-sm font-medium">
                            {deploy.gitCommitSha
                              ? `Commit ${deploy.gitCommitSha.slice(0, 8)}`
                              : `Deployment`
                            }
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {formatDateTime(deploy.createdAt)}
                            {deploy.completedAt && (
                              <span className="ml-2">
                                ({Math.round((new Date(deploy.completedAt).getTime() - new Date(deploy.createdAt).getTime()) / 1000)}s)
                              </span>
                            )}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {deploy.status === "completed" && deploy.imageTag && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs gap-1"
                            disabled={rollbackMutation.isPending}
                            onClick={(e) => {
                              e.stopPropagation()
                              showConfirm({
                                title: "Roll back to this deployment?",
                                description: "This will redeploy the previous version. The current deployment will be replaced.",
                                confirmLabel: "Roll Back",
                                variant: "warning",
                                onConfirm: () => rollbackMutation.mutate({ deploymentId: deploy.id }),
                              })
                            }}
                          >
                            <RotateCcw className="h-3 w-3" />
                            Rollback
                          </Button>
                        )}
                        <Badge variant="outline" className={getStatusColor(deploy.status)}>
                          {deploy.deploymentType === "rollback" ? "rollback" : deploy.status}
                        </Badge>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Preview Deployments Tab */}
        <TabsContent value="preview" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <GitBranch className="h-4 w-4" />
                    Preview Deployments
                  </CardTitle>
                  <CardDescription>
                    Automatically deploy feature branches for review without affecting production
                  </CardDescription>
                </div>
                <Button
                  variant={app?.previewDeployments ? "default" : "outline"}
                  size="sm"
                  onClick={() => {
                    if (!app) return
                    updatePreviewSettings.mutate({
                      id: appId,
                      previewDeployments: !app.previewDeployments,
                    })
                  }}
                  disabled={updatePreviewSettings.isPending}
                >
                  {app?.previewDeployments ? "Enabled" : "Disabled"}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {app?.sourceType === "docker" ? (
                <div className="text-sm text-muted-foreground bg-muted/50 p-4 rounded-lg">
                  Preview deployments are only available for Git-based applications.
                  Docker image apps deploy the same image for all environments.
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Main Branch</Label>
                      <p className="text-sm text-muted-foreground mt-1">
                        Pushes to this branch trigger production deployments.
                        All other branches create preview deployments.
                      </p>
                      <Input
                        className="mt-2"
                        value={app?.mainBranch || "main"}
                        onChange={(e) => {
                          updatePreviewSettings.mutate({
                            id: appId,
                            previewDeployments: app?.previewDeployments ?? false,
                            mainBranch: e.target.value,
                          })
                        }}
                        placeholder="main"
                      />
                    </div>
                    <div>
                      <Label>Preview TTL (hours)</Label>
                      <p className="text-sm text-muted-foreground mt-1">
                        Preview containers are automatically cleaned up after this time.
                      </p>
                      <Input
                        className="mt-2"
                        type="number"
                        value={app?.previewTtlHours || 72}
                        onChange={(e) => {
                          updatePreviewSettings.mutate({
                            id: appId,
                            previewDeployments: app?.previewDeployments ?? false,
                            previewTtlHours: parseInt(e.target.value) || 72,
                          })
                        }}
                        placeholder="72"
                      />
                    </div>
                  </div>

                  {/* Active Preview Deployments */}
                  <div className="pt-4 border-t">
                    <h4 className="text-sm font-medium mb-3">Active Previews</h4>
                    {deploymentsList.filter((d: any) => d.isPreview && d.status === "completed").length === 0 ? (
                      <div className="text-sm text-muted-foreground bg-muted/50 p-4 rounded-lg text-center">
                        No active preview deployments. Push to a feature branch to create one.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {deploymentsList
                          .filter((d: any) => d.isPreview && d.status === "completed")
                          .map((d: any) => (
                            <Card key={d.id}>
                              <CardContent className="py-3 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                  <GitBranch className="h-4 w-4 text-purple-500" />
                                  <div>
                                    <p className="text-sm font-medium">{d.previewBranch || "unknown"}</p>
                                    <p className="text-xs text-muted-foreground">
                                      {formatDateTime(d.createdAt)}
                                    </p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <Badge variant="outline" className="bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-400">
                                    preview
                                  </Badge>
                                  {d.deploymentLogs?.match(/URL: (http[^\s]+)/) && (
                                    <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" asChild>
                                      <a href={d.deploymentLogs.match(/URL: (http[^\s]+)/)?.[1]} target="_blank" rel="noopener">
                                        <ExternalLink className="h-3 w-3" />
                                        Open
                                      </a>
                                    </Button>
                                  )}
                                </div>
                              </CardContent>
                            </Card>
                          ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Environment Variables Tab */}
        <TabsContent value="env-vars" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Key className="h-4 w-4" />
                    Environment Variables
                  </CardTitle>
                  <CardDescription>
                    Manage environment variables injected into your application at deploy time
                  </CardDescription>
                </div>
                <div className="flex gap-2">
                  {(["production", "preview", "development"] as const).map((scope) => (
                    <Button
                      key={scope}
                      variant={envScope === scope ? "default" : "outline"}
                      size="sm"
                      onClick={() => setEnvScope(scope)}
                    >
                      {scope.charAt(0).toUpperCase() + scope.slice(1)}
                    </Button>
                  ))}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Existing Variables */}
              {envVars.length > 0 && (
                <div className="space-y-2">
                  {envVars.map((envVar: any) => (
                    <div
                      key={envVar.id}
                      className="flex items-center gap-3 p-3 rounded-lg border bg-muted/50"
                    >
                      <code className="text-sm font-semibold min-w-[180px]">
                        {envVar.key}
                      </code>
                      <div className="flex-1 flex items-center gap-2">
                        <code className="text-sm text-muted-foreground">
                          {envVar.isSecret && !showSecrets
                            ? "••••••••••••"
                            : envVar.value}
                        </code>
                        {envVar.isSecret && (
                          <Shield className="h-3 w-3 text-yellow-500" />
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-red-500"
                        onClick={() =>
                          deleteEnvVar.mutate({
                            id: envVar.id,
                            applicationId: appId,
                          })
                        }
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              {envVars.length === 0 && (
                <div className="text-center py-6 text-muted-foreground">
                  <Key className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>No environment variables for {envScope}</p>
                </div>
              )}

              {/* Show/Hide secrets toggle */}
              {envVars.some((v: any) => v.isSecret) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowSecrets(!showSecrets)}
                >
                  {showSecrets ? (
                    <EyeOff className="mr-2 h-3 w-3" />
                  ) : (
                    <Eye className="mr-2 h-3 w-3" />
                  )}
                  {showSecrets ? "Hide" : "Show"} secret values
                </Button>
              )}

              {/* Add new variable form */}
              <div className="border-t pt-4">
                <p className="text-sm font-medium mb-3">Add Variable</p>
                <div className="flex gap-3">
                  <div className="flex-1">
                    <Input
                      placeholder="KEY"
                      value={newEnvKey}
                      onChange={(e) => setNewEnvKey(e.target.value.toUpperCase())}
                      className="font-mono"
                    />
                  </div>
                  <div className="flex-[2]">
                    <Input
                      placeholder="value"
                      value={newEnvValue}
                      onChange={(e) => setNewEnvValue(e.target.value)}
                      type={newEnvSecret ? "password" : "text"}
                      className="font-mono"
                    />
                  </div>
                  <Button
                    variant={newEnvSecret ? "default" : "outline"}
                    size="icon"
                    onClick={() => setNewEnvSecret(!newEnvSecret)}
                    title={newEnvSecret ? "Secret (encrypted)" : "Plain text"}
                  >
                    <Shield className="h-4 w-4" />
                  </Button>
                  <Button
                    onClick={() => {
                      if (!newEnvKey || !newEnvValue) {
                        toast.error("Key and value are required")
                        return
                      }
                      setEnvVar.mutate({
                        applicationId: appId,
                        key: newEnvKey,
                        value: newEnvValue,
                        scope: envScope,
                        isSecret: newEnvSecret,
                      })
                    }}
                    disabled={setEnvVar.isLoading}
                  >
                    {setEnvVar.isLoading ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Plus className="mr-2 h-4 w-4" />
                    )}
                    Add
                  </Button>
                </div>
              </div>

              <p className="text-xs text-muted-foreground mt-2">
                Variables are injected on the next deploy. Secrets are encrypted at rest.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Domains Tab */}
        <TabsContent value="domains" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Globe className="h-4 w-4" />
                    Domains
                  </CardTitle>
                  <CardDescription>
                    Custom domains and auto-generated URLs for your application
                  </CardDescription>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => generateAutoUrl.mutate({ applicationId: appId })}
                  disabled={generateAutoUrl.isLoading}
                >
                  {generateAutoUrl.isLoading ? (
                    <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                  ) : (
                    <Link2 className="mr-2 h-3 w-3" />
                  )}
                  Generate Auto URL
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Existing Domains */}
              {appDomains.length > 0 ? (
                <div className="space-y-3">
                  {appDomains.map((domain: any) => (
                    <div
                      key={domain.id}
                      className="flex items-center gap-3 p-3 rounded-lg border"
                    >
                      <Globe className="h-4 w-4 text-muted-foreground" />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <code className="text-sm font-semibold">
                            {domain.domain}
                          </code>
                          {domain.isPrimary && (
                            <Badge variant="default" className="text-xs">Primary</Badge>
                          )}
                          {domain.isAutoGenerated && (
                            <Badge variant="outline" className="text-xs">Auto</Badge>
                          )}
                          {/* SSL indicator for non-localhost domains */}
                          {domain.verified && !domain.isAutoGenerated && !domain.domain.endsWith('.localhost') && (
                            <Badge variant="outline" className="text-xs bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
                              <Shield className="h-2.5 w-2.5 mr-0.5" />
                              SSL
                            </Badge>
                          )}
                          <Badge
                            variant="outline"
                            className={
                              domain.status === "active"
                                ? "bg-green-50 text-green-700"
                                : domain.status === "pending"
                                ? "bg-yellow-50 text-yellow-700"
                                : "bg-red-50 text-red-700"
                            }
                          >
                            {domain.verified ? "Verified" : domain.status}
                          </Badge>
                        </div>
                        {!domain.verified && !domain.isAutoGenerated && (
                          <p className="text-xs text-muted-foreground mt-1">
                            Add a CNAME record: <code>_gs-verify.{domain.domain}</code> → <code>{domain.verificationToken}</code>
                          </p>
                        )}
                      </div>
                      <div className="flex gap-1">
                        {!domain.verified && !domain.isAutoGenerated && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              verifyDomain.mutate({
                                id: domain.id,
                                applicationId: appId,
                              })
                            }
                            disabled={verifyDomain.isLoading}
                          >
                            Verify
                          </Button>
                        )}
                        {!domain.isPrimary && domain.verified && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              setPrimaryDomain.mutate({
                                id: domain.id,
                                applicationId: appId,
                              })
                            }
                          >
                            Set Primary
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-red-500"
                          onClick={() =>
                            removeDomain.mutate({
                              id: domain.id,
                              applicationId: appId,
                            })
                          }
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-6 text-muted-foreground">
                  <Globe className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>No domains configured</p>
                  <p className="text-xs mt-1">Add a custom domain or generate an auto URL</p>
                </div>
              )}

              {/* Add custom domain form */}
              <div className="border-t pt-4">
                <p className="text-sm font-medium mb-3">Add Custom Domain</p>
                <div className="flex gap-3">
                  <div className="flex-1">
                    <Input
                      placeholder="myapp.example.com"
                      value={newDomain}
                      onChange={(e) => setNewDomain(e.target.value)}
                    />
                  </div>
                  <Button
                    onClick={() => {
                      if (!newDomain) {
                        toast.error("Domain is required")
                        return
                      }
                      addDomain.mutate({
                        applicationId: appId,
                        domain: newDomain,
                        isPrimary: appDomains.length === 0,
                      })
                    }}
                    disabled={addDomain.isLoading}
                  >
                    {addDomain.isLoading ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Plus className="mr-2 h-4 w-4" />
                    )}
                    Add Domain
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Container Logs Tab */}
        <TabsContent value="logs">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Terminal className="h-4 w-4" />
                  Container Logs
                </CardTitle>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => logsQuery.refetch()}
                >
                  <RefreshCw className="mr-2 h-3 w-3" />
                  Refresh
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="bg-gray-950 text-green-400 rounded-lg p-4 font-mono text-xs max-h-96 overflow-y-auto">
                {logs.length === 0 ? (
                  <p className="text-gray-500">No logs available. Container may not be running.</p>
                ) : (
                  logs.map((log: any, i: number) => (
                    <div key={i} className="py-0.5">
                      <span className="text-gray-500 mr-2">
                        {log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : ''}
                      </span>
                      <span className={
                        log.level === 'error' ? 'text-red-400' :
                        log.level === 'warn' ? 'text-yellow-400' : ''
                      }>
                        {log.message}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Build Logs Tab */}
        <TabsContent value="build-logs">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Terminal className="h-4 w-4" />
                    Build Logs
                    {streamingDeploymentId && deploymentStream.isConnected && (
                      <span className="flex items-center gap-1.5 text-xs font-normal text-green-500">
                        <Radio className="h-3 w-3 animate-pulse" />
                        Live
                      </span>
                    )}
                    {(deploymentStream.status || selectedDeploy) && (
                      <Badge variant="outline" className={getStatusColor(
                        deploymentStream.status || selectedDeploy?.status || ""
                      )}>
                        {deploymentStream.status || selectedDeploy?.status}
                      </Badge>
                    )}
                  </CardTitle>
                  <CardDescription>
                    {streamingDeploymentId && deploymentStream.status
                      ? deploymentStream.status === "completed"
                        ? "Deployment completed successfully"
                        : deploymentStream.status === "failed"
                          ? "Deployment failed"
                          : "Streaming build output in real-time..."
                      : selectedDeploy
                        ? `Deployment from ${formatDateTime(selectedDeploy.createdAt)}`
                        : "Select a deployment to view build logs"
                    }
                  </CardDescription>
                </div>
                {streamingDeploymentId && (
                  <Button
                    variant={followLogs ? "default" : "outline"}
                    size="sm"
                    onClick={() => setFollowLogs(!followLogs)}
                  >
                    {followLogs ? "Following" : "Follow"}
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {/* Deployment phase stepper — persists after completion */}
              {deploymentStream.phases.length > 0 && (
                <DeployStepper
                  phases={deploymentStream.phases}
                  className="mb-4 p-4 rounded-lg border bg-card"
                />
              )}

              {/* Live streaming logs (persists after completion until next deploy) */}
              {streamingDeploymentId && deploymentStream.logs.length > 0 ? (
                <div
                  ref={buildLogsRef}
                  className="bg-gray-950 text-green-400 rounded-lg p-4 font-mono text-xs max-h-[500px] overflow-y-auto whitespace-pre-wrap"
                >
                  {deploymentStream.logs.map((log, i) => (
                    <div key={i} className={`py-0.5 ${
                      log.phase === "status" ? "text-cyan-400 font-semibold" :
                      log.message.startsWith("ERROR") || log.message.includes("error") ? "text-red-400" :
                      log.message.startsWith("Step") || log.message.startsWith("---") ? "text-blue-400" :
                      log.message.includes("Successfully") || log.message.startsWith("✅") ? "text-green-400" :
                      log.message.startsWith("❌") ? "text-red-400" :
                      log.message.startsWith("🔨") || log.message.startsWith("🚀") ? "text-yellow-400" : ""
                    }`}>
                      <span className="text-gray-600 mr-2 select-none">
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </span>
                      {log.message}
                    </div>
                  ))}
                  {deploymentStream.status && ["building", "deploying", "pending"].includes(deploymentStream.status) && (
                    <div className="py-0.5 text-gray-500 animate-pulse">
                      <span className="inline-block w-2 h-4 bg-green-500 animate-[blink_1s_infinite] mr-1">▊</span>
                    </div>
                  )}
                </div>
              ) : activeDeploymentId && deploymentStream.logs.length === 0 ? (
                <div className="bg-gray-950 text-gray-500 rounded-lg p-4 font-mono text-xs max-h-[500px] overflow-y-auto">
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Waiting for build output...
                  </div>
                </div>
              ) : (
                /* Static logs (for completed/failed deployments) */
                <div className="bg-gray-950 text-green-400 rounded-lg p-4 font-mono text-xs max-h-[500px] overflow-y-auto whitespace-pre-wrap">
                  {selectedDeploy?.buildLogs ? (
                    selectedDeploy.buildLogs.split("\n").map((line: string, i: number) => (
                      <div key={i} className={`py-0.5 ${
                        line.startsWith("ERROR") ? "text-red-400" :
                        line.startsWith("Step") || line.startsWith("---") ? "text-blue-400" :
                        line.startsWith("Successfully") ? "text-green-400" : ""
                      }`}>
                        {line}
                      </div>
                    ))
                  ) : (
                    <p className="text-gray-500">
                      {selectedDeploy ? "No build logs for this deployment" : "Select a deployment from the Deployments tab"}
                    </p>
                  )}
                </div>
              )}
              {/* Deployment info section (for completed deployments, when no stream active) */}
              {!streamingDeploymentId && selectedDeploy?.deploymentLogs && (
                <div className="mt-4 bg-gray-950 text-cyan-400 rounded-lg p-4 font-mono text-xs">
                  <p className="text-gray-500 mb-2">Deployment Info:</p>
                  {selectedDeploy.deploymentLogs.split("\n").map((line: string, i: number) => (
                    <div key={i}>{line}</div>
                  ))}
                </div>
              )}
              {/* Stream access URL after completion */}
              {deploymentStream.accessUrl && (
                <div className="mt-4 p-3 bg-green-950/30 border border-green-800/30 rounded-lg">
                  <p className="text-sm text-green-400 font-medium">Deployment URL:</p>
                  <a
                    href={deploymentStream.accessUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-blue-400 hover:underline flex items-center gap-1 mt-1"
                  >
                    {deploymentStream.accessUrl}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Webhooks Tab */}
        <TabsContent value="webhooks" className="space-y-4">
          {/* Webhook URL Section */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Webhook className="h-4 w-4" />
                    Webhook URLs
                  </CardTitle>
                  <CardDescription>
                    Configure your Git provider to send webhooks to these URLs to trigger automatic deployments
                  </CardDescription>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => sendTestWebhook.mutate({ applicationId: appId })}
                  disabled={sendTestWebhook.isPending}
                >
                  {sendTestWebhook.isPending ? (
                    <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                  ) : (
                    <Send className="mr-2 h-3 w-3" />
                  )}
                  Send Test Webhook
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {webhookUrlQuery.isLoading ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : webhookUrlQuery.data ? (
                <div className="space-y-3">
                  {/* GitHub */}
                  <div className="p-3 rounded-lg border bg-muted/30">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-sm font-medium flex items-center gap-2">
                        <GitBranch className="h-3.5 w-3.5" />
                        GitHub
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs gap-1"
                        onClick={() => copyToClipboard(webhookUrlQuery.data!.github, "github")}
                      >
                        {copiedField === "github" ? (
                          <CheckCircle className="h-3 w-3 text-green-500" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                        {copiedField === "github" ? "Copied" : "Copy"}
                      </Button>
                    </div>
                    <code className="text-xs text-muted-foreground break-all">
                      {webhookUrlQuery.data.github}
                    </code>
                    <p className="text-xs text-muted-foreground mt-2">
                      Go to your repo → Settings → Webhooks → Add webhook → Paste this URL.
                      Set content type to <code className="bg-muted px-1 rounded">application/json</code> and
                      select "Just the push event".
                    </p>
                  </div>

                  {/* GitLab */}
                  <div className="p-3 rounded-lg border bg-muted/30">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-sm font-medium flex items-center gap-2">
                        <GitBranch className="h-3.5 w-3.5" />
                        GitLab
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs gap-1"
                        onClick={() => copyToClipboard(webhookUrlQuery.data!.gitlab, "gitlab")}
                      >
                        {copiedField === "gitlab" ? (
                          <CheckCircle className="h-3 w-3 text-green-500" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                        {copiedField === "gitlab" ? "Copied" : "Copy"}
                      </Button>
                    </div>
                    <code className="text-xs text-muted-foreground break-all">
                      {webhookUrlQuery.data.gitlab}
                    </code>
                    <p className="text-xs text-muted-foreground mt-2">
                      Go to your project → Settings → Webhooks → Add webhook → Paste this URL.
                      Select "Push events" trigger.
                    </p>
                  </div>

                  {/* Generic Git */}
                  <div className="p-3 rounded-lg border bg-muted/30">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-sm font-medium flex items-center gap-2">
                        <Globe className="h-3.5 w-3.5" />
                        Generic (Bitbucket, Gitea, etc.)
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs gap-1"
                        onClick={() => copyToClipboard(webhookUrlQuery.data!.generic, "generic")}
                      >
                        {copiedField === "generic" ? (
                          <CheckCircle className="h-3 w-3 text-green-500" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                        {copiedField === "generic" ? "Copied" : "Copy"}
                      </Button>
                    </div>
                    <code className="text-xs text-muted-foreground break-all">
                      {webhookUrlQuery.data.generic}
                    </code>
                    <p className="text-xs text-muted-foreground mt-2">
                      Use this URL for any Git provider. Send a POST request with a JSON body
                      containing <code className="bg-muted px-1 rounded">repository</code>,{" "}
                      <code className="bg-muted px-1 rounded">branch</code>, and{" "}
                      <code className="bg-muted px-1 rounded">commit</code> fields.
                    </p>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Unable to load webhook URLs.</p>
              )}
            </CardContent>
          </Card>

          {/* Webhook Deliveries Section */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">Delivery History</CardTitle>
                  <CardDescription>
                    Recent webhook deliveries and their processing status
                  </CardDescription>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => webhookDeliveriesQuery.refetch()}
                  disabled={webhookDeliveriesQuery.isRefetching}
                >
                  <RefreshCw className={`h-3 w-3 mr-2 ${webhookDeliveriesQuery.isRefetching ? "animate-spin" : ""}`} />
                  Refresh
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {webhookDeliveriesQuery.isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : !webhookDeliveriesQuery.data || webhookDeliveriesQuery.data.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Webhook className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No webhook deliveries yet</p>
                  <p className="text-xs mt-1">
                    Configure your Git provider or send a test webhook to see delivery logs here.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {/* Table header */}
                  <div className="grid grid-cols-[24px_80px_100px_1fr_80px_100px] gap-3 px-3 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    <div></div>
                    <div>Status</div>
                    <div>Provider</div>
                    <div>Event</div>
                    <div>Duration</div>
                    <div>Time</div>
                  </div>
                  {webhookDeliveriesQuery.data.map((delivery: any) => (
                    <div key={delivery.id}>
                      <div
                        className={`grid grid-cols-[24px_80px_100px_1fr_80px_100px] gap-3 items-center px-3 py-2.5 rounded-lg border cursor-pointer hover:bg-accent/50 transition-colors ${
                          expandedDeliveryId === delivery.id ? "ring-1 ring-primary bg-accent/30" : ""
                        }`}
                        onClick={() => setExpandedDeliveryId(
                          expandedDeliveryId === delivery.id ? null : delivery.id
                        )}
                      >
                        <div className="text-muted-foreground">
                          {expandedDeliveryId === delivery.id ? (
                            <ChevronDown className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5" />
                          )}
                        </div>
                        <div>
                          {delivery.delivered ? (
                            <Badge variant="outline" className="bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-400 text-xs">
                              <CheckCircle className="h-3 w-3 mr-1" />
                              {delivery.statusCode || 200}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400 text-xs">
                              <XCircle className="h-3 w-3 mr-1" />
                              Error
                            </Badge>
                          )}
                        </div>
                        <div className="text-xs font-medium capitalize">{delivery.provider}</div>
                        <div className="text-xs text-muted-foreground">
                          {delivery.eventType || "push"}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {delivery.processingTimeMs ? `${delivery.processingTimeMs}ms` : "—"}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {(() => {
                            const d = new Date(delivery.createdAt)
                            const now = new Date()
                            const diffMs = now.getTime() - d.getTime()
                            const diffMins = Math.floor(diffMs / 60000)
                            if (diffMins < 1) return "just now"
                            if (diffMins < 60) return `${diffMins}m ago`
                            const diffHrs = Math.floor(diffMins / 60)
                            if (diffHrs < 24) return `${diffHrs}h ago`
                            return `${Math.floor(diffHrs / 24)}d ago`
                          })()}
                        </div>
                      </div>

                      {/* Expanded payload */}
                      {expandedDeliveryId === delivery.id && (
                        <div className="ml-6 mt-1 p-3 rounded-lg border-l-2 border-primary bg-muted/30">
                          {delivery.error && (
                            <div className="mb-3 p-2 rounded bg-red-950/30 border border-red-800/30">
                              <p className="text-xs text-red-400 font-medium">Error:</p>
                              <p className="text-xs text-red-300 mt-1">{delivery.error}</p>
                            </div>
                          )}
                          <div>
                            <p className="text-xs font-medium text-muted-foreground mb-1">Payload:</p>
                            <div className="bg-gray-950 text-green-400 rounded-lg p-3 font-mono text-xs max-h-48 overflow-y-auto whitespace-pre-wrap">
                              {delivery.payload
                                ? JSON.stringify(delivery.payload, null, 2)
                                : "No payload data"
                              }
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Confirm Dialog */}
      <ConfirmDialog {...confirmDialogProps} />
    </div>
  )
}
