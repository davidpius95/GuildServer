"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { 
  Database,
  Plus,
  Search,
  Settings,
  Play,
  Pause,
  Download,
  Upload,
  HardDrive,
  Activity,
  Clock,
  Users,
  MoreHorizontal,
  Copy,
  ExternalLink
} from "lucide-react"

const mockDatabases = [
  {
    id: "1",
    name: "production-db",
    type: "PostgreSQL",
    version: "15.2",
    status: "running",
    environment: "production",
    size: "2.4 GB",
    connections: 24,
    maxConnections: 100,
    cpuUsage: 45,
    memoryUsage: 67,
    lastBackup: "2 hours ago",
    connectionString: "postgresql://user:pass@prod-db.guildserver.com:5432/production",
  },
  {
    id: "2",
    name: "analytics-db",
    type: "PostgreSQL", 
    version: "15.2",
    status: "running",
    environment: "production",
    size: "8.7 GB",
    connections: 12,
    maxConnections: 50,
    cpuUsage: 23,
    memoryUsage: 43,
    lastBackup: "4 hours ago",
    connectionString: "postgresql://user:pass@analytics-db.guildserver.com:5432/analytics",
  },
  {
    id: "3",
    name: "cache-redis",
    type: "Redis",
    version: "7.0",
    status: "running",
    environment: "production",
    size: "256 MB",
    connections: 8,
    maxConnections: 1000,
    cpuUsage: 12,
    memoryUsage: 28,
    lastBackup: "1 hour ago",
    connectionString: "redis://cache-redis.guildserver.com:6379",
  },
  {
    id: "4",
    name: "staging-db",
    type: "MySQL",
    version: "8.0",
    status: "stopped",
    environment: "staging",
    size: "1.2 GB",
    connections: 0,
    maxConnections: 50,
    cpuUsage: 0,
    memoryUsage: 0,
    lastBackup: "1 day ago",
    connectionString: "mysql://user:pass@staging-db.guildserver.com:3306/staging",
  },
]

const backupHistory = [
  { id: 1, database: "production-db", size: "2.4 GB", time: "2 hours ago", status: "completed" },
  { id: 2, database: "analytics-db", size: "8.7 GB", time: "4 hours ago", status: "completed" },
  { id: 3, database: "cache-redis", size: "256 MB", time: "1 hour ago", status: "completed" },
  { id: 4, database: "production-db", size: "2.3 GB", time: "1 day ago", status: "completed" },
]

const getStatusColor = (status: string) => {
  switch (status) {
    case "running":
      return "bg-green-50 text-green-700 border-green-200"
    case "stopped":
      return "bg-red-50 text-red-700 border-red-200"
    case "maintenance":
      return "bg-yellow-50 text-yellow-700 border-yellow-200"
    default:
      return "bg-gray-50 text-gray-700 border-gray-200"
  }
}

const getTypeIcon = (type: string) => {
  const iconClass = "h-5 w-5 text-muted-foreground"
  switch (type.toLowerCase()) {
    case "postgresql":
      return <Database className={iconClass} />
    case "mysql":
      return <Database className={iconClass} />
    case "redis":
      return <Activity className={iconClass} />
    default:
      return <Database className={iconClass} />
  }
}

export default function DatabasesPage() {
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedDatabase, setSelectedDatabase] = useState<string | null>(null)

  const filteredDatabases = mockDatabases.filter(db =>
    db.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    db.type.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const copyConnectionString = (connectionString: string) => {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(connectionString).catch(() => {
        // Fallback for non-HTTPS contexts
        const ta = document.createElement("textarea")
        ta.value = connectionString
        ta.style.position = "fixed"
        ta.style.opacity = "0"
        document.body.appendChild(ta)
        ta.select()
        document.execCommand("copy")
        document.body.removeChild(ta)
      })
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Databases</h1>
          <p className="text-muted-foreground">
            Manage your database instances and backups
          </p>
        </div>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Create Database
        </Button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search databases..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10"
        />
      </div>

      <Tabs defaultValue="databases" className="space-y-4">
        <TabsList>
          <TabsTrigger value="databases">Databases</TabsTrigger>
          <TabsTrigger value="backups">Backups</TabsTrigger>
          <TabsTrigger value="monitoring">Monitoring</TabsTrigger>
        </TabsList>

        <TabsContent value="databases" className="space-y-4">
          {/* Database Grid */}
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {filteredDatabases.map((db) => (
              <Card key={db.id} className="relative">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {getTypeIcon(db.type)}
                      <CardTitle className="text-lg">{db.name}</CardTitle>
                    </div>
                    <Button variant="ghost" size="icon">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={getStatusColor(db.status)}>
                      {db.status}
                    </Badge>
                    <Badge variant="secondary">{db.environment}</Badge>
                  </div>
                </CardHeader>

                <CardContent className="space-y-4">
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Type:</span>
                      <span>{db.type} {db.version}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Size:</span>
                      <span>{db.size}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Connections:</span>
                      <span>{db.connections}/{db.maxConnections}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Last Backup:</span>
                      <span>{db.lastBackup}</span>
                    </div>
                  </div>

                  {/* Resource Usage */}
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>CPU Usage</span>
                      <span>{db.cpuUsage}%</span>
                    </div>
                    <Progress value={db.cpuUsage} className="h-2" />
                    
                    <div className="flex justify-between text-sm">
                      <span>Memory Usage</span>
                      <span>{db.memoryUsage}%</span>
                    </div>
                    <Progress value={db.memoryUsage} className="h-2" />
                  </div>

                  {/* Connection String */}
                  <div className="space-y-2">
                    <span className="text-sm font-medium">Connection String</span>
                    <div className="flex gap-2">
                      <Input 
                        value={db.connectionString}
                        readOnly
                        className="text-xs"
                      />
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => copyConnectionString(db.connectionString)}
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2">
                    {db.status === "running" ? (
                      <Button variant="outline" size="sm" className="flex-1">
                        <Pause className="mr-2 h-3 w-3" />
                        Stop
                      </Button>
                    ) : (
                      <Button variant="outline" size="sm" className="flex-1">
                        <Play className="mr-2 h-3 w-3" />
                        Start
                      </Button>
                    )}
                    <Button variant="outline" size="sm" className="flex-1">
                      <Download className="mr-2 h-3 w-3" />
                      Backup
                    </Button>
                    <Button variant="outline" size="sm">
                      <Settings className="h-3 w-3" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Empty State */}
          {filteredDatabases.length === 0 && (
            <Card className="text-center py-12">
              <CardContent>
                <Database className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-2">No databases found</h3>
                <p className="text-muted-foreground mb-4">
                  {searchQuery 
                    ? "No databases match your search criteria"
                    : "Get started by creating your first database"
                  }
                </p>
                <Button>
                  <Plus className="mr-2 h-4 w-4" />
                  Create Database
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="backups" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Backup History</CardTitle>
              <CardDescription>Recent database backups and snapshots</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {backupHistory.map((backup) => (
                  <div key={backup.id} className="flex items-center justify-between p-4 border rounded-lg">
                    <div className="flex items-center gap-4">
                      <Download className="h-8 w-8 text-muted-foreground" />
                      <div>
                        <h4 className="font-medium">{backup.database}</h4>
                        <div className="flex gap-4 text-sm text-muted-foreground">
                          <span>{backup.size}</span>
                          <span>{backup.time}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="bg-green-50 text-green-700">
                        {backup.status}
                      </Badge>
                      <Button variant="outline" size="sm">
                        <Download className="mr-2 h-3 w-3" />
                        Download
                      </Button>
                      <Button variant="outline" size="sm">
                        <Upload className="mr-2 h-3 w-3" />
                        Restore
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="monitoring" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Databases</CardTitle>
                <Database className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{mockDatabases.length}</div>
                <p className="text-xs text-muted-foreground">
                  {mockDatabases.filter(db => db.status === 'running').length} running
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Storage</CardTitle>
                <HardDrive className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">12.6 GB</div>
                <p className="text-xs text-muted-foreground">
                  <span className="text-green-600">+2.1 GB</span> this month
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Active Connections</CardTitle>
                <Users className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">44</div>
                <p className="text-xs text-muted-foreground">
                  of 1200 total
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Last Backup</CardTitle>
                <Clock className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">1h ago</div>
                <p className="text-xs text-muted-foreground">
                  All databases backed up
                </p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}