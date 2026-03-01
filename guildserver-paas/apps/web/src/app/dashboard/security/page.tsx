"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { 
  Shield,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Lock,
  Key,
  Scan,
  FileText,
  Settings,
  RefreshCw,
  Download,
  Eye,
  Clock,
  TrendingUp,
  TrendingDown
} from "lucide-react"

const complianceFrameworks = [
  {
    id: "soc2",
    name: "SOC 2 Type II",
    description: "System and Organization Controls 2",
    status: "compliant",
    score: 94,
    lastAssessed: "2024-01-15",
    nextAssessment: "2024-07-15",
    controls: {
      total: 28,
      compliant: 26,
      nonCompliant: 1,
      inProgress: 1,
    },
    criticalIssues: 0,
  },
  {
    id: "hipaa",
    name: "HIPAA",
    description: "Health Insurance Portability and Accountability Act",
    status: "partially_compliant",
    score: 78,
    lastAssessed: "2024-01-10",
    nextAssessment: "2024-04-10",
    controls: {
      total: 18,
      compliant: 14,
      nonCompliant: 2,
      inProgress: 2,
    },
    criticalIssues: 2,
  },
  {
    id: "pci-dss",
    name: "PCI DSS",
    description: "Payment Card Industry Data Security Standard",
    status: "non_compliant",
    score: 62,
    lastAssessed: "2024-01-08",
    nextAssessment: "2024-04-08",
    controls: {
      total: 12,
      compliant: 7,
      nonCompliant: 4,
      inProgress: 1,
    },
    criticalIssues: 4,
  },
]

const securityIssues = [
  {
    id: "issue-1",
    title: "Outdated SSL Certificate",
    description: "SSL certificate for api.guildserver.com expires in 7 days",
    severity: "high",
    category: "Certificate Management",
    affectedResources: ["api.guildserver.com"],
    discoveredAt: "2024-01-18",
    status: "open",
  },
  {
    id: "issue-2",
    title: "Weak Password Policy",
    description: "Password policy allows passwords shorter than 12 characters",
    severity: "medium",
    category: "Access Control",
    affectedResources: ["User Authentication"],
    discoveredAt: "2024-01-17",
    status: "in_progress",
  },
  {
    id: "issue-3",
    title: "Unencrypted Database Backup",
    description: "Database backup found without encryption at rest",
    severity: "critical",
    category: "Data Protection",
    affectedResources: ["production-db"],
    discoveredAt: "2024-01-16",
    status: "resolved",
  },
  {
    id: "issue-4",
    title: "Missing MFA for Admin Users",
    description: "3 admin users without multi-factor authentication enabled",
    severity: "high",
    category: "Access Control",
    affectedResources: ["Admin Accounts"],
    discoveredAt: "2024-01-15",
    status: "open",
  },
]

const vulnerabilityScans = [
  {
    id: "scan-1",
    type: "Container Security Scan",
    target: "registry.guildserver.com/api-gateway:latest",
    status: "completed",
    startedAt: "2024-01-20 08:00:00",
    completedAt: "2024-01-20 08:15:00",
    findings: {
      critical: 0,
      high: 2,
      medium: 5,
      low: 12,
    },
  },
  {
    id: "scan-2",
    type: "Dependency Scan",
    target: "web-dashboard",
    status: "completed",
    startedAt: "2024-01-20 06:30:00",
    completedAt: "2024-01-20 06:45:00",
    findings: {
      critical: 1,
      high: 3,
      medium: 8,
      low: 15,
    },
  },
  {
    id: "scan-3",
    type: "Infrastructure Scan",
    target: "Production Environment",
    status: "running",
    startedAt: "2024-01-20 14:00:00",
    completedAt: null,
    findings: {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    },
  },
]

const getSeverityColor = (severity: string) => {
  switch (severity) {
    case "critical":
      return "bg-red-50 text-red-700 border-red-200"
    case "high":
      return "bg-orange-50 text-orange-700 border-orange-200"
    case "medium":
      return "bg-yellow-50 text-yellow-700 border-yellow-200"
    case "low":
      return "bg-blue-50 text-blue-700 border-blue-200"
    default:
      return "bg-gray-50 text-gray-700 border-gray-200"
  }
}

const getStatusColor = (status: string) => {
  switch (status) {
    case "compliant":
    case "resolved":
    case "completed":
      return "bg-green-50 text-green-700 border-green-200"
    case "partially_compliant":
    case "in_progress":
    case "running":
      return "bg-yellow-50 text-yellow-700 border-yellow-200"
    case "non_compliant":
    case "open":
    case "failed":
      return "bg-red-50 text-red-700 border-red-200"
    default:
      return "bg-gray-50 text-gray-700 border-gray-200"
  }
}

const getStatusIcon = (status: string) => {
  switch (status) {
    case "compliant":
    case "resolved":
    case "completed":
      return <CheckCircle className="h-4 w-4 text-green-500" />
    case "non_compliant":
    case "open":
    case "failed":
      return <XCircle className="h-4 w-4 text-red-500" />
    case "partially_compliant":
    case "in_progress":
      return <AlertTriangle className="h-4 w-4 text-yellow-500" />
    case "running":
      return <RefreshCw className="h-4 w-4 text-blue-500 animate-spin" />
    default:
      return <Clock className="h-4 w-4 text-gray-400" />
  }
}

export default function SecurityPage() {
  const [refreshing, setRefreshing] = useState(false)

  const handleRefresh = () => {
    setRefreshing(true)
    setTimeout(() => setRefreshing(false), 2000)
  }

  const totalIssues = securityIssues.length
  const criticalIssues = securityIssues.filter(i => i.severity === 'critical').length
  const openIssues = securityIssues.filter(i => i.status === 'open').length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Security & Compliance</h1>
          <p className="text-muted-foreground">
            Monitor security posture and compliance status
          </p>
        </div>
        <Button onClick={handleRefresh} disabled={refreshing}>
          <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Security Overview */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Security Score</CardTitle>
            <Shield className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">82/100</div>
            <Progress value={82} className="mt-2" />
            <p className="text-xs text-muted-foreground mt-2">
              <span className="text-green-600">+5</span> from last week
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Critical Issues</CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{criticalIssues}</div>
            <p className="text-xs text-muted-foreground mt-2">
              Require immediate attention
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Open Issues</CardTitle>
            <XCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{openIssues}</div>
            <p className="text-xs text-muted-foreground mt-2">
              of {totalIssues} total issues
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Compliance</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">78%</div>
            <p className="text-xs text-muted-foreground mt-2">
              Average across frameworks
            </p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="compliance" className="space-y-4">
        <TabsList>
          <TabsTrigger value="compliance">Compliance</TabsTrigger>
          <TabsTrigger value="vulnerabilities">Vulnerabilities</TabsTrigger>
          <TabsTrigger value="scans">Security Scans</TabsTrigger>
          <TabsTrigger value="policies">Policies</TabsTrigger>
        </TabsList>

        <TabsContent value="compliance" className="space-y-4">
          {/* Compliance Frameworks */}
          <div className="grid gap-6 md:grid-cols-1 lg:grid-cols-2 xl:grid-cols-3">
            {complianceFrameworks.map((framework) => (
              <Card key={framework.id}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">{framework.name}</CardTitle>
                    {getStatusIcon(framework.status)}
                  </div>
                  <CardDescription>{framework.description}</CardDescription>
                  <Badge variant="outline" className={getStatusColor(framework.status)}>
                    {framework.status.replace('_', ' ')}
                  </Badge>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>Compliance Score</span>
                      <span className="font-medium">{framework.score}%</span>
                    </div>
                    <Progress value={framework.score} className="h-2" />
                  </div>

                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-muted-foreground">Compliant</span>
                      <div className="font-medium text-green-600">
                        {framework.controls.compliant}/{framework.controls.total}
                      </div>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Non-Compliant</span>
                      <div className="font-medium text-red-600">
                        {framework.controls.nonCompliant}
                      </div>
                    </div>
                  </div>

                  {framework.criticalIssues > 0 && (
                    <div className="flex items-center gap-2 text-sm text-red-600">
                      <AlertTriangle className="h-4 w-4" />
                      <span>{framework.criticalIssues} critical issues</span>
                    </div>
                  )}

                  <div className="space-y-1 text-xs text-muted-foreground">
                    <div>Last assessed: {framework.lastAssessed}</div>
                    <div>Next assessment: {framework.nextAssessment}</div>
                  </div>

                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="flex-1">
                      <Eye className="mr-2 h-3 w-3" />
                      View Details
                    </Button>
                    <Button variant="outline" size="sm" className="flex-1">
                      <Download className="mr-2 h-3 w-3" />
                      Report
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="vulnerabilities" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Security Issues</CardTitle>
              <CardDescription>Current security vulnerabilities and issues</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {securityIssues.map((issue) => (
                  <div key={issue.id} className="flex items-start gap-4 p-4 border rounded-lg">
                    <AlertTriangle className={`h-5 w-5 flex-shrink-0 mt-0.5 ${
                      issue.severity === 'critical' ? 'text-red-500' :
                      issue.severity === 'high' ? 'text-orange-500' :
                      issue.severity === 'medium' ? 'text-yellow-500' : 'text-blue-500'
                    }`} />
                    <div className="flex-1">
                      <div className="flex items-start justify-between">
                        <div>
                          <h4 className="font-medium">{issue.title}</h4>
                          <p className="text-sm text-muted-foreground mt-1">{issue.description}</p>
                          <div className="flex gap-2 mt-2">
                            <Badge variant="outline" className={getSeverityColor(issue.severity)}>
                              {issue.severity}
                            </Badge>
                            <Badge variant="outline" className={getStatusColor(issue.status)}>
                              {issue.status.replace('_', ' ')}
                            </Badge>
                            <Badge variant="secondary">{issue.category}</Badge>
                          </div>
                          <div className="text-xs text-muted-foreground mt-2">
                            Discovered {issue.discoveredAt} • Affects: {issue.affectedResources.join(', ')}
                          </div>
                        </div>
                        <Button variant="outline" size="sm">
                          Fix Issue
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="scans" className="space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-lg font-medium">Security Scans</h3>
              <p className="text-sm text-muted-foreground">Automated security scanning results</p>
            </div>
            <Button>
              <Scan className="mr-2 h-4 w-4" />
              Start New Scan
            </Button>
          </div>

          <div className="grid gap-4">
            {vulnerabilityScans.map((scan) => (
              <Card key={scan.id}>
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2">
                        {getStatusIcon(scan.status)}
                        <div>
                          <h4 className="font-medium">{scan.type}</h4>
                          <p className="text-sm text-muted-foreground">{scan.target}</p>
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <Badge variant="outline" className={getStatusColor(scan.status)}>
                        {scan.status}
                      </Badge>
                      <div className="text-xs text-muted-foreground mt-1">
                        Started: {scan.startedAt}
                        {scan.completedAt && <div>Completed: {scan.completedAt}</div>}
                      </div>
                    </div>
                  </div>

                  {scan.status === 'completed' && (
                    <div className="mt-4 grid grid-cols-4 gap-4">
                      <div className="text-center">
                        <div className="text-lg font-bold text-red-600">{scan.findings.critical}</div>
                        <div className="text-xs text-muted-foreground">Critical</div>
                      </div>
                      <div className="text-center">
                        <div className="text-lg font-bold text-orange-600">{scan.findings.high}</div>
                        <div className="text-xs text-muted-foreground">High</div>
                      </div>
                      <div className="text-center">
                        <div className="text-lg font-bold text-yellow-600">{scan.findings.medium}</div>
                        <div className="text-xs text-muted-foreground">Medium</div>
                      </div>
                      <div className="text-center">
                        <div className="text-lg font-bold text-blue-600">{scan.findings.low}</div>
                        <div className="text-xs text-muted-foreground">Low</div>
                      </div>
                    </div>
                  )}

                  <div className="mt-4 flex gap-2">
                    <Button variant="outline" size="sm">
                      <Eye className="mr-2 h-3 w-3" />
                      View Results
                    </Button>
                    <Button variant="outline" size="sm">
                      <Download className="mr-2 h-3 w-3" />
                      Export
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="policies" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Security Policies</CardTitle>
                <CardDescription>Current security policy configuration</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-medium">Password Policy</h4>
                    <p className="text-sm text-muted-foreground">Minimum 12 characters, complexity required</p>
                  </div>
                  <Badge variant="outline" className="bg-green-50 text-green-700">
                    Active
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-medium">MFA Enforcement</h4>
                    <p className="text-sm text-muted-foreground">Required for all admin users</p>
                  </div>
                  <Badge variant="outline" className="bg-yellow-50 text-yellow-700">
                    Partial
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-medium">Session Timeout</h4>
                    <p className="text-sm text-muted-foreground">8 hours inactivity timeout</p>
                  </div>
                  <Badge variant="outline" className="bg-green-50 text-green-700">
                    Active
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-medium">IP Allowlist</h4>
                    <p className="text-sm text-muted-foreground">Restrict access by IP address</p>
                  </div>
                  <Badge variant="outline" className="bg-gray-50 text-gray-700">
                    Disabled
                  </Badge>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Data Protection</CardTitle>
                <CardDescription>Data security and encryption settings</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-medium">Encryption at Rest</h4>
                    <p className="text-sm text-muted-foreground">AES-256 encryption for all data</p>
                  </div>
                  <Badge variant="outline" className="bg-green-50 text-green-700">
                    Active
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-medium">Encryption in Transit</h4>
                    <p className="text-sm text-muted-foreground">TLS 1.3 for all communications</p>
                  </div>
                  <Badge variant="outline" className="bg-green-50 text-green-700">
                    Active
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-medium">Key Rotation</h4>
                    <p className="text-sm text-muted-foreground">Automatic 90-day rotation</p>
                  </div>
                  <Badge variant="outline" className="bg-yellow-50 text-yellow-700">
                    Pending
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-medium">Backup Encryption</h4>
                    <p className="text-sm text-muted-foreground">Encrypted backups with separate keys</p>
                  </div>
                  <Badge variant="outline" className="bg-red-50 text-red-700">
                    Issue
                  </Badge>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Compliance Requirements</CardTitle>
              <CardDescription>Active compliance monitoring and requirements</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 border rounded-lg">
                  <div>
                    <h4 className="font-medium">Audit Logging</h4>
                    <p className="text-sm text-muted-foreground">All user actions and system events logged</p>
                  </div>
                  <CheckCircle className="h-5 w-5 text-green-500" />
                </div>
                <div className="flex items-center justify-between p-3 border rounded-lg">
                  <div>
                    <h4 className="font-medium">Data Retention</h4>
                    <p className="text-sm text-muted-foreground">7-year retention policy for audit logs</p>
                  </div>
                  <CheckCircle className="h-5 w-5 text-green-500" />
                </div>
                <div className="flex items-center justify-between p-3 border rounded-lg">
                  <div>
                    <h4 className="font-medium">Access Controls</h4>
                    <p className="text-sm text-muted-foreground">Role-based access with principle of least privilege</p>
                  </div>
                  <AlertTriangle className="h-5 w-5 text-yellow-500" />
                </div>
                <div className="flex items-center justify-between p-3 border rounded-lg">
                  <div>
                    <h4 className="font-medium">Incident Response</h4>
                    <p className="text-sm text-muted-foreground">Documented procedures and automated alerts</p>
                  </div>
                  <CheckCircle className="h-5 w-5 text-green-500" />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}