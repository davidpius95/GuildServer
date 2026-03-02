"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Users,
  Plus,
  Search,
  Settings,
  Mail,
  Shield,
  Clock,
  Activity,
  MoreHorizontal,
  UserPlus,
  UserMinus,
  Edit,
  Key,
  RefreshCw
} from "lucide-react"
import { trpc } from "@/components/trpc-provider"
import { useOrganization } from "@/hooks/use-auth"

const getRoleColor = (role: string) => {
  switch (role) {
    case "owner":
      return "bg-purple-50 text-purple-700 border-purple-200"
    case "admin":
      return "bg-red-50 text-red-700 border-red-200"
    case "member":
    case "developer":
      return "bg-blue-50 text-blue-700 border-blue-200"
    case "viewer":
      return "bg-gray-50 text-gray-700 border-gray-200"
    default:
      return "bg-gray-50 text-gray-700 border-gray-200"
  }
}

export default function TeamPage() {
  const [searchQuery, setSearchQuery] = useState("")
  const { orgId, currentOrg } = useOrganization()

  // Real data queries
  const membersQuery = trpc.organization.getMembers.useQuery(
    { organizationId: orgId },
    { enabled: !!orgId }
  )

  const auditQuery = trpc.audit.getLogs.useQuery(
    { organizationId: orgId, limit: 20 },
    { enabled: !!orgId }
  )

  const members = membersQuery.data ?? []
  const auditLogs = auditQuery.data ?? []

  const filteredMembers = members.filter((member: any) =>
    (member.user?.name || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
    (member.user?.email || "").toLowerCase().includes(searchQuery.toLowerCase())
  )

  const activeMembers = members.filter((m: any) => m.user)
  const adminCount = members.filter((m: any) => m.role === "admin" || m.role === "owner").length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Team</h1>
          <p className="text-muted-foreground">
            Manage team members, roles, and permissions
          </p>
        </div>
        <Button onClick={() => membersQuery.refetch()}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Members</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{members.length}</div>
            <p className="text-xs text-muted-foreground">
              {activeMembers.length} active
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Organization</CardTitle>
            <Shield className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold truncate">{currentOrg?.name || "—"}</div>
            <p className="text-xs text-muted-foreground">
              {currentOrg?.slug || ""}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Admins</CardTitle>
            <Shield className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{adminCount}</div>
            <p className="text-xs text-muted-foreground">
              With admin access
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Audit Events</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{auditLogs.length}</div>
            <p className="text-xs text-muted-foreground">
              Recent actions
            </p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="members" className="space-y-4">
        <TabsList>
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="roles">Roles & Permissions</TabsTrigger>
          <TabsTrigger value="audit">Audit Log</TabsTrigger>
        </TabsList>

        <TabsContent value="members" className="space-y-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search team members..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>

          {/* Members List */}
          <Card>
            <CardHeader>
              <CardTitle>Team Members</CardTitle>
              <CardDescription>Manage your team members and their access</CardDescription>
            </CardHeader>
            <CardContent>
              {membersQuery.isLoading ? (
                <div className="text-center py-8 text-muted-foreground">Loading members...</div>
              ) : filteredMembers.length > 0 ? (
                <div className="space-y-4">
                  {filteredMembers.map((member: any) => {
                    const user = member.user
                    const initials = user?.name
                      ? user.name.split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2)
                      : user?.email?.slice(0, 2).toUpperCase() || "?"

                    return (
                      <div key={member.id} className="flex items-center justify-between p-4 border rounded-lg">
                        <div className="flex items-center gap-4">
                          <div className="h-10 w-10 rounded-full bg-primary flex items-center justify-center text-primary-foreground font-medium text-sm">
                            {initials}
                          </div>
                          <div>
                            <h4 className="font-medium">{user?.name || "Unknown"}</h4>
                            <p className="text-sm text-muted-foreground">{user?.email || ""}</p>
                            <div className="flex gap-2 mt-1">
                              <Badge variant="outline" className={getRoleColor(member.role)}>
                                {member.role}
                              </Badge>
                            </div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm text-muted-foreground">
                            <div>Joined {member.createdAt ? new Date(member.createdAt).toLocaleDateString() : "N/A"}</div>
                            {user?.lastLogin && (
                              <div>Last login {new Date(user.lastLogin).toLocaleDateString()}</div>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  {searchQuery ? "No members match your search" : "No team members found"}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="roles" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Role Definitions</CardTitle>
                <CardDescription>Default roles and their permissions</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-medium">Owner</h4>
                      <p className="text-sm text-muted-foreground">Full access to everything</p>
                    </div>
                    <Badge className={getRoleColor("owner")}>Owner</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-medium">Admin</h4>
                      <p className="text-sm text-muted-foreground">Manage team and deployments</p>
                    </div>
                    <Badge className={getRoleColor("admin")}>Admin</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-medium">Member</h4>
                      <p className="text-sm text-muted-foreground">Deploy and manage applications</p>
                    </div>
                    <Badge className={getRoleColor("member")}>Member</Badge>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Permission Matrix</CardTitle>
                <CardDescription>What each role can access</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="grid grid-cols-4 gap-2 text-sm font-medium">
                    <span>Permission</span>
                    <span className="text-center">Owner</span>
                    <span className="text-center">Admin</span>
                    <span className="text-center">Member</span>
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-sm">
                    <span>Billing</span>
                    <span className="text-center">✓</span>
                    <span className="text-center">-</span>
                    <span className="text-center">-</span>
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-sm">
                    <span>Team Management</span>
                    <span className="text-center">✓</span>
                    <span className="text-center">✓</span>
                    <span className="text-center">-</span>
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-sm">
                    <span>Deploy Apps</span>
                    <span className="text-center">✓</span>
                    <span className="text-center">✓</span>
                    <span className="text-center">✓</span>
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-sm">
                    <span>View Resources</span>
                    <span className="text-center">✓</span>
                    <span className="text-center">✓</span>
                    <span className="text-center">✓</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="audit" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Audit Log</CardTitle>
              <CardDescription>Recent organization activities and actions</CardDescription>
            </CardHeader>
            <CardContent>
              {auditQuery.isLoading ? (
                <div className="text-center py-8 text-muted-foreground">Loading audit logs...</div>
              ) : auditLogs.length > 0 ? (
                <div className="space-y-4">
                  {auditLogs.map((log: any) => (
                    <div key={log.id} className="flex items-start gap-4 p-4 border rounded-lg">
                      <Activity className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium">{log.action}</span>
                          {log.resourceType && (
                            <Badge variant="secondary" className="text-xs">
                              {log.resourceType}
                            </Badge>
                          )}
                          <span className="text-sm text-muted-foreground">•</span>
                          <span className="text-sm text-muted-foreground">
                            {new Date(log.createdAt).toLocaleString()}
                          </span>
                        </div>
                        {log.resourceName && (
                          <div className="text-sm text-muted-foreground">
                            Resource: {log.resourceName}
                          </div>
                        )}
                        {log.metadata && typeof log.metadata === 'object' && Object.keys(log.metadata).length > 0 && (
                          <div className="text-xs text-muted-foreground mt-1 font-mono bg-muted/50 p-2 rounded">
                            {JSON.stringify(log.metadata, null, 0).slice(0, 200)}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Activity className="h-12 w-12 mx-auto mb-2 opacity-30" />
                  <p>No audit logs found</p>
                  <p className="text-xs mt-1">Actions will appear here as they occur</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
