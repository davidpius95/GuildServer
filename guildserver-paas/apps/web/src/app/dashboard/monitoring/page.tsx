"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Activity,
  AlertTriangle,
  CheckCircle,
  Clock,
  Cpu,
  HardDrive,
  MemoryStick,
  Network,
  Server,
  TrendingUp,
  TrendingDown,
  Zap,
  RefreshCw,
  XCircle,
  Heart
} from "lucide-react"
import { LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts'
import { trpc } from "@/components/trpc-provider"
import { useOrganization } from "@/hooks/use-auth"

const getSeverityColor = (severity: string) => {
  switch (severity) {
    case 'critical':
      return 'bg-red-50 text-red-700 border-red-200'
    case 'warning':
      return 'bg-yellow-50 text-yellow-700 border-yellow-200'
    case 'info':
      return 'bg-blue-50 text-blue-700 border-blue-200'
    default:
      return 'bg-gray-50 text-gray-700 border-gray-200'
  }
}

const getStatusBadge = (status: string) => {
  switch (status) {
    case 'healthy':
      return <Badge variant="outline" className="bg-green-50 text-green-700"><CheckCircle className="w-3 h-3 mr-1" />Healthy</Badge>
    case 'warning':
      return <Badge variant="outline" className="bg-yellow-50 text-yellow-700"><AlertTriangle className="w-3 h-3 mr-1" />Warning</Badge>
    case 'critical':
      return <Badge variant="outline" className="bg-red-50 text-red-700"><XCircle className="w-3 h-3 mr-1" />Critical</Badge>
    default:
      return <Badge variant="outline">{status}</Badge>
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

function formatUptime(seconds?: number): string {
  if (!seconds) return 'N/A'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 24) return `${Math.floor(h / 24)}d ${h % 24}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

export default function MonitoringPage() {
  const [refreshing, setRefreshing] = useState(false)
  const [timeRange, setTimeRange] = useState<"1h" | "6h" | "24h" | "7d">("24h")
  const { orgId } = useOrganization()

  // UUID validation to prevent queries with empty/invalid IDs
  const isValidUUID = (s: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)

  const validOrgId = isValidUUID(orgId)

  // Real data queries — staggered intervals to prevent thundering herd
  // Each query fires at a different interval so they don't all hit the API at once
  const orgMetrics = trpc.monitoring.getOrganizationMetrics.useQuery(
    { organizationId: orgId, timeRange },
    { enabled: validOrgId, refetchInterval: 30000 }  // 30s — org metrics (heaviest query)
  )

  const systemHealth = trpc.monitoring.getSystemHealth.useQuery(
    { organizationId: orgId },
    { enabled: validOrgId, refetchInterval: 45000 }  // 45s — system health (Docker calls)
  )

  const alerts = trpc.monitoring.getAlerts.useQuery(
    { organizationId: orgId },
    { enabled: validOrgId, refetchInterval: 60000 }  // 60s — alerts (can be less frequent)
  )

  const appsSummary = trpc.monitoring.getApplicationsSummary.useQuery(
    { organizationId: orgId },
    { enabled: validOrgId, refetchInterval: 30000 }  // 30s — app summary (most used tab)
  )

  const handleRefresh = () => {
    setRefreshing(true)
    orgMetrics.refetch()
    systemHealth.refetch()
    alerts.refetch()
    appsSummary.refetch()
    setTimeout(() => setRefreshing(false), 1000)
  }

  const org = orgMetrics.data
  const health = systemHealth.data
  const alertsList = alerts.data ?? []
  const apps = appsSummary.data ?? []

  // Calculate aggregate metrics
  const totalCpu = apps.reduce((sum, a) => sum + a.cpu, 0)
  const totalMemory = apps.reduce((sum, a) => sum + a.memory, 0)
  const runningApps = apps.filter(a => a.healthy).length
  const totalApps = apps.length

  // Build chart data from org historical metrics
  const cpuChartData = (org?.resourceUsage?.cpu?.data ?? []).map((d: any) => ({
    time: new Date(d.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    cpu: d.value,
  }))

  const memoryChartData = (org?.resourceUsage?.memory?.data ?? []).map((d: any) => ({
    time: new Date(d.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    memory: d.value,
  }))

  // Merge CPU and memory data by timestamp for the combined chart
  const performanceData = cpuChartData.map((c: any, i: number) => ({
    time: c.time,
    cpu: c.cpu,
    memory: memoryChartData[i]?.memory ?? 0,
  }))

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Monitoring</h1>
          <p className="text-muted-foreground">
            Real-time monitoring and observability
          </p>
        </div>
        <div className="flex gap-2">
          <div className="flex gap-1 border rounded-md p-1">
            {(["1h", "6h", "24h", "7d"] as const).map(range => (
              <Button
                key={range}
                variant={timeRange === range ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setTimeRange(range)}
              >
                {range}
              </Button>
            ))}
          </div>
          <Button onClick={handleRefresh} disabled={refreshing}>
            <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* System Overview Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">CPU Usage</CardTitle>
            <Cpu className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {org?.resourceUsage?.cpu?.current?.toFixed(1) ?? totalCpu.toFixed(1)}%
            </div>
            <Progress value={Math.min(org?.resourceUsage?.cpu?.current ?? totalCpu, 100)} className="mt-2" />
            <p className="text-xs text-muted-foreground mt-2">
              Across {runningApps} running app{runningApps !== 1 ? 's' : ''}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Memory Usage</CardTitle>
            <MemoryStick className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {(org?.resourceUsage?.memory?.current ?? totalMemory).toFixed(1)} MB
            </div>
            <Progress value={Math.min((totalMemory / 1024) * 100, 100)} className="mt-2" />
            <p className="text-xs text-muted-foreground mt-2">
              {runningApps} container{runningApps !== 1 ? 's' : ''} active
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Applications</CardTitle>
            <Server className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{runningApps}/{totalApps}</div>
            <div className="flex gap-1 mt-2">
              {runningApps > 0 && (
                <Badge variant="outline" className="bg-green-50 text-green-700 text-xs">
                  {runningApps} Running
                </Badge>
              )}
              {totalApps - runningApps > 0 && (
                <Badge variant="outline" className="bg-gray-50 text-gray-700 text-xs">
                  {totalApps - runningApps} Stopped
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Alerts</CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{alertsList.length}</div>
            <div className="flex gap-1 mt-2">
              {alertsList.filter(a => a.severity === 'critical').length > 0 && (
                <Badge variant="outline" className="bg-red-50 text-red-700 text-xs">
                  {alertsList.filter(a => a.severity === 'critical').length} Critical
                </Badge>
              )}
              {alertsList.filter(a => a.severity === 'warning').length > 0 && (
                <Badge variant="outline" className="bg-yellow-50 text-yellow-700 text-xs">
                  {alertsList.filter(a => a.severity === 'warning').length} Warning
                </Badge>
              )}
              {alertsList.length === 0 && (
                <Badge variant="outline" className="bg-green-50 text-green-700 text-xs">
                  All Clear
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="performance" className="space-y-4">
        <TabsList>
          <TabsTrigger value="performance">Performance</TabsTrigger>
          <TabsTrigger value="applications">Applications</TabsTrigger>
          <TabsTrigger value="health">System Health</TabsTrigger>
          <TabsTrigger value="alerts">Alerts ({alertsList.length})</TabsTrigger>
        </TabsList>

        {/* Performance Tab */}
        <TabsContent value="performance" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>CPU & Memory Over Time</CardTitle>
                <CardDescription>
                  {performanceData.length > 0
                    ? `${performanceData.length} data points collected`
                    : "Collecting metrics... data will appear shortly"
                  }
                </CardDescription>
              </CardHeader>
              <CardContent>
                {performanceData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={performanceData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="time" />
                      <YAxis />
                      <Tooltip />
                      <Line type="monotone" dataKey="cpu" stroke="#8884d8" name="CPU %" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="memory" stroke="#82ca9d" name="Memory (MB)" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-[300px] text-muted-foreground">
                    <div className="text-center">
                      <Activity className="h-12 w-12 mx-auto mb-2 opacity-30" />
                      <p>Waiting for metrics data...</p>
                      <p className="text-xs mt-1">Metrics are collected every 15 seconds</p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Per-Application Resource Usage</CardTitle>
                <CardDescription>Current CPU and memory by application</CardDescription>
              </CardHeader>
              <CardContent>
                {apps.filter(a => a.healthy).length > 0 ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={apps.filter(a => a.healthy).map(a => ({
                      name: a.appName,
                      cpu: Math.round(a.cpu * 100) / 100,
                      memory: Math.round(a.memory * 100) / 100,
                    }))}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" />
                      <YAxis />
                      <Tooltip />
                      <Bar dataKey="cpu" fill="#8884d8" name="CPU %" />
                      <Bar dataKey="memory" fill="#82ca9d" name="Memory (MB)" />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-[300px] text-muted-foreground">
                    <div className="text-center">
                      <Server className="h-12 w-12 mx-auto mb-2 opacity-30" />
                      <p>No running applications</p>
                      <p className="text-xs mt-1">Deploy an application to see metrics</p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Deployment Stats */}
          {org && (
            <div className="grid gap-4 md:grid-cols-4">
              <Card>
                <CardContent className="pt-6">
                  <div className="text-sm text-muted-foreground">Total Deployments</div>
                  <div className="text-2xl font-bold">{org.totalDeployments}</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="text-sm text-muted-foreground">Successful</div>
                  <div className="text-2xl font-bold text-green-600">{org.successfulDeployments}</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="text-sm text-muted-foreground">Success Rate</div>
                  <div className="text-2xl font-bold">
                    {org.totalDeployments > 0
                      ? ((org.successfulDeployments / org.totalDeployments) * 100).toFixed(1)
                      : '0'}%
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="text-sm text-muted-foreground">Running Apps</div>
                  <div className="text-2xl font-bold">{org.runningApplications}/{org.totalApplications}</div>
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        {/* Applications Tab */}
        <TabsContent value="applications" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Application Metrics</CardTitle>
              <CardDescription>
                Real-time performance metrics for each application
              </CardDescription>
            </CardHeader>
            <CardContent>
              {apps.length > 0 ? (
                <div className="space-y-4">
                  {apps.map((app) => (
                    <div key={app.id} className="flex items-center justify-between p-4 border rounded-lg">
                      <div className="flex items-center gap-4">
                        <Server className="h-8 w-8 text-muted-foreground" />
                        <div>
                          <h3 className="font-medium">{app.name}</h3>
                          <div className="flex gap-4 text-sm text-muted-foreground">
                            <span>CPU: {app.cpu.toFixed(1)}%</span>
                            <span>Memory: {app.memory.toFixed(1)} MB</span>
                            <span>Network: {formatBytes(app.networkRx)} / {formatBytes(app.networkTx)}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        {app.healthy ? (
                          <Badge variant="outline" className="bg-green-50 text-green-700">
                            <CheckCircle className="w-3 h-3 mr-1" />
                            Healthy
                          </Badge>
                        ) : app.status === 'running' ? (
                          <Badge variant="outline" className="bg-yellow-50 text-yellow-700">
                            <AlertTriangle className="w-3 h-3 mr-1" />
                            Unhealthy
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="bg-gray-50 text-gray-700">
                            {app.status}
                          </Badge>
                        )}
                        <div className="text-right">
                          <div className="text-sm font-medium">
                            {formatUptime(app.uptime)}
                          </div>
                          <div className="text-xs text-muted-foreground">Uptime</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Server className="h-12 w-12 mx-auto mb-2 opacity-30" />
                  <p>No applications found</p>
                  <p className="text-xs mt-1">Create and deploy an application to see metrics</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* System Health Tab */}
        <TabsContent value="health" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                System Health
                {health && getStatusBadge(health.overall)}
              </CardTitle>
              <CardDescription>Real-time service and infrastructure health</CardDescription>
            </CardHeader>
            <CardContent>
              {health ? (
                <div className="space-y-4">
                  {/* Services */}
                  <div>
                    <h4 className="text-sm font-medium mb-3">Infrastructure Services</h4>
                    <div className="grid gap-3 md:grid-cols-2">
                      {health.services.map((service: any) => (
                        <div key={service.name} className="flex items-center justify-between p-3 border rounded-lg">
                          <div className="flex items-center gap-2">
                            {service.status === 'healthy' ? (
                              <CheckCircle className="h-4 w-4 text-green-500" />
                            ) : service.status === 'warning' ? (
                              <AlertTriangle className="h-4 w-4 text-yellow-500" />
                            ) : (
                              <XCircle className="h-4 w-4 text-red-500" />
                            )}
                            <span className="font-medium text-sm">{service.name}</span>
                          </div>
                          <div className="text-right text-xs text-muted-foreground">
                            <div>{service.uptime}</div>
                            <div>{service.responseTime}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Container Summary */}
                  <div>
                    <h4 className="text-sm font-medium mb-3">Container Summary</h4>
                    <div className="grid gap-3 md:grid-cols-4">
                      <div className="p-3 border rounded-lg text-center">
                        <div className="text-2xl font-bold">{health.containers.total}</div>
                        <div className="text-xs text-muted-foreground">Total</div>
                      </div>
                      <div className="p-3 border rounded-lg text-center">
                        <div className="text-2xl font-bold text-green-600">{health.containers.running}</div>
                        <div className="text-xs text-muted-foreground">Running</div>
                      </div>
                      <div className="p-3 border rounded-lg text-center">
                        <div className="text-2xl font-bold text-gray-500">{health.containers.stopped}</div>
                        <div className="text-xs text-muted-foreground">Stopped</div>
                      </div>
                      <div className="p-3 border rounded-lg text-center">
                        <div className="text-2xl font-bold text-red-600">{health.containers.errored}</div>
                        <div className="text-xs text-muted-foreground">Errored</div>
                      </div>
                    </div>
                  </div>

                  {/* Application Health */}
                  {health.applications && health.applications.length > 0 && (
                    <div>
                      <h4 className="text-sm font-medium mb-3">Application Health</h4>
                      <div className="space-y-2">
                        {health.applications.map((app: any) => (
                          <div key={app.applicationId} className="flex items-center justify-between p-3 border rounded-lg">
                            <div className="flex items-center gap-2">
                              <Heart className={`h-4 w-4 ${app.healthy ? 'text-green-500' : 'text-red-500'}`} />
                              <span className="text-sm font-medium">{app.name}</span>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="text-xs text-muted-foreground">
                                {app.healthy ? `Up ${formatUptime(app.uptime)}` : app.status}
                              </span>
                              {app.healthy ? (
                                <Badge variant="outline" className="bg-green-50 text-green-700 text-xs">Healthy</Badge>
                              ) : (
                                <Badge variant="outline" className="bg-red-50 text-red-700 text-xs">{app.status}</Badge>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <RefreshCw className="h-8 w-8 mx-auto mb-2 animate-spin opacity-30" />
                  <p>Loading health data...</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Alerts Tab */}
        <TabsContent value="alerts" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Active Alerts</CardTitle>
              <CardDescription>
                Real-time alerts based on container health and resource usage
              </CardDescription>
            </CardHeader>
            <CardContent>
              {alertsList.length > 0 ? (
                <div className="space-y-4">
                  {alertsList.map((alert) => (
                    <div key={alert.id} className="flex items-start gap-4 p-4 border rounded-lg">
                      <div className="mt-1">
                        {alert.severity === 'critical' && <XCircle className="h-5 w-5 text-red-500" />}
                        {alert.severity === 'warning' && <AlertTriangle className="h-5 w-5 text-yellow-500" />}
                        {alert.severity === 'info' && <CheckCircle className="h-5 w-5 text-blue-500" />}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="font-medium">{alert.title}</h4>
                          <Badge variant="outline" className={getSeverityColor(alert.severity)}>
                            {alert.severity}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground mb-2">{alert.description}</p>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Clock className="w-3 h-3" />
                          {new Date(alert.createdAt).toLocaleString()}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <CheckCircle className="h-12 w-12 mx-auto mb-2 text-green-300" />
                  <p className="font-medium">All Clear</p>
                  <p className="text-xs mt-1">No active alerts. All systems operating normally.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
