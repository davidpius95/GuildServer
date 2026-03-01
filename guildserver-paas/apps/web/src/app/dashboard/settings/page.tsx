"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { 
  Settings,
  Building2,
  User,
  Bell,
  Shield,
  CreditCard,
  Key,
  Webhook,
  Database,
  Save,
  Edit,
  Trash2,
  Plus,
  ExternalLink,
  Copy,
  Eye,
  EyeOff
} from "lucide-react"

const organizationData = {
  name: "Acme Corporation",
  slug: "acme-corp",
  domain: "acme.com",
  plan: "Enterprise",
  billing: {
    status: "active",
    nextBilling: "2024-02-20",
    amount: "$299/month",
  },
  limits: {
    members: { current: 24, max: 100 },
    applications: { current: 12, max: 50 },
    databases: { current: 8, max: 25 },
  },
}

const apiKeys = [
  {
    id: "key-1",
    name: "Production Deploy Key",
    prefix: "gs_prod_",
    permissions: ["deploy", "read"],
    lastUsed: "2 hours ago",
    createdAt: "2023-12-15",
    createdBy: "john.doe@acme.com",
  },
  {
    id: "key-2",
    name: "CI/CD Pipeline Key",
    prefix: "gs_cicd_",
    permissions: ["deploy", "read", "write"],
    lastUsed: "1 day ago",
    createdAt: "2023-11-20",
    createdBy: "jane.smith@acme.com",
  },
  {
    id: "key-3",
    name: "Monitoring Key",
    prefix: "gs_mon_",
    permissions: ["read"],
    lastUsed: "5 minutes ago",
    createdAt: "2024-01-10",
    createdBy: "mike.johnson@acme.com",
  },
]

const webhooks = [
  {
    id: "webhook-1",
    name: "Slack Notifications",
    url: "https://hooks.slack.com/services/...",
    events: ["deployment.success", "deployment.failed", "alert.triggered"],
    status: "active",
    lastTriggered: "1 hour ago",
    createdAt: "2023-10-15",
  },
  {
    id: "webhook-2",
    name: "GitHub Integration",
    url: "https://api.github.com/repos/acme/...",
    events: ["deployment.success"],
    status: "active",
    lastTriggered: "6 hours ago",
    createdAt: "2023-09-20",
  },
  {
    id: "webhook-3",
    name: "Custom Monitoring",
    url: "https://monitoring.acme.com/webhook",
    events: ["alert.triggered", "system.down"],
    status: "inactive",
    lastTriggered: "Never",
    createdAt: "2024-01-05",
  },
]

export default function SettingsPage() {
  const [showApiKey, setShowApiKey] = useState<string | null>(null)
  const [editingOrg, setEditingOrg] = useState(false)

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
          <TabsTrigger value="api-keys">API Keys</TabsTrigger>
          <TabsTrigger value="webhooks">Webhooks</TabsTrigger>
          <TabsTrigger value="billing">Billing</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
        </TabsList>

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
                  onClick={() => setEditingOrg(!editingOrg)}
                >
                  <Edit className="mr-2 h-4 w-4" />
                  {editingOrg ? 'Cancel' : 'Edit'}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="org-name">Organization Name</Label>
                  <Input 
                    id="org-name" 
                    value={organizationData.name}
                    disabled={!editingOrg}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="org-slug">Organization Slug</Label>
                  <Input 
                    id="org-slug" 
                    value={organizationData.slug}
                    disabled={!editingOrg}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="org-domain">Domain</Label>
                <Input 
                  id="org-domain" 
                  value={organizationData.domain}
                  disabled={!editingOrg}
                />
              </div>
              {editingOrg && (
                <div className="flex gap-2">
                  <Button>
                    <Save className="mr-2 h-4 w-4" />
                    Save Changes
                  </Button>
                  <Button variant="outline" onClick={() => setEditingOrg(false)}>
                    Cancel
                  </Button>
                </div>
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
                    <span className="font-medium">
                      {organizationData.limits.members.current}/{organizationData.limits.members.max}
                    </span>
                    <div className="text-xs text-muted-foreground">members</div>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Settings className="h-4 w-4 text-muted-foreground" />
                    <span>Applications</span>
                  </div>
                  <div className="text-right">
                    <span className="font-medium">
                      {organizationData.limits.applications.current}/{organizationData.limits.applications.max}
                    </span>
                    <div className="text-xs text-muted-foreground">applications</div>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Database className="h-4 w-4 text-muted-foreground" />
                    <span>Databases</span>
                  </div>
                  <div className="text-right">
                    <span className="font-medium">
                      {organizationData.limits.databases.current}/{organizationData.limits.databases.max}
                    </span>
                    <div className="text-xs text-muted-foreground">databases</div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="profile" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Profile Information</CardTitle>
              <CardDescription>Manage your personal account settings</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="first-name">First Name</Label>
                  <Input id="first-name" value="John" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="last-name">Last Name</Label>
                  <Input id="last-name" value="Doe" />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email Address</Label>
                <Input id="email" type="email" value="john.doe@acme.com" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="timezone">Timezone</Label>
                <Input id="timezone" value="UTC-8 (Pacific Time)" />
              </div>
              <Button>
                <Save className="mr-2 h-4 w-4" />
                Save Profile
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Notification Preferences</CardTitle>
              <CardDescription>Choose how you want to receive notifications</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">Deployment Notifications</div>
                    <div className="text-sm text-muted-foreground">Get notified about deployments</div>
                  </div>
                  <Badge variant="outline" className="bg-green-50 text-green-700">
                    Enabled
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">Security Alerts</div>
                    <div className="text-sm text-muted-foreground">Important security notifications</div>
                  </div>
                  <Badge variant="outline" className="bg-green-50 text-green-700">
                    Enabled
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">Weekly Reports</div>
                    <div className="text-sm text-muted-foreground">Weekly usage and activity summary</div>
                  </div>
                  <Badge variant="outline" className="bg-gray-50 text-gray-700">
                    Disabled
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="api-keys" className="space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-lg font-medium">API Keys</h3>
              <p className="text-sm text-muted-foreground">Manage API keys for programmatic access</p>
            </div>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Create API Key
            </Button>
          </div>

          <div className="grid gap-4">
            {apiKeys.map((key) => (
              <Card key={key.id}>
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <Key className="h-8 w-8 text-muted-foreground" />
                      <div>
                        <h4 className="font-medium">{key.name}</h4>
                        <div className="flex items-center gap-2 mt-1">
                          <code className="text-sm bg-muted px-2 py-1 rounded">
                            {key.prefix}{'*'.repeat(20)}
                          </code>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setShowApiKey(showApiKey === key.id ? null : key.id)}
                          >
                            {showApiKey === key.id ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                          </Button>
                          <Button variant="ghost" size="sm">
                            <Copy className="h-3 w-3" />
                          </Button>
                        </div>
                        <div className="flex gap-1 mt-2">
                          {key.permissions.map((permission) => (
                            <Badge key={permission} variant="secondary" className="text-xs">
                              {permission}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm text-muted-foreground">
                        <div>Last used: {key.lastUsed}</div>
                        <div>Created: {key.createdAt}</div>
                        <div>By: {key.createdBy}</div>
                      </div>
                      <div className="flex gap-2 mt-2">
                        <Button variant="outline" size="sm">
                          <Edit className="mr-2 h-3 w-3" />
                          Edit
                        </Button>
                        <Button variant="outline" size="sm">
                          <Trash2 className="mr-2 h-3 w-3" />
                          Delete
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="webhooks" className="space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-lg font-medium">Webhooks</h3>
              <p className="text-sm text-muted-foreground">Configure webhook endpoints for events</p>
            </div>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Add Webhook
            </Button>
          </div>

          <div className="grid gap-4">
            {webhooks.map((webhook) => (
              <Card key={webhook.id}>
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <Webhook className="h-8 w-8 text-muted-foreground" />
                      <div>
                        <h4 className="font-medium">{webhook.name}</h4>
                        <p className="text-sm text-muted-foreground mt-1">{webhook.url}</p>
                        <div className="flex gap-1 mt-2">
                          {webhook.events.slice(0, 2).map((event) => (
                            <Badge key={event} variant="secondary" className="text-xs">
                              {event}
                            </Badge>
                          ))}
                          {webhook.events.length > 2 && (
                            <Badge variant="secondary" className="text-xs">
                              +{webhook.events.length - 2} more
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <Badge variant="outline" className={
                        webhook.status === 'active' 
                          ? 'bg-green-50 text-green-700' 
                          : 'bg-gray-50 text-gray-700'
                      }>
                        {webhook.status}
                      </Badge>
                      <div className="text-sm text-muted-foreground mt-2">
                        <div>Last triggered: {webhook.lastTriggered}</div>
                        <div>Created: {webhook.createdAt}</div>
                      </div>
                      <div className="flex gap-2 mt-2">
                        <Button variant="outline" size="sm">
                          <Edit className="mr-2 h-3 w-3" />
                          Edit
                        </Button>
                        <Button variant="outline" size="sm">
                          <ExternalLink className="mr-2 h-3 w-3" />
                          Test
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="billing" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Current Plan</CardTitle>
              <CardDescription>Your current subscription and billing information</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-medium">{organizationData.plan} Plan</h3>
                  <p className="text-sm text-muted-foreground">
                    Next billing: {organizationData.billing.nextBilling}
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold">{organizationData.billing.amount}</div>
                  <Badge variant="outline" className="bg-green-50 text-green-700">
                    {organizationData.billing.status}
                  </Badge>
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="outline">
                  <CreditCard className="mr-2 h-4 w-4" />
                  Update Payment Method
                </Button>
                <Button variant="outline">
                  <ExternalLink className="mr-2 h-4 w-4" />
                  View Invoices
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Usage This Month</CardTitle>
              <CardDescription>Your current usage across all resources</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="text-center">
                  <div className="text-2xl font-bold">2.4TB</div>
                  <div className="text-sm text-muted-foreground">Data Transfer</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold">1,543</div>
                  <div className="text-sm text-muted-foreground">Build Minutes</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold">89%</div>
                  <div className="text-sm text-muted-foreground">Uptime</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

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
                    <div className="font-medium">Two-Factor Authentication</div>
                    <div className="text-sm text-muted-foreground">Require 2FA for all team members</div>
                  </div>
                  <Badge variant="outline" className="bg-green-50 text-green-700">
                    Enabled
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">SSO Integration</div>
                    <div className="text-sm text-muted-foreground">Single sign-on with your identity provider</div>
                  </div>
                  <Badge variant="outline" className="bg-gray-50 text-gray-700">
                    Not Configured
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">IP Allowlist</div>
                    <div className="text-sm text-muted-foreground">Restrict access by IP address</div>
                  </div>
                  <Badge variant="outline" className="bg-gray-50 text-gray-700">
                    Disabled
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">Audit Logging</div>
                    <div className="text-sm text-muted-foreground">Log all user actions and API calls</div>
                  </div>
                  <Badge variant="outline" className="bg-green-50 text-green-700">
                    Enabled
                  </Badge>
                </div>
              </div>
              <Button>
                <Shield className="mr-2 h-4 w-4" />
                Configure Security
              </Button>
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
                <Button variant="destructive" size="sm">
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