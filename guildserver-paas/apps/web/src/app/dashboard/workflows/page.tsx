"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { 
  Workflow,
  Plus,
  Search,
  Play,
  Pause,
  Settings,
  GitBranch,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  MoreHorizontal,
  Eye,
  Edit,
  Trash2
} from "lucide-react"

const mockWorkflows = [
  {
    id: "1",
    name: "CI/CD Pipeline",
    description: "Automated build, test, and deployment workflow",
    type: "cicd",
    status: "active",
    trigger: "push",
    lastRun: "2 hours ago",
    successRate: 95,
    totalRuns: 124,
    avgDuration: "4m 32s",
    steps: [
      { name: "Checkout Code", status: "success" },
      { name: "Build Application", status: "success" },
      { name: "Run Tests", status: "success" },
      { name: "Deploy to Staging", status: "success" },
      { name: "Approval Gate", status: "pending" },
      { name: "Deploy to Production", status: "pending" },
    ],
  },
  {
    id: "2",
    name: "Database Backup",
    description: "Daily database backup and verification workflow",
    type: "maintenance",
    status: "active",
    trigger: "schedule",
    lastRun: "6 hours ago",
    successRate: 100,
    totalRuns: 89,
    avgDuration: "12m 15s",
    steps: [
      { name: "Start Backup Process", status: "success" },
      { name: "Create Database Dump", status: "success" },
      { name: "Upload to Storage", status: "success" },
      { name: "Verify Backup", status: "success" },
      { name: "Send Notification", status: "success" },
    ],
  },
  {
    id: "3",
    name: "Security Scan",
    description: "Weekly security vulnerability scanning workflow",
    type: "security",
    status: "paused",
    trigger: "schedule",
    lastRun: "3 days ago",
    successRate: 87,
    totalRuns: 23,
    avgDuration: "8m 42s",
    steps: [
      { name: "Scan Dependencies", status: "success" },
      { name: "Container Security Scan", status: "warning" },
      { name: "Code Quality Check", status: "success" },
      { name: "Generate Report", status: "success" },
      { name: "Send Alert", status: "failed" },
    ],
  },
]

const workflowRuns = [
  {
    id: "run-1",
    workflowId: "1",
    workflowName: "CI/CD Pipeline",
    status: "running",
    trigger: "push",
    startedAt: "2024-01-20 14:30:00",
    duration: "2m 15s",
    commit: "abc123f - Fix user authentication bug",
    branch: "main",
  },
  {
    id: "run-2",
    workflowId: "2",
    workflowName: "Database Backup",
    status: "success",
    trigger: "schedule",
    startedAt: "2024-01-20 06:00:00",
    duration: "11m 32s",
    commit: null,
    branch: null,
  },
  {
    id: "run-3",
    workflowId: "1",
    workflowName: "CI/CD Pipeline",
    status: "failed",
    trigger: "pull_request",
    startedAt: "2024-01-19 16:45:00",
    duration: "3m 08s",
    commit: "def456a - Add new feature",
    branch: "feature/new-ui",
  },
]

const getStatusColor = (status: string) => {
  switch (status) {
    case "active":
    case "success":
    case "running":
      return "bg-green-50 text-green-700 border-green-200"
    case "paused":
    case "pending":
      return "bg-yellow-50 text-yellow-700 border-yellow-200"
    case "failed":
    case "error":
      return "bg-red-50 text-red-700 border-red-200"
    default:
      return "bg-gray-50 text-gray-700 border-gray-200"
  }
}

const getStatusIcon = (status: string) => {
  switch (status) {
    case "success":
      return <CheckCircle className="h-4 w-4 text-green-500" />
    case "failed":
    case "error":
      return <XCircle className="h-4 w-4 text-red-500" />
    case "running":
      return <Clock className="h-4 w-4 text-blue-500 animate-spin" />
    case "warning":
      return <AlertCircle className="h-4 w-4 text-yellow-500" />
    default:
      return <Clock className="h-4 w-4 text-gray-400" />
  }
}

export default function WorkflowsPage() {
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedWorkflow, setSelectedWorkflow] = useState<string | null>(null)

  const filteredWorkflows = mockWorkflows.filter(workflow =>
    workflow.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    workflow.description.toLowerCase().includes(searchQuery.toLowerCase())
  )

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Workflows</h1>
          <p className="text-muted-foreground">
            Automate your deployment and operational processes
          </p>
        </div>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Create Workflow
        </Button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search workflows..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10"
        />
      </div>

      <Tabs defaultValue="workflows" className="space-y-4">
        <TabsList>
          <TabsTrigger value="workflows">Workflows</TabsTrigger>
          <TabsTrigger value="runs">Recent Runs</TabsTrigger>
          <TabsTrigger value="templates">Templates</TabsTrigger>
        </TabsList>

        <TabsContent value="workflows" className="space-y-4">
          {/* Workflows Grid */}
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {filteredWorkflows.map((workflow) => (
              <Card key={workflow.id} className="relative">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Workflow className="h-5 w-5 text-muted-foreground" />
                      <CardTitle className="text-lg">{workflow.name}</CardTitle>
                    </div>
                    <Button variant="ghost" size="icon">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </div>
                  <CardDescription>{workflow.description}</CardDescription>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={getStatusColor(workflow.status)}>
                      {workflow.status}
                    </Badge>
                    <Badge variant="secondary">{workflow.type}</Badge>
                  </div>
                </CardHeader>

                <CardContent className="space-y-4">
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Trigger:</span>
                      <span className="capitalize">{workflow.trigger}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Last Run:</span>
                      <span>{workflow.lastRun}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Success Rate:</span>
                      <span>{workflow.successRate}%</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Avg Duration:</span>
                      <span>{workflow.avgDuration}</span>
                    </div>
                  </div>

                  {/* Workflow Steps */}
                  <div className="space-y-2">
                    <span className="text-sm font-medium">Steps ({workflow.steps.length})</span>
                    <div className="space-y-1">
                      {workflow.steps.slice(0, 3).map((step, index) => (
                        <div key={index} className="flex items-center gap-2 text-sm">
                          {getStatusIcon(step.status)}
                          <span className="truncate">{step.name}</span>
                        </div>
                      ))}
                      {workflow.steps.length > 3 && (
                        <div className="text-xs text-muted-foreground">
                          +{workflow.steps.length - 3} more steps
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="flex-1">
                      <Play className="mr-2 h-3 w-3" />
                      Run
                    </Button>
                    <Button variant="outline" size="sm" className="flex-1">
                      <Eye className="mr-2 h-3 w-3" />
                      View
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
          {filteredWorkflows.length === 0 && (
            <Card className="text-center py-12">
              <CardContent>
                <Workflow className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-2">No workflows found</h3>
                <p className="text-muted-foreground mb-4">
                  {searchQuery 
                    ? "No workflows match your search criteria"
                    : "Get started by creating your first workflow"
                  }
                </p>
                <Button>
                  <Plus className="mr-2 h-4 w-4" />
                  Create Workflow
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="runs" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Recent Workflow Runs</CardTitle>
              <CardDescription>Latest workflow executions and their status</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {workflowRuns.map((run) => (
                  <div key={run.id} className="flex items-center justify-between p-4 border rounded-lg">
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2">
                        {getStatusIcon(run.status)}
                        <div>
                          <h4 className="font-medium">{run.workflowName}</h4>
                          <div className="flex gap-4 text-sm text-muted-foreground">
                            <span>Triggered by {run.trigger}</span>
                            <span>{run.startedAt}</span>
                            <span>{run.duration}</span>
                          </div>
                          {run.commit && (
                            <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                              <GitBranch className="w-3 h-3" />
                              <span>{run.branch}</span>
                              <span>•</span>
                              <span>{run.commit}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={getStatusColor(run.status)}>
                        {run.status}
                      </Badge>
                      <Button variant="outline" size="sm">
                        <Eye className="mr-2 h-3 w-3" />
                        View Logs
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="templates" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Card className="cursor-pointer hover:shadow-md transition-shadow">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Workflow className="h-5 w-5" />
                  Node.js CI/CD
                </CardTitle>
                <CardDescription>
                  Complete CI/CD pipeline for Node.js applications with testing and deployment
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button variant="outline" className="w-full">
                  Use Template
                </Button>
              </CardContent>
            </Card>

            <Card className="cursor-pointer hover:shadow-md transition-shadow">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Workflow className="h-5 w-5" />
                  Database Maintenance
                </CardTitle>
                <CardDescription>
                  Automated database backup, cleanup, and health monitoring workflow
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button variant="outline" className="w-full">
                  Use Template
                </Button>
              </CardContent>
            </Card>

            <Card className="cursor-pointer hover:shadow-md transition-shadow">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Workflow className="h-5 w-5" />
                  Security Scanning
                </CardTitle>
                <CardDescription>
                  Comprehensive security scanning for dependencies and containers
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button variant="outline" className="w-full">
                  Use Template
                </Button>
              </CardContent>
            </Card>

            <Card className="cursor-pointer hover:shadow-md transition-shadow">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Workflow className="h-5 w-5" />
                  Multi-Environment Deploy
                </CardTitle>
                <CardDescription>
                  Deploy applications across multiple environments with approval gates
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button variant="outline" className="w-full">
                  Use Template
                </Button>
              </CardContent>
            </Card>

            <Card className="cursor-pointer hover:shadow-md transition-shadow">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Workflow className="h-5 w-5" />
                  Kubernetes Deployment
                </CardTitle>
                <CardDescription>
                  Deploy and manage applications on Kubernetes clusters
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button variant="outline" className="w-full">
                  Use Template
                </Button>
              </CardContent>
            </Card>

            <Card className="cursor-pointer hover:shadow-md transition-shadow">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Workflow className="h-5 w-5" />
                  Custom Workflow
                </CardTitle>
                <CardDescription>
                  Start from scratch and build your own custom workflow
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button variant="outline" className="w-full">
                  Create Custom
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}