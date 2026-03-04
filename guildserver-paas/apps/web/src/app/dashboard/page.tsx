"use client"

import Link from "next/link"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { trpc } from "@/components/trpc-provider"
import { useOrganization, useProjects } from "@/hooks/use-auth"
import {
  Rocket,
  Database,
  Users,
  Activity,
  Plus,
  CheckCircle,
  AlertTriangle,
  XCircle,
  Clock,
  GitBranch,
  Loader2,
  BarChart3,
} from "lucide-react"
import { DashboardSkeleton } from "@/components/skeletons/dashboard-skeleton"
import { EmptyState } from "@/components/empty-state"
import { AnimatedList, AnimatedItem } from "@/components/motion/animated-list"
import { FadeIn } from "@/components/motion/fade-in"
import { DeploymentActivity } from "@/components/charts/deployment-activity"

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
      return <Activity className="h-4 w-4 text-muted-foreground" />
  }
}

const getStatusBadge = (status: string) => {
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

const getHealthStatusIcon = (status: string) => {
  switch (status) {
    case "healthy":
      return <CheckCircle className="h-4 w-4 text-green-500" />
    case "warning":
      return <AlertTriangle className="h-4 w-4 text-yellow-500" />
    case "critical":
      return <XCircle className="h-4 w-4 text-red-500" />
    default:
      return <Clock className="h-4 w-4 text-muted-foreground" />
  }
}

const getHealthBadgeColor = (status: string) => {
  switch (status) {
    case "healthy":
      return "bg-green-50 text-green-700"
    case "warning":
      return "bg-yellow-50 text-yellow-700"
    case "critical":
      return "bg-red-50 text-red-700"
    default:
      return "bg-gray-50 text-gray-700"
  }
}

// Validate UUID format to prevent invalid API calls
const isValidUUID = (s: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)

export default function DashboardPage() {
  const { currentOrg, orgId, isLoading: orgLoading } = useOrganization()
  const { projects, projectId, isLoading: projLoading } = useProjects(orgId)

  // Real data queries - only fetch when we have valid UUIDs
  const appsQuery = trpc.application.list.useQuery(
    { projectId },
    { enabled: isValidUUID(projectId) }
  )

  // Real system health from Docker/API/WebSocket
  const healthQuery = trpc.monitoring.getSystemHealth.useQuery(
    { organizationId: orgId },
    {
      enabled: isValidUUID(orgId),
      refetchInterval: 30000, // Refresh every 30s
      retry: 1,
    }
  )

  // Get all apps for all projects
  const allApps = appsQuery.data ?? []
  const runningApps = allApps.filter((a: any) => a.status === "running")
  const failedApps = allApps.filter((a: any) => a.status === "failed")

  const isLoading = orgLoading || projLoading

  if (isLoading) {
    return <DashboardSkeleton />
  }

  // If no org exists, show onboarding prompt
  if (!currentOrg) {
    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold">Welcome to GuildServer</h1>
          <p className="text-muted-foreground">Let's get you set up</p>
        </div>
        <Card className="text-center py-12">
          <CardContent>
            <Rocket className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">Create your first organization</h3>
            <p className="text-muted-foreground mb-6">
              Organizations help you manage projects and team members
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

  const healthData = healthQuery.data
  const overallHealth = healthData?.overall ?? (failedApps.length === 0 ? "healthy" : "warning")

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground">
          {currentOrg.name} &mdash; Overview of your environment
        </p>
      </div>

      {/* Stats */}
      <AnimatedList className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <AnimatedItem>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Applications</CardTitle>
              <Rocket className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{allApps.length}</div>
              <p className="text-xs text-muted-foreground">
                <span className="text-green-600">{runningApps.length} running</span>
                {failedApps.length > 0 && (
                  <span className="text-red-600 ml-2">{failedApps.length} failed</span>
                )}
              </p>
            </CardContent>
          </Card>
        </AnimatedItem>

        <AnimatedItem>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Projects</CardTitle>
              <GitBranch className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{projects.length}</div>
              <p className="text-xs text-muted-foreground">
                In {currentOrg.name}
              </p>
            </CardContent>
          </Card>
        </AnimatedItem>

        <AnimatedItem>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Running</CardTitle>
              <Activity className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">{runningApps.length}</div>
              <p className="text-xs text-muted-foreground">
                {healthData?.containers
                  ? `${healthData.containers.running}/${healthData.containers.total} containers`
                  : "Active containers"}
              </p>
            </CardContent>
          </Card>
        </AnimatedItem>

        <AnimatedItem>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Status</CardTitle>
              {getHealthStatusIcon(overallHealth)}
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${
                overallHealth === "healthy" ? "text-green-600" :
                overallHealth === "warning" ? "text-yellow-600" : "text-red-600"
              }`}>
                {overallHealth === "healthy" ? "Healthy" :
                 overallHealth === "warning" ? "Warning" : "Critical"}
              </div>
              <p className="text-xs text-muted-foreground">
                {overallHealth === "healthy"
                  ? "All systems operational"
                  : overallHealth === "warning"
                  ? `${failedApps.length} issue(s) detected`
                  : "Infrastructure issues"}
              </p>
            </CardContent>
          </Card>
        </AnimatedItem>
      </AnimatedList>

      {/* Deployment Activity Chart */}
      <FadeIn delay={0.1}>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              Deployment Activity
            </CardTitle>
            <CardDescription>Deployments over the last 7 days</CardDescription>
          </CardHeader>
          <CardContent>
            <DeploymentActivity days={7} />
          </CardContent>
        </Card>
      </FadeIn>

      <FadeIn delay={0.15} className="grid gap-8 md:grid-cols-2">
        {/* Recent Applications */}
        <Card>
          <CardHeader>
            <CardTitle>Applications</CardTitle>
            <CardDescription>Your deployed applications</CardDescription>
          </CardHeader>
          <CardContent>
            {allApps.length === 0 ? (
              <EmptyState
                icon={Rocket}
                title="No applications yet"
                description="Deploy your first application to get started"
                action={{
                  label: "Deploy your first app",
                  onClick: () => window.location.href = "/dashboard/applications",
                  icon: Plus,
                }}
                className="py-6"
              />
            ) : (
              <div className="space-y-4">
                {allApps.slice(0, 5).map((app: any) => (
                  <Link
                    key={app.id}
                    href={`/dashboard/applications/${app.id}`}
                    className="flex items-center justify-between hover:bg-accent/50 rounded-lg p-2 -m-2 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      {getStatusIcon(app.status)}
                      <div>
                        <p className="text-sm font-medium">{app.appName}</p>
                        <p className="text-xs text-muted-foreground">
                          {app.sourceType === "docker"
                            ? `${app.dockerImage}:${app.dockerTag || "latest"}`
                            : app.repository || "No source"}
                        </p>
                      </div>
                    </div>
                    <Badge variant="secondary" className={getStatusBadge(app.status)}>
                      {app.status}
                    </Badge>
                  </Link>
                ))}
                {allApps.length > 5 && (
                  <Link href="/dashboard/applications">
                    <Button variant="ghost" size="sm" className="w-full">
                      View all {allApps.length} applications
                    </Button>
                  </Link>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* System Status — now powered by real data */}
        <Card>
          <CardHeader>
            <CardTitle>System Status</CardTitle>
            <CardDescription>Infrastructure health</CardDescription>
          </CardHeader>
          <CardContent>
            {healthQuery.isLoading ? (
              <div className="space-y-4">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Skeleton className="h-4 w-4 rounded-full" />
                      <Skeleton className="h-4 w-24" />
                    </div>
                    <Skeleton className="h-5 w-16 rounded-full" />
                  </div>
                ))}
              </div>
            ) : healthQuery.isError ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <AlertTriangle className="h-4 w-4 text-yellow-500" />
                    <span className="text-sm font-medium">Health Check</span>
                  </div>
                  <Badge variant="secondary" className="bg-yellow-50 text-yellow-700">
                    Unavailable
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  Unable to fetch health data. The API may be starting up.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => healthQuery.refetch()}
                  className="w-full"
                >
                  Retry
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                {(healthData?.services ?? []).map((service: any) => (
                  <div key={service.name} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {getHealthStatusIcon(service.status)}
                      <div>
                        <span className="text-sm font-medium">{service.name}</span>
                        {service.uptime && (
                          <p className="text-xs text-muted-foreground">{service.uptime}</p>
                        )}
                      </div>
                    </div>
                    <Badge variant="secondary" className={getHealthBadgeColor(service.status)}>
                      {service.status === "healthy" ? "Healthy" :
                       service.status === "warning" ? "Warning" : "Down"}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </FadeIn>

      {/* Quick Actions */}
      <FadeIn delay={0.25}>
      <Card>
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
          <CardDescription>Common tasks to get you started</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <Link href="/dashboard/applications?action=create">
              <Button variant="outline" className="h-auto flex-col gap-2 p-6 w-full">
                <Rocket className="h-6 w-6" />
                <span className="font-medium">Deploy Application</span>
                <span className="text-xs text-muted-foreground">
                  Deploy from Git or Docker
                </span>
              </Button>
            </Link>

            <Link href="/dashboard/databases">
              <Button variant="outline" className="h-auto flex-col gap-2 p-6 w-full">
                <Database className="h-6 w-6" />
                <span className="font-medium">Create Database</span>
                <span className="text-xs text-muted-foreground">
                  PostgreSQL, MySQL, or Redis
                </span>
              </Button>
            </Link>

            <Link href="/dashboard/team">
              <Button variant="outline" className="h-auto flex-col gap-2 p-6 w-full">
                <Users className="h-6 w-6" />
                <span className="font-medium">Invite Team Member</span>
                <span className="text-xs text-muted-foreground">
                  Collaborate with your team
                </span>
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
      </FadeIn>
    </div>
  )
}
