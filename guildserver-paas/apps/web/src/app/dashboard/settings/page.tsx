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
} from "lucide-react"
import { trpc } from "@/components/trpc-provider"
import { useOrganization } from "@/hooks/use-auth"
import { toast } from "sonner"

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

  const org = orgQuery.data
  const members = membersQuery.data ?? []
  const auditStats = auditStatsQuery.data
  const prefs = prefsQuery.data ?? {}
  const slackConfig = slackConfigQuery.data

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
      </Tabs>
    </div>
  )
}
