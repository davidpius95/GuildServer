"use client"

import Link from "next/link"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { trpc } from "@/components/trpc-provider"
import { useOrganization, useProjects } from "@/hooks/use-auth"
import { formatDateTime } from "@/lib/utils"
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
  Loader2
} from "lucide-react"

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

export default function DashboardPage() {
  const { currentOrg, orgId, isLoading: orgLoading } = useOrganization()
  const { projects, projectId, isLoading: projLoading } = useProjects(orgId)

  // Real data queries
  const appsQuery = trpc.application.list.useQuery(
    { projectId },
    { enabled: !!projectId }
  )

  const deploymentsQuery = trpc.deployment.list.useQuery(
    { applicationId: appsQuery.data?.[0]?.id ?? "" },
    { enabled: !!appsQuery.data?.[0]?.id }
  )

  // Get all apps for all projects
  const allApps = appsQuery.data ?? []
  const runningApps = allApps.filter((a: any) => a.status === "running")
  const failedApps = allApps.filter((a: any) => a.status === "failed")

  const isLoading = orgLoading || projLoading

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
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
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
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

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Running</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{runningApps.length}</div>
            <p className="text-xs text-muted-foreground">
              Active containers
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Status</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {failedApps.length === 0 ? "Healthy" : "Issues"}
            </div>
            <p className="text-xs text-muted-foreground">
              {failedApps.length === 0
                ? "All systems operational"
                : `${failedApps.length} app(s) need attention`}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-8 md:grid-cols-2">
        {/* Recent Applications */}
        <Card>
          <CardHeader>
            <CardTitle>Applications</CardTitle>
            <CardDescription>Your deployed applications</CardDescription>
          </CardHeader>
          <CardContent>
            {allApps.length === 0 ? (
              <div className="text-center py-6">
                <p className="text-sm text-muted-foreground mb-3">No applications yet</p>
                <Link href="/dashboard/applications">
                  <Button size="sm">
                    <Plus className="mr-2 h-3 w-3" />
                    Deploy your first app
                  </Button>
                </Link>
              </div>
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

        {/* System Status */}
        <Card>
          <CardHeader>
            <CardTitle>System Status</CardTitle>
            <CardDescription>Infrastructure health</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <CheckCircle className="h-4 w-4 text-green-500" />
                  <span className="text-sm font-medium">API Server</span>
                </div>
                <Badge variant="secondary" className="bg-green-50 text-green-700">
                  Healthy
                </Badge>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <CheckCircle className="h-4 w-4 text-green-500" />
                  <span className="text-sm font-medium">Docker Engine</span>
                </div>
                <Badge variant="secondary" className="bg-green-50 text-green-700">
                  Connected
                </Badge>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <CheckCircle className="h-4 w-4 text-green-500" />
                  <span className="text-sm font-medium">Database</span>
                </div>
                <Badge variant="secondary" className="bg-green-50 text-green-700">
                  Healthy
                </Badge>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <CheckCircle className="h-4 w-4 text-green-500" />
                  <span className="text-sm font-medium">Redis Queue</span>
                </div>
                <Badge variant="secondary" className="bg-green-50 text-green-700">
                  Connected
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
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
    </div>
  )
}
