"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { trpc } from "@/components/trpc-provider"
import { formatDateTime } from "@/lib/utils"
import { toast } from "sonner"
import {
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  Loader2,
  Terminal,
  Rocket,
  Search,
  ChevronDown,
  ChevronRight,
  GitBranch,
  Container,
  Timer,
  RefreshCw,
  RotateCcw,
} from "lucide-react"

const getStatusColor = (status: string) => {
  const colors: Record<string, string> = {
    completed: "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-400",
    building: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-400",
    deploying: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-400",
    running: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-400",
    pending: "bg-gray-50 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
    failed: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400",
    cancelled: "bg-yellow-50 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-400",
  }
  return colors[status] || "bg-gray-50 text-gray-700"
}

const getStatusIcon = (status: string) => {
  switch (status) {
    case "completed":
      return <CheckCircle className="h-4 w-4 text-green-500" />
    case "building":
    case "deploying":
    case "running":
    case "pending":
      return <Clock className="h-4 w-4 text-blue-500 animate-pulse" />
    case "failed":
      return <XCircle className="h-4 w-4 text-red-500" />
    case "cancelled":
      return <AlertTriangle className="h-4 w-4 text-yellow-500" />
    default:
      return <Clock className="h-4 w-4 text-gray-400" />
  }
}

function formatDuration(seconds: number | null) {
  if (seconds === null || seconds === undefined) return "—"
  if (seconds < 60) return `${seconds}s`
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}m ${secs}s`
}

function timeAgo(date: string | Date) {
  const now = new Date()
  const d = new Date(date)
  const diffMs = now.getTime() - d.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  if (diffMins < 1) return "just now"
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHrs = Math.floor(diffMins / 60)
  if (diffHrs < 24) return `${diffHrs}h ago`
  const diffDays = Math.floor(diffHrs / 24)
  return `${diffDays}d ago`
}

export default function DeploymentsPage() {
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined)
  const [timeRange, setTimeRange] = useState<"24h" | "7d" | "30d" | "all">("all")
  const [search, setSearch] = useState("")
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const limit = 20

  const utils = trpc.useUtils()
  const rollbackMutation = trpc.deployment.rollback.useMutation({
    onSuccess: () => {
      toast.success("Rollback started! Container will be replaced shortly.")
      deploymentsQuery.refetch()
    },
    onError: (err) => {
      toast.error(`Rollback failed: ${err.message}`)
    },
  })

  const deploymentsQuery = trpc.deployment.listAll.useQuery(
    {
      limit,
      offset: page * limit,
      status: statusFilter as any,
      timeRange,
    },
    { refetchInterval: 15000 }
  )

  const data = deploymentsQuery.data
  const allDeployments = data?.deployments ?? []
  const total = data?.total ?? 0

  // Client-side search filter
  const filteredDeployments = search
    ? allDeployments.filter(
        (d: any) =>
          d.application?.appName?.toLowerCase().includes(search.toLowerCase()) ||
          d.application?.name?.toLowerCase().includes(search.toLowerCase()) ||
          d.gitCommitSha?.toLowerCase().includes(search.toLowerCase())
      )
    : allDeployments

  const statusFilters = [
    { label: "All", value: undefined },
    { label: "Completed", value: "completed" },
    { label: "Building", value: "building" },
    { label: "Failed", value: "failed" },
    { label: "Cancelled", value: "cancelled" },
  ]

  const timeFilters = [
    { label: "All Time", value: "all" as const },
    { label: "Last 24h", value: "24h" as const },
    { label: "Last 7d", value: "7d" as const },
    { label: "Last 30d", value: "30d" as const },
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-3">
          <Rocket className="h-8 w-8" />
          Deployments
        </h1>
        <p className="text-muted-foreground mt-1">
          View deployment history across all your applications
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Status filter */}
        <div className="flex gap-1">
          {statusFilters.map((f) => (
            <Button
              key={f.label}
              variant={statusFilter === f.value ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setStatusFilter(f.value)
                setPage(0)
              }}
            >
              {f.label}
            </Button>
          ))}
        </div>

        <div className="h-6 w-px bg-border" />

        {/* Time range filter */}
        <div className="flex gap-1">
          {timeFilters.map((f) => (
            <Button
              key={f.value}
              variant={timeRange === f.value ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setTimeRange(f.value)
                setPage(0)
              }}
            >
              {f.label}
            </Button>
          ))}
        </div>

        <div className="flex-1" />

        {/* Search */}
        <div className="relative w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by app name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Refresh */}
        <Button
          variant="outline"
          size="icon"
          onClick={() => deploymentsQuery.refetch()}
          disabled={deploymentsQuery.isRefetching}
        >
          <RefreshCw className={`h-4 w-4 ${deploymentsQuery.isRefetching ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Deployment List */}
      {deploymentsQuery.isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : filteredDeployments.length === 0 ? (
        <Card className="text-center py-12">
          <CardContent>
            <Rocket className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
            <h3 className="text-lg font-semibold mb-2">No deployments found</h3>
            <p className="text-muted-foreground">
              {statusFilter
                ? `No ${statusFilter} deployments. Try changing your filters.`
                : "Deploy your first application to see deployment history here."
              }
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {/* Table header */}
          <div className="grid grid-cols-[32px_1fr_120px_140px_80px_100px_80px] gap-3 px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
            <div></div>
            <div>Application</div>
            <div>Status</div>
            <div>Commit / Source</div>
            <div>Duration</div>
            <div>Time</div>
            <div></div>
          </div>

          {/* Deployment rows */}
          {filteredDeployments.map((deploy: any) => (
            <div key={deploy.id}>
              <Card
                className={`cursor-pointer transition-colors hover:bg-accent/50 ${
                  expandedId === deploy.id ? "ring-1 ring-primary" : ""
                }`}
                onClick={() => setExpandedId(expandedId === deploy.id ? null : deploy.id)}
              >
                <CardContent className="py-3 px-4">
                  <div className="grid grid-cols-[32px_1fr_120px_140px_80px_100px_80px] gap-3 items-center">
                    {/* Expand icon */}
                    <div className="text-muted-foreground">
                      {expandedId === deploy.id ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                    </div>

                    {/* Application */}
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        {deploy.application?.appName || "Unknown"}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {deploy.application?.project?.name || ""}
                      </p>
                    </div>

                    {/* Status */}
                    <div className="flex items-center gap-2">
                      {getStatusIcon(deploy.status)}
                      <Badge variant="outline" className={`text-xs ${getStatusColor(deploy.status)}`}>
                        {deploy.status}
                      </Badge>
                    </div>

                    {/* Commit / Source */}
                    <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                      {deploy.gitCommitSha ? (
                        <>
                          <GitBranch className="h-3 w-3 flex-shrink-0" />
                          <span className="font-mono">{deploy.gitCommitSha.slice(0, 8)}</span>
                        </>
                      ) : (
                        <>
                          <Container className="h-3 w-3 flex-shrink-0" />
                          <span>Docker</span>
                        </>
                      )}
                    </div>

                    {/* Duration */}
                    <div className="text-xs text-muted-foreground flex items-center gap-1">
                      <Timer className="h-3 w-3" />
                      {formatDuration(deploy.duration)}
                    </div>

                    {/* Time */}
                    <div className="text-xs text-muted-foreground">
                      {timeAgo(deploy.createdAt)}
                    </div>

                    {/* Actions */}
                    <div className="text-right">
                      {deploy.status === "completed" && deploy.imageTag && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs gap-1"
                          disabled={rollbackMutation.isPending}
                          onClick={(e) => {
                            e.stopPropagation()
                            if (confirm(`Roll back to deployment from ${timeAgo(deploy.createdAt)}?`)) {
                              rollbackMutation.mutate({ deploymentId: deploy.id })
                            }
                          }}
                        >
                          <RotateCcw className="h-3 w-3" />
                          Rollback
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Expanded build logs */}
              {expandedId === deploy.id && (
                <Card className="ml-8 mt-1 border-l-2 border-primary">
                  <CardHeader className="py-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Terminal className="h-4 w-4" />
                      Build Logs
                      {deploy.title && (
                        <span className="text-muted-foreground font-normal">— {deploy.title}</span>
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="bg-gray-950 text-green-400 rounded-lg p-3 font-mono text-xs max-h-64 overflow-y-auto whitespace-pre-wrap">
                      {deploy.buildLogs ? (
                        deploy.buildLogs.split("\n").map((line: string, i: number) => (
                          <div
                            key={i}
                            className={`py-0.5 ${
                              line.startsWith("ERROR") || line.includes("error")
                                ? "text-red-400"
                                : line.startsWith("Step") || line.startsWith("---")
                                ? "text-blue-400"
                                : line.startsWith("Successfully") || line.includes("completed")
                                ? "text-green-400"
                                : ""
                            }`}
                          >
                            {line}
                          </div>
                        ))
                      ) : (
                        <p className="text-gray-500">No build logs available</p>
                      )}
                    </div>
                    {deploy.deploymentLogs && (
                      <div className="mt-3 bg-gray-950 text-cyan-400 rounded-lg p-3 font-mono text-xs max-h-32 overflow-y-auto">
                        <p className="text-gray-500 mb-1">Deployment Info:</p>
                        {deploy.deploymentLogs.split("\n").map((line: string, i: number) => (
                          <div key={i}>{line}</div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {total > limit && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {page * limit + 1}–{Math.min((page + 1) * limit, total)} of {total} deployments
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={(page + 1) * limit >= total}
              onClick={() => setPage(page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
