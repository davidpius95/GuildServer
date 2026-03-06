"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Switch } from "@/components/ui/switch"
import {
  Settings,
  User,
  Bell,
  Shield,
  Save,
  Edit,
  Trash2,
  CheckCircle,
  Server,
  Mail,
  MessageSquare,
  Inbox,
  Rocket,
  XCircle,
  GitBranch,
  Clock,
  Webhook,
  Users,
  Loader2,
  Send,
  Link2,
  Unplug,
  ExternalLink,
} from "lucide-react"
import { trpc } from "@/components/trpc-provider"
import { useOrganization } from "@/hooks/use-auth"
import { toast } from "sonner"

const API_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:4000"

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
  )
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  )
}

// Map notification events to human-readable labels and icons
const NOTIFICATION_EVENT_CONFIG: Record<string, { label: string; description: string; icon: React.ReactNode; category: string }> = {
  deployment_success: {
    label: "Deployment Succeeded",
    description: "When a deployment completes successfully",
    icon: <Rocket className="h-4 w-4 text-green-500" />,
    category: "Deployments",
  },
  deployment_failed: {
    label: "Deployment Failed",
    description: "When a deployment fails or errors out",
    icon: <XCircle className="h-4 w-4 text-red-500" />,
    category: "Deployments",
  },
  preview_created: {
    label: "Preview Created",
    description: "When a preview deployment is ready",
    icon: <GitBranch className="h-4 w-4 text-purple-500" />,
    category: "Previews",
  },
  preview_expired: {
    label: "Preview Expired",
    description: "When a preview deployment expires",
    icon: <Clock className="h-4 w-4 text-yellow-500" />,
    category: "Previews",
  },
  certificate_expiring: {
    label: "Certificate Expiring",
    description: "When an SSL certificate is about to expire",
    icon: <Shield className="h-4 w-4 text-yellow-500" />,
    category: "Security",
  },
  certificate_failed: {
    label: "Certificate Failed",
    description: "When SSL certificate provisioning fails",
    icon: <Shield className="h-4 w-4 text-red-500" />,
    category: "Security",
  },
  webhook_failed: {
    label: "Webhook Failed",
    description: "When a webhook delivery fails",
    icon: <Webhook className="h-4 w-4 text-orange-500" />,
    category: "Integrations",
  },
  member_added: {
    label: "Member Added",
    description: "When a new member joins the team",
    icon: <Users className="h-4 w-4 text-blue-500" />,
    category: "Team",
  },
  member_removed: {
    label: "Member Removed",
    description: "When a member is removed from the team",
    icon: <Users className="h-4 w-4 text-blue-500" />,
    category: "Team",
  },
}

export default function SettingsPage() {
  const [editingOrg, setEditingOrg] = useState(false)
  const [orgName, setOrgName] = useState("")
  const [orgDesc, setOrgDesc] = useState("")
  const [slackUrl, setSlackUrl] = useState("")
  const [slackChannel, setSlackChannel] = useState("")
  const { orgId, currentOrg } = useOrganization()

  // Real data queries
  const orgQuery = trpc.organization.getById.useQuery(
    { id: orgId },
    {
      enabled: !!orgId,
      onSuccess: (data: any) => {
        if (data) {
          setOrgName(data.name || "")
          setOrgDesc(data.description || "")
        }
      },
    }
  )

  const membersQuery = trpc.organization.getMembers.useQuery(
    { organizationId: orgId },
    { enabled: !!orgId }
  )

  const auditStatsQuery = trpc.audit.getStatistics.useQuery(
    { organizationId: orgId, timeRange: "30d" },
    { enabled: !!orgId }
  )

  const updateOrgMutation = trpc.organization.update.useMutation({
    onSuccess: () => {
      setEditingOrg(false)
      orgQuery.refetch()
    },
  })

  // Notification preferences
  const prefsQuery = trpc.notification.getPreferences.useQuery()
  const updatePrefsMutation = trpc.notification.updatePreferences.useMutation({
    onSuccess: () => {
      prefsQuery.refetch()
    },
  })

  // Slack config
  const slackConfigQuery = trpc.notification.getSlackConfig.useQuery(
    { organizationId: orgId },
    {
      enabled: !!orgId,
      onSuccess: (data: any) => {
        if (data) {
          setSlackUrl(data.webhookUrl || "")
          setSlackChannel(data.channelName || "")
        }
      },
    }
  )

  const setSlackConfigMutation = trpc.notification.setSlackConfig.useMutation({
    onSuccess: () => {
      toast.success("Slack configuration saved")
      slackConfigQuery.refetch()
    },
    onError: (err: any) => {
      toast.error(err.message || "Failed to save Slack config")
    },
  })

  const testSlackMutation = trpc.notification.testSlackNotification.useMutation({
    onSuccess: () => {
      toast.success("Test notification sent to Slack!")
    },
    onError: (err: any) => {
      toast.error(err.message || "Failed to send test notification")
    },
  })

  // Connected OAuth accounts
  const githubStatusQuery = trpc.github.getConnectionStatus.useQuery()
  const connectedAccountsQuery = trpc.github.getConnectedAccounts.useQuery()
  const disconnectMutation = trpc.github.disconnect.useMutation({
    onSuccess: () => {
      toast.success("Account disconnected")
      githubStatusQuery.refetch()
      connectedAccountsQuery.refetch()
    },
    onError: (err: any) => toast.error(err.message),
  })

  const org = orgQuery.data
  const members = membersQuery.data ?? []
  const auditStats = auditStatsQuery.data
  const prefs = prefsQuery.data ?? {}
  const slackConfig = slackConfigQuery.data
  const githubStatus = githubStatusQuery.data
  const connectedAccounts = connectedAccountsQuery.data ?? []

  const memberCount = members.length
  const projectCount = org?.projects?.length ?? 0

  const handleSaveOrg = () => {
    updateOrgMutation.mutate({
      id: orgId,
      name: orgName,
      description: orgDesc,
    })
  }

  const handleTogglePref = (event: string, channel: "emailEnabled" | "slackEnabled" | "inAppEnabled", currentValue: boolean) => {
    updatePrefsMutation.mutate({
      event: event as any,
      [channel]: !currentValue,
    })
  }

  const handleSaveSlack = () => {
    if (!slackUrl) {
      toast.error("Please enter a Slack webhook URL")
      return
    }
    setSlackConfigMutation.mutate({
      organizationId: orgId,
      webhookUrl: slackUrl,
      channelName: slackChannel || undefined,
      enabled: true,
    })
  }

  // Group events by category
  const categories = Object.entries(NOTIFICATION_EVENT_CONFIG).reduce<Record<string, { event: string; config: typeof NOTIFICATION_EVENT_CONFIG[string] }[]>>(
    (acc, [event, config]) => {
      if (!acc[config.category]) acc[config.category] = []
      acc[config.category].push({ event, config })
      return acc
    },
    {}
  )

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Settings</h1>
          <p className="text-muted-foreground">
            Manage your organization and account settings
          </p>
        </div>
      </div>

      <Tabs defaultValue="organization" className="space-y-4">
        <TabsList>
          <TabsTrigger value="organization">Organization</TabsTrigger>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="notifications">
            <Bell className="h-3.5 w-3.5 mr-1.5" />
            Notifications
          </TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          <TabsTrigger value="integrations">
            <Link2 className="h-3.5 w-3.5 mr-1.5" />
            Integrations
          </TabsTrigger>
        </TabsList>

        {/* ======================== ORGANIZATION TAB ======================== */}
        <TabsContent value="organization" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Organization Details</CardTitle>
                  <CardDescription>Manage your organization information and settings</CardDescription>
                </div>
                <Button
                  variant="outline"
                  onClick={() => {
                    if (editingOrg) {
                      setOrgName(org?.name || "")
                      setOrgDesc(org?.description || "")
                    }
                    setEditingOrg(!editingOrg)
                  }}
                >
                  <Edit className="mr-2 h-4 w-4" />
                  {editingOrg ? 'Cancel' : 'Edit'}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {orgQuery.isLoading ? (
                <div className="text-center py-4 text-muted-foreground">Loading...</div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="org-name">Organization Name</Label>
                      <Input
                        id="org-name"
                        value={editingOrg ? orgName : (org?.name || "")}
                        onChange={(e) => setOrgName(e.target.value)}
                        disabled={!editingOrg}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="org-slug">Organization Slug</Label>
                      <Input
                        id="org-slug"
                        value={org?.slug || ""}
                        disabled
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="org-desc">Description</Label>
                    <Input
                      id="org-desc"
                      value={editingOrg ? orgDesc : (org?.description || "")}
                      onChange={(e) => setOrgDesc(e.target.value)}
                      disabled={!editingOrg}
                      placeholder="Organization description"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Created</Label>
                    <div className="text-sm text-muted-foreground">
                      {org?.createdAt ? new Date(org.createdAt).toLocaleDateString() : "N/A"}
                    </div>
                  </div>
                  {editingOrg && (
                    <div className="flex gap-2">
                      <Button
                        onClick={handleSaveOrg}
                        disabled={updateOrgMutation.isPending}
                      >
                        <Save className="mr-2 h-4 w-4" />
                        {updateOrgMutation.isPending ? "Saving..." : "Save Changes"}
                      </Button>
                      <Button variant="outline" onClick={() => setEditingOrg(false)}>
                        Cancel
                      </Button>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Resource Usage</CardTitle>
              <CardDescription>Current usage across your organization</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <User className="h-4 w-4 text-muted-foreground" />
                    <span>Team Members</span>
                  </div>
                  <div className="text-right">
                    <span className="font-medium">{memberCount}</span>
                    <div className="text-xs text-muted-foreground">members</div>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Server className="h-4 w-4 text-muted-foreground" />
                    <span>Projects</span>
                  </div>
                  <div className="text-right">
                    <span className="font-medium">{projectCount}</span>
                    <div className="text-xs text-muted-foreground">projects</div>
                  </div>
                </div>
                {auditStats && (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Settings className="h-4 w-4 text-muted-foreground" />
                      <span>Audit Events (30d)</span>
                    </div>
                    <div className="text-right">
                      <span className="font-medium">{auditStats.totalEvents}</span>
                      <div className="text-xs text-muted-foreground">events</div>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ======================== PROFILE TAB ======================== */}
        <TabsContent value="profile" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Profile Information</CardTitle>
              <CardDescription>Your personal account details (read-only from auth)</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Name</Label>
                  <div className="text-sm p-2 bg-muted rounded">
                    {org?.members?.[0]?.user?.name || "N/A"}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Email</Label>
                  <div className="text-sm p-2 bg-muted rounded">
                    {org?.members?.[0]?.user?.email || "N/A"}
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Role in Organization</Label>
                <div>
                  <Badge variant="outline" className="bg-purple-50 text-purple-700">
                    {org?.members?.[0]?.role || "member"}
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ======================== NOTIFICATIONS TAB ======================== */}
        <TabsContent value="notifications" className="space-y-4">
          {/* Channel Legend */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bell className="h-5 w-5" />
                Notification Preferences
              </CardTitle>
              <CardDescription>
                Choose how you want to be notified for each event type. Changes are saved automatically.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-6 text-sm text-muted-foreground mb-6 pb-4 border-b">
                <div className="flex items-center gap-2">
                  <Inbox className="h-4 w-4" />
                  <span>In-App</span>
                </div>
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4" />
                  <span>Email</span>
                </div>
                <div className="flex items-center gap-2">
                  <MessageSquare className="h-4 w-4" />
                  <span>Slack</span>
                </div>
              </div>

              {prefsQuery.isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="space-y-8">
                  {Object.entries(categories).map(([category, events]) => (
                    <div key={category}>
                      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                        {category}
                      </h3>
                      <div className="space-y-1">
                        {events.map(({ event, config }) => {
                          const pref = prefs[event] ?? { emailEnabled: true, slackEnabled: false, inAppEnabled: true }
                          return (
                            <div
                              key={event}
                              className="flex items-center justify-between py-3 px-3 rounded-lg hover:bg-accent/50 transition-colors"
                            >
                              <div className="flex items-center gap-3 flex-1 min-w-0">
                                {config.icon}
                                <div>
                                  <p className="text-sm font-medium">{config.label}</p>
                                  <p className="text-xs text-muted-foreground">{config.description}</p>
                                </div>
                              </div>
                              <div className="flex items-center gap-6 ml-4">
                                {/* In-App toggle */}
                                <div className="flex flex-col items-center gap-1">
                                  <Switch
                                    checked={pref.inAppEnabled}
                                    onCheckedChange={() => handleTogglePref(event, "inAppEnabled", pref.inAppEnabled)}
                                    disabled={updatePrefsMutation.isPending}
                                  />
                                  <span className="text-[10px] text-muted-foreground">In-App</span>
                                </div>
                                {/* Email toggle */}
                                <div className="flex flex-col items-center gap-1">
                                  <Switch
                                    checked={pref.emailEnabled}
                                    onCheckedChange={() => handleTogglePref(event, "emailEnabled", pref.emailEnabled)}
                                    disabled={updatePrefsMutation.isPending}
                                  />
                                  <span className="text-[10px] text-muted-foreground">Email</span>
                                </div>
                                {/* Slack toggle */}
                                <div className="flex flex-col items-center gap-1">
                                  <Switch
                                    checked={pref.slackEnabled}
                                    onCheckedChange={() => handleTogglePref(event, "slackEnabled", pref.slackEnabled)}
                                    disabled={updatePrefsMutation.isPending}
                                  />
                                  <span className="text-[10px] text-muted-foreground">Slack</span>
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Slack Integration */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="h-5 w-5" />
                Slack Integration
              </CardTitle>
              <CardDescription>
                Connect a Slack incoming webhook to receive notifications in your team channel.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {slackConfig && (
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant="outline" className={slackConfig.enabled
                    ? "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-400"
                    : "bg-yellow-50 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-400"
                  }>
                    <CheckCircle className="w-3 h-3 mr-1" />
                    {slackConfig.enabled ? "Connected" : "Disabled"}
                  </Badge>
                  {slackConfig.channelName && (
                    <span className="text-sm text-muted-foreground">
                      Channel: #{slackConfig.channelName}
                    </span>
                  )}
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="slack-url">Webhook URL</Label>
                <Input
                  id="slack-url"
                  placeholder="https://hooks.slack.com/services/T.../B.../..."
                  value={slackUrl}
                  onChange={(e) => setSlackUrl(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Create an incoming webhook in your Slack workspace settings and paste the URL here.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="slack-channel">Channel Name (optional)</Label>
                <Input
                  id="slack-channel"
                  placeholder="#deployments"
                  value={slackChannel}
                  onChange={(e) => setSlackChannel(e.target.value)}
                />
              </div>

              <div className="flex gap-2">
                <Button
                  onClick={handleSaveSlack}
                  disabled={setSlackConfigMutation.isPending || !slackUrl}
                >
                  <Save className="mr-2 h-4 w-4" />
                  {setSlackConfigMutation.isPending ? "Saving..." : "Save Slack Config"}
                </Button>
                {slackConfig?.webhookUrl && (
                  <Button
                    variant="outline"
                    onClick={() => testSlackMutation.mutate({ organizationId: orgId })}
                    disabled={testSlackMutation.isPending}
                  >
                    <Send className="mr-2 h-4 w-4" />
                    {testSlackMutation.isPending ? "Sending..." : "Send Test"}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Email Configuration Status */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mail className="h-5 w-5" />
                Email Notifications
              </CardTitle>
              <CardDescription>
                Email notification delivery status
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                <div className="h-8 w-8 rounded-full bg-yellow-100 dark:bg-yellow-900 flex items-center justify-center">
                  <Mail className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
                </div>
                <div>
                  <p className="text-sm font-medium">SMTP Not Configured</p>
                  <p className="text-xs text-muted-foreground">
                    Email notifications are disabled. Configure SMTP_HOST, SMTP_PORT, SMTP_USER, and SMTP_PASS in your environment variables to enable email delivery.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ======================== SECURITY TAB ======================== */}
        <TabsContent value="security" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Security Settings</CardTitle>
              <CardDescription>Manage your organization's security configuration</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">JWT Authentication</div>
                    <div className="text-sm text-muted-foreground">Token-based authentication for all API calls</div>
                  </div>
                  <Badge variant="outline" className="bg-green-50 text-green-700">
                    <CheckCircle className="w-3 h-3 mr-1" />
                    Active
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">Role-Based Access Control</div>
                    <div className="text-sm text-muted-foreground">Owner, Admin, and Member roles</div>
                  </div>
                  <Badge variant="outline" className="bg-green-50 text-green-700">
                    <CheckCircle className="w-3 h-3 mr-1" />
                    Active
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">Audit Logging</div>
                    <div className="text-sm text-muted-foreground">Log all user actions and API calls</div>
                  </div>
                  <Badge variant="outline" className="bg-green-50 text-green-700">
                    <CheckCircle className="w-3 h-3 mr-1" />
                    Active
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">Environment Variable Encryption</div>
                    <div className="text-sm text-muted-foreground">AES-256-CBC encryption for secrets</div>
                  </div>
                  <Badge variant="outline" className="bg-green-50 text-green-700">
                    <CheckCircle className="w-3 h-3 mr-1" />
                    Active
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Danger Zone</CardTitle>
              <CardDescription>Irreversible and destructive actions</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="p-4 border border-red-200 rounded-lg bg-red-50">
                <h4 className="font-medium text-red-900 mb-2">Delete Organization</h4>
                <p className="text-sm text-red-700 mb-3">
                  Permanently delete this organization and all associated data. This action cannot be undone.
                </p>
                <Button variant="destructive" size="sm" disabled>
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete Organization
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ======================== INTEGRATIONS TAB ======================== */}
        <TabsContent value="integrations" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Link2 className="h-5 w-5" />
                Connected Accounts
              </CardTitle>
              <CardDescription>
                Manage your OAuth connections. Link GitHub to browse and deploy repositories like Vercel.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {connectedAccountsQuery.isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <>
                  {/* GitHub Connection */}
                  <div className="flex items-center justify-between p-4 border rounded-lg">
                    <div className="flex items-center gap-4">
                      <div className="h-10 w-10 rounded-full bg-gray-900 dark:bg-white flex items-center justify-center">
                        <GitHubIcon className="h-5 w-5 text-white dark:text-gray-900" />
                      </div>
                      <div>
                        <div className="font-medium flex items-center gap-2">
                          GitHub
                          {githubStatus?.connected && (
                            <Badge variant="outline" className="bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-400 text-xs">
                              <CheckCircle className="w-3 h-3 mr-1" />
                              Connected
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {githubStatus?.connected
                            ? githubStatus.hasRepoScope
                              ? "Full access — can browse and deploy from your repositories"
                              : "Login only — grant repo access to browse repositories"
                            : "Connect to sign in with GitHub and browse your repositories"
                          }
                        </p>
                        {githubStatus?.connected && githubStatus.scope && (
                          <p className="text-xs text-muted-foreground mt-1">
                            Scopes: {githubStatus.scope}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {githubStatus?.connected ? (
                        <>
                          {!githubStatus.hasRepoScope && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                window.location.href = `${API_URL}/auth/github?scope=repo`
                              }}
                            >
                              <ExternalLink className="mr-2 h-3.5 w-3.5" />
                              Grant Repo Access
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-600 hover:text-red-700 hover:bg-red-50"
                            onClick={() => disconnectMutation.mutate({ provider: "github" })}
                            disabled={disconnectMutation.isPending}
                          >
                            <Unplug className="mr-2 h-3.5 w-3.5" />
                            Disconnect
                          </Button>
                        </>
                      ) : (
                        <Button
                          onClick={() => {
                            window.location.href = `${API_URL}/auth/github?scope=repo`
                          }}
                        >
                          <GitHubIcon className="mr-2 h-4 w-4" />
                          Connect GitHub
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Google Connection */}
                  {(() => {
                    const googleAccount = connectedAccounts.find((a: any) => a.provider === "google")
                    return (
                      <div className="flex items-center justify-between p-4 border rounded-lg">
                        <div className="flex items-center gap-4">
                          <div className="h-10 w-10 rounded-full bg-white dark:bg-gray-800 border flex items-center justify-center">
                            <GoogleIcon className="h-5 w-5" />
                          </div>
                          <div>
                            <div className="font-medium flex items-center gap-2">
                              Google
                              {googleAccount && (
                                <Badge variant="outline" className="bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-400 text-xs">
                                  <CheckCircle className="w-3 h-3 mr-1" />
                                  Connected
                                </Badge>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground">
                              {googleAccount
                                ? "Connected for sign-in"
                                : "Connect to sign in with your Google account"
                              }
                            </p>
                          </div>
                        </div>
                        <div>
                          {googleAccount ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-red-600 hover:text-red-700 hover:bg-red-50"
                              onClick={() => disconnectMutation.mutate({ provider: "google" })}
                              disabled={disconnectMutation.isPending}
                            >
                              <Unplug className="mr-2 h-3.5 w-3.5" />
                              Disconnect
                            </Button>
                          ) : (
                            <Button
                              variant="outline"
                              onClick={() => {
                                window.location.href = `${API_URL}/auth/google`
                              }}
                            >
                              <GoogleIcon className="mr-2 h-4 w-4" />
                              Connect Google
                            </Button>
                          )}
                        </div>
                      </div>
                    )
                  })()}
                </>
              )}
            </CardContent>
          </Card>

          {/* Info Card */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-start gap-3 text-sm text-muted-foreground">
                <Shield className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-medium text-foreground mb-1">About Connected Accounts</p>
                  <p>
                    OAuth connections allow you to sign in quickly and securely. Connecting GitHub with repo access
                    enables you to browse and select repositories when creating new applications — just like Vercel.
                    You can disconnect at any time.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
