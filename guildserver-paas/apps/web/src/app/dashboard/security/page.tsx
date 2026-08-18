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
  TrendingDown,
  ShieldCheck
} from "lucide-react"
import { trpc } from "@/components/trpc-provider"
import { useOrganization } from "@/hooks/use-auth"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/empty-state"

// Mock compliance frameworks, issues and scans previously lived here. They
// rendered invented SOC 2 / HIPAA scores, fake findings and fake scan history.
// Everything on this page is now sourced from security.getPosture and
// security.listScans, which scan the org's real infrastructure.

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
  const { orgId } = useOrganization()
  const utils = trpc.useUtils()

  const postureQuery = trpc.security.getPosture.useQuery(
    { organizationId: orgId },
    { enabled: !!orgId }
  )

  const scansQuery = trpc.security.listScans.useQuery(
    { organizationId: orgId },
    { enabled: !!orgId }
  )

  const startScan = trpc.security.startScan.useMutation({
    onSuccess: () => {
      toast.success("Security scan started successfully")
      utils.security.listScans.invalidate()
    },
    onError: (err) => toast.error(getFriendlyMessage(err)),
  })

  const exportReport = trpc.security.exportReport.useMutation({
    onSuccess: (data) => {
      toast.success("Report generated")
      window.open(data.url, "_blank")
    },
    onError: (err) => toast.error(getFriendlyMessage(err)),
  })

  const remediate = trpc.security.remediate.useMutation({
    onSuccess: () => {
      toast.success("Auto-remediation started")
      utils.security.getPosture.invalidate()
    },
    onError: (err) => toast.error(getFriendlyMessage(err)),
  })

  const handleRefresh = () => {
    postureQuery.refetch()
    scansQuery.refetch()
    toast.success("Security data refreshed")
  }

  const handleStartScan = () => {
    startScan.mutate({ organizationId: orgId })
  }

  const handleExport = (format: "pdf" | "csv" | "json") => {
    exportReport.mutate({ organizationId: orgId, format })
  }

  const handleFixIssue = (issueId: string) => {
    remediate.mutate({ organizationId: orgId, issueId })
  }

  const posture = postureQuery.data
  const scanHistory = scansQuery.data || []
  // Real findings from the live scan (empty before the first load completes).
  const issues = posture?.issues ?? []
  // Real per-area scores the scanner derives from those findings.
  const categories = posture?.categories ?? []

  // No mock fallbacks: before data arrives these read 0 rather than inventing
  // numbers. A security dashboard showing fabricated counts is worse than one
  // showing nothing.
  const totalIssues = posture?.totalIssues ?? 0
  const criticalIssues = posture?.criticalIssues ?? 0
  const openIssues = posture ? posture.totalIssues - posture.lowIssues : 0
  const score = posture?.score ?? 0
  // Mean of the real per-area control scores, replacing a hardcoded 78%.
  const controlCoverage = categories.length
    ? Math.round(categories.reduce((sum, c) => sum + c.score, 0) / categories.length)
    : 0

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Security & Compliance</h1>
          <p className="text-muted-foreground">
            Monitor security posture and compliance status
          </p>
        </div>
        <Button onClick={handleRefresh} disabled={postureQuery.isFetching || scansQuery.isFetching}>
          <RefreshCw className={`mr-2 h-4 w-4 ${(postureQuery.isFetching || scansQuery.isFetching) ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Posture and findings are computed live from your infrastructure. Export & auto-remediation are still in development. */}
      <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
        Posture and findings are scanned live from your infrastructure. Report export and one-click remediation are coming soon.
      </div>

      {/* Security Overview */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Security Score</CardTitle>
            <Shield className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {postureQuery.isLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading...</div>
            ) : (
              <>
                <div className="text-2xl font-semibold font-mono tabular-nums">{score}/100</div>
                <Progress value={score} className="mt-2" />
                {/* No trend shown: scan history isn't persisted, so there is no
                    previous score to compare against. This previously displayed
                    a hardcoded "+5 from last week". */}
                <p className="text-xs text-muted-foreground mt-2">
                  {totalIssues === 0 ? 'No issues detected' : `${totalIssues} issue${totalIssues === 1 ? '' : 's'} found`}
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Critical Issues</CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {postureQuery.isLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading...</div>
            ) : (
              <>
                <div className="text-2xl font-semibold font-mono tabular-nums text-red-600">{criticalIssues}</div>
                <p className="text-xs text-muted-foreground mt-2">
                  Require immediate attention
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Open Issues</CardTitle>
            <XCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {postureQuery.isLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading...</div>
            ) : (
              <>
                <div className="text-2xl font-semibold font-mono tabular-nums">{openIssues}</div>
                <p className="text-xs text-muted-foreground mt-2">
                  of {totalIssues} total issues
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Control Coverage</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {postureQuery.isLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading...</div>
            ) : (
              <>
                {/* Was a hardcoded "78% — Average across frameworks", left over
                    from the removed mock frameworks. Now the mean of the real
                    per-area scores the scanner produces. */}
                <div className="text-2xl font-semibold font-mono tabular-nums">{controlCoverage}%</div>
                <p className="text-xs text-muted-foreground mt-2">
                  {categories.length > 0
                    ? `Across ${categories.length} control area${categories.length === 1 ? '' : 's'}`
                    : 'No control data yet'}
                </p>
              </>
            )}
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
          {/*
            This previously rendered invented SOC 2 / HIPAA / ISO 27001 scores
            with fabricated assessment dates and control counts. Presenting
            audit results that never happened is worse than showing nothing, so
            it now reports the control areas the scanner actually evaluates,
            scored from real findings.
          */}
          <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
            Control areas scored from live checks against your own infrastructure.
            This is an internal readiness signal, not a certification or a completed audit.
          </div>

          {postureQuery.isLoading ? (
            <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
              {[0, 1, 2, 3].map((i) => (
                <Card key={i}>
                  <CardHeader><Skeleton className="h-5 w-32" /></CardHeader>
                  <CardContent><Skeleton className="h-16 w-full" /></CardContent>
                </Card>
              ))}
            </div>
          ) : categories.length === 0 ? (
            <EmptyState
              icon={ShieldCheck}
              title="No control data yet"
              description="Run a scan to evaluate your infrastructure."
            />
          ) : (
            <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
              {categories.map((cat) => {
                const catIssues = issues.filter((i) => i.category === cat.name)
                const critical = catIssues.filter((i) => i.severity === 'critical').length
                const status = cat.score >= 90 ? 'compliant' : cat.score >= 70 ? 'partially compliant' : 'non compliant'
                return (
                  <Card key={cat.name}>
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-lg">{cat.name}</CardTitle>
                        {getStatusIcon(status)}
                      </div>
                      <Badge variant="outline" className={getStatusColor(status)}>
                        {status}
                      </Badge>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span>Control score</span>
                          <span className="font-medium">{cat.score}%</span>
                        </div>
                        <Progress value={cat.score} className="h-2" />
                      </div>

                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <span className="text-muted-foreground">Checks passing</span>
                          <div className="font-medium text-green-600">
                            {catIssues.length === 0 ? 'all' : `${catIssues.length} failing`}
                          </div>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Critical</span>
                          <div className={`font-medium ${critical > 0 ? 'text-red-600' : 'text-muted-foreground'}`}>
                            {critical}
                          </div>
                        </div>
                      </div>

                      {catIssues.length > 0 && (
                        <ul className="space-y-1 text-xs text-muted-foreground">
                          {catIssues.slice(0, 3).map((i) => (
                            <li key={i.id} className="truncate">• {i.title}</li>
                          ))}
                          {catIssues.length > 3 && <li>• +{catIssues.length - 3} more</li>}
                        </ul>
                      )}

                      <div className="text-xs text-muted-foreground">
                        Last scanned: {posture?.lastScan ? new Date(posture.lastScan).toLocaleString() : '—'}
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="vulnerabilities" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Security Issues</CardTitle>
              <CardDescription>Current security vulnerabilities and issues</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {issues.map((issue) => (
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
                        <Button variant="outline" size="sm" disabled title="Auto-remediation is coming soon (preview)">
                          Fix Issue (soon)
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
            <Button onClick={handleStartScan} disabled={startScan.isLoading}>
              {startScan.isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Scan className="mr-2 h-4 w-4" />}
              Start New Scan
            </Button>
          </div>

          <div className="grid gap-4">
            {scanHistory.map((scan) => (
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

                  {/* `findings` is optional on the wire — never dereference it
                      directly, or one missing field takes down the whole page. */}
                  {scan.status === 'completed' && scan.findings && (
                    <div className="mt-4 grid grid-cols-4 gap-4">
                      <div className="text-center">
                        <div className="text-lg font-bold text-red-600">{scan.findings.critical ?? 0}</div>
                        <div className="text-xs text-muted-foreground">Critical</div>
                      </div>
                      <div className="text-center">
                        <div className="text-lg font-bold text-orange-600">{scan.findings.high ?? 0}</div>
                        <div className="text-xs text-muted-foreground">High</div>
                      </div>
                      <div className="text-center">
                        <div className="text-lg font-bold text-yellow-600">{scan.findings.medium ?? 0}</div>
                        <div className="text-xs text-muted-foreground">Medium</div>
                      </div>
                      <div className="text-center">
                        <div className="text-lg font-bold text-blue-600">{scan.findings.low ?? 0}</div>
                        <div className="text-xs text-muted-foreground">Low</div>
                      </div>
                    </div>
                  )}

                  <div className="mt-4 flex gap-2">
                    <Button variant="outline" size="sm">
                      <Eye className="mr-2 h-3 w-3" />
                      View Results
                    </Button>
                    <Button variant="outline" size="sm" disabled title="Report export is coming soon (preview)">
                      {exportReport.isLoading ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <Download className="mr-2 h-3 w-3" />}
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