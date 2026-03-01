"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { 
  Plus,
  Search,
  Rocket,
  ExternalLink,
  Settings,
  Play,
  Pause,
  MoreHorizontal
} from "lucide-react"

const mockApplications = [
  {
    id: "1",
    name: "api-gateway",
    status: "running",
    environment: "production",
    lastDeploy: "2 hours ago",
    url: "https://api.company.com",
    framework: "Node.js",
  },
  {
    id: "2", 
    name: "web-dashboard",
    status: "running",
    environment: "production", 
    lastDeploy: "5 hours ago",
    url: "https://dashboard.company.com",
    framework: "Next.js",
  },
  {
    id: "3",
    name: "user-service",
    status: "stopped",
    environment: "staging",
    lastDeploy: "1 day ago",
    url: "https://staging-users.company.com",
    framework: "Python",
  },
  {
    id: "4",
    name: "notification-worker",
    status: "running",
    environment: "production",
    lastDeploy: "3 days ago",
    url: null,
    framework: "Node.js",
  },
]

const getStatusColor = (status: string) => {
  switch (status) {
    case "running":
      return "bg-green-50 text-green-700 border-green-200"
    case "stopped":
      return "bg-red-50 text-red-700 border-red-200"
    case "deploying":
      return "bg-blue-50 text-blue-700 border-blue-200"
    default:
      return "bg-gray-50 text-gray-700 border-gray-200"
  }
}

export default function ApplicationsPage() {
  const [searchQuery, setSearchQuery] = useState("")

  const filteredApplications = mockApplications.filter(app =>
    app.name.toLowerCase().includes(searchQuery.toLowerCase())
  )

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Applications</h1>
          <p className="text-muted-foreground">
            Manage and deploy your applications
          </p>
        </div>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Deploy Application
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

      {/* Applications Grid */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {filteredApplications.map((app) => (
          <Card key={app.id} className="relative">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Rocket className="h-5 w-5 text-muted-foreground" />
                  <CardTitle className="text-lg">{app.name}</CardTitle>
                </div>
                <Button variant="ghost" size="icon">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <Badge 
                  variant="outline" 
                  className={getStatusColor(app.status)}
                >
                  {app.status}
                </Badge>
                <Badge variant="secondary">
                  {app.environment}
                </Badge>
              </div>
            </CardHeader>

            <CardContent className="space-y-4">
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Framework:</span>
                  <span>{app.framework}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Last Deploy:</span>
                  <span>{app.lastDeploy}</span>
                </div>
                {app.url && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">URL:</span>
                    <Button variant="link" size="sm" className="h-auto p-0">
                      <ExternalLink className="mr-1 h-3 w-3" />
                      Visit
                    </Button>
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                {app.status === "running" ? (
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
                  <Settings className="mr-2 h-3 w-3" />
                  Settings
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Empty State */}
      {filteredApplications.length === 0 && (
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
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Deploy Application
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}