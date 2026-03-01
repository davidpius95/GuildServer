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
  RefreshCw
} from "lucide-react"
import { LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts'

// Mock data for charts
const performanceData = [
  { time: '00:00', cpu: 45, memory: 62, network: 23 },
  { time: '04:00', cpu: 52, memory: 58, network: 31 },
  { time: '08:00', cpu: 78, memory: 71, network: 45 },
  { time: '12:00', cpu: 85, memory: 79, network: 52 },
  { time: '16:00', cpu: 67, memory: 68, network: 38 },
  { time: '20:00', cpu: 59, memory: 64, network: 29 },
]

const applicationMetrics = [
  { name: 'api-gateway', requests: 12543, errors: 23, latency: 145 },
  { name: 'web-dashboard', requests: 8721, errors: 12, latency: 89 },
  { name: 'user-service', requests: 5432, errors: 8, latency: 234 },
  { name: 'notification-worker', requests: 3210, errors: 5, latency: 67 },
]

const alerts = [
  { id: 1, type: 'error', title: 'High CPU Usage', description: 'API Gateway CPU usage above 85%', time: '2 minutes ago', severity: 'high' },
  { id: 2, type: 'warning', title: 'Disk Space Low', description: 'Database server disk usage at 78%', time: '15 minutes ago', severity: 'medium' },
  { id: 3, type: 'info', title: 'Deployment Complete', description: 'user-service v1.2.3 deployed successfully', time: '1 hour ago', severity: 'low' },
]

const getSeverityColor = (severity: string) => {
  switch (severity) {
    case 'high':
      return 'bg-red-50 text-red-700 border-red-200'
    case 'medium':
      return 'bg-yellow-50 text-yellow-700 border-yellow-200'
    case 'low':
      return 'bg-blue-50 text-blue-700 border-blue-200'
    default:
      return 'bg-gray-50 text-gray-700 border-gray-200'
  }
}

export default function MonitoringPage() {
  const [refreshing, setRefreshing] = useState(false)

  const handleRefresh = () => {
    setRefreshing(true)
    setTimeout(() => setRefreshing(false), 2000)
  }

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
        <Button onClick={handleRefresh} disabled={refreshing}>
          <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* System Overview */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">CPU Usage</CardTitle>
            <Cpu className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">67%</div>
            <Progress value={67} className="mt-2" />
            <p className="text-xs text-muted-foreground mt-2">
              <span className="text-green-600">-5%</span> from last hour
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Memory Usage</CardTitle>
            <MemoryStick className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">78%</div>
            <Progress value={78} className="mt-2" />
            <p className="text-xs text-muted-foreground mt-2">
              <span className="text-red-600">+3%</span> from last hour
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Disk Usage</CardTitle>
            <HardDrive className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">45%</div>
            <Progress value={45} className="mt-2" />
            <p className="text-xs text-muted-foreground mt-2">
              <span className="text-green-600">-1%</span> from last hour
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Alerts</CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">3</div>
            <div className="flex gap-1 mt-2">
              <Badge variant="outline" className="bg-red-50 text-red-700 text-xs">1 High</Badge>
              <Badge variant="outline" className="bg-yellow-50 text-yellow-700 text-xs">2 Med</Badge>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="performance" className="space-y-4">
        <TabsList>
          <TabsTrigger value="performance">Performance</TabsTrigger>
          <TabsTrigger value="applications">Applications</TabsTrigger>
          <TabsTrigger value="alerts">Alerts</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
        </TabsList>

        <TabsContent value="performance" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>System Performance</CardTitle>
                <CardDescription>CPU, Memory, and Network usage over time</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={performanceData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="time" />
                    <YAxis />
                    <Tooltip />
                    <Line type="monotone" dataKey="cpu" stroke="#8884d8" name="CPU %" />
                    <Line type="monotone" dataKey="memory" stroke="#82ca9d" name="Memory %" />
                    <Line type="monotone" dataKey="network" stroke="#ffc658" name="Network %" />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Response Time</CardTitle>
                <CardDescription>Average response time by service</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={applicationMetrics}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="latency" fill="#8884d8" name="Latency (ms)" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="applications" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Application Metrics</CardTitle>
              <CardDescription>Performance metrics for each application</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {applicationMetrics.map((app) => (
                  <div key={app.name} className="flex items-center justify-between p-4 border rounded-lg">
                    <div className="flex items-center gap-4">
                      <Server className="h-8 w-8 text-muted-foreground" />
                      <div>
                        <h3 className="font-medium">{app.name}</h3>
                        <div className="flex gap-4 text-sm text-muted-foreground">
                          <span>{app.requests.toLocaleString()} requests</span>
                          <span>{app.errors} errors</span>
                          <span>{app.latency}ms avg latency</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="bg-green-50 text-green-700">
                        <CheckCircle className="w-3 h-3 mr-1" />
                        Healthy
                      </Badge>
                      <div className="text-right">
                        <div className="text-sm font-medium">
                          {((1 - app.errors / app.requests) * 100).toFixed(2)}%
                        </div>
                        <div className="text-xs text-muted-foreground">Success Rate</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="alerts" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Active Alerts</CardTitle>
              <CardDescription>Current system alerts and notifications</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {alerts.map((alert) => (
                  <div key={alert.id} className="flex items-start gap-4 p-4 border rounded-lg">
                    <div className="mt-1">
                      {alert.type === 'error' && <AlertTriangle className="h-5 w-5 text-red-500" />}
                      {alert.type === 'warning' && <AlertTriangle className="h-5 w-5 text-yellow-500" />}
                      {alert.type === 'info' && <CheckCircle className="h-5 w-5 text-blue-500" />}
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
                        {alert.time}
                      </div>
                    </div>
                    <Button variant="outline" size="sm">
                      Resolve
                    </Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="logs" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Recent Logs</CardTitle>
              <CardDescription>System and application logs</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 font-mono text-sm">
                <div className="flex gap-4 p-2 bg-muted/50 rounded">
                  <span className="text-muted-foreground">2024-01-20 14:32:15</span>
                  <span className="text-blue-600">[INFO]</span>
                  <span>api-gateway: Request processed successfully</span>
                </div>
                <div className="flex gap-4 p-2 bg-muted/50 rounded">
                  <span className="text-muted-foreground">2024-01-20 14:31:45</span>
                  <span className="text-red-600">[ERROR]</span>
                  <span>user-service: Database connection timeout</span>
                </div>
                <div className="flex gap-4 p-2 bg-muted/50 rounded">
                  <span className="text-muted-foreground">2024-01-20 14:31:22</span>
                  <span className="text-yellow-600">[WARN]</span>
                  <span>web-dashboard: High memory usage detected</span>
                </div>
                <div className="flex gap-4 p-2 bg-muted/50 rounded">
                  <span className="text-muted-foreground">2024-01-20 14:30:58</span>
                  <span className="text-blue-600">[INFO]</span>
                  <span>notification-worker: Job queue processed</span>
                </div>
                <div className="flex gap-4 p-2 bg-muted/50 rounded">
                  <span className="text-muted-foreground">2024-01-20 14:30:33</span>
                  <span className="text-green-600">[SUCCESS]</span>
                  <span>deployment: Application deployed successfully</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}