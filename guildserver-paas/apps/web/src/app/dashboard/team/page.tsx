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
  Key
} from "lucide-react"

const mockTeamMembers = [
  {
    id: "1",
    name: "John Doe",
    email: "john.doe@company.com",
    role: "owner",
    status: "active",
    joinedAt: "2023-06-15",
    lastActive: "2 hours ago",
    permissions: ["admin", "deploy", "billing"],
    avatar: "JD",
  },
  {
    id: "2",
    name: "Jane Smith",
    email: "jane.smith@company.com",
    role: "admin",
    status: "active",
    joinedAt: "2023-08-22",
    lastActive: "1 day ago",
    permissions: ["admin", "deploy"],
    avatar: "JS",
  },
  {
    id: "3",
    name: "Mike Johnson",
    email: "mike.johnson@company.com",
    role: "developer",
    status: "active",
    joinedAt: "2023-09-10",
    lastActive: "30 minutes ago",
    permissions: ["deploy", "read"],
    avatar: "MJ",
  },
  {
    id: "4",
    name: "Sarah Wilson",
    email: "sarah.wilson@company.com",
    role: "developer",
    status: "invited",
    joinedAt: "2024-01-18",
    lastActive: "Never",
    permissions: ["read"],
    avatar: "SW",
  },
  {
    id: "5",
    name: "Tom Brown",
    email: "tom.brown@company.com",
    role: "viewer",
    status: "inactive",
    joinedAt: "2023-07-05",
    lastActive: "2 weeks ago",
    permissions: ["read"],
    avatar: "TB",
  },
]

const invitations = [
  {
    id: "inv-1",
    email: "alex.garcia@company.com",
    role: "developer",
    invitedBy: "John Doe",
    invitedAt: "2024-01-19",
    status: "pending",
    expiresAt: "2024-01-26",
  },
  {
    id: "inv-2",
    email: "lisa.chen@company.com", 
    role: "admin",
    invitedBy: "Jane Smith",
    invitedAt: "2024-01-18",
    status: "pending",
    expiresAt: "2024-01-25",
  },
]

const auditLogs = [
  {
    id: "log-1",
    action: "Member invited",
    actor: "john.doe@company.com",
    target: "alex.garcia@company.com",
    timestamp: "2024-01-19 14:30:00",
    details: "Invited as developer with deploy permissions",
  },
  {
    id: "log-2",
    action: "Role changed",
    actor: "john.doe@company.com",
    target: "mike.johnson@company.com",
    timestamp: "2024-01-18 10:15:00",
    details: "Changed from viewer to developer",
  },
  {
    id: "log-3",
    action: "Member removed",
    actor: "jane.smith@company.com",
    target: "old.member@company.com",
    timestamp: "2024-01-17 16:45:00",
    details: "Removed from organization",
  },
]

const getRoleColor = (role: string) => {
  switch (role) {
    case "owner":
      return "bg-purple-50 text-purple-700 border-purple-200"
    case "admin":
      return "bg-red-50 text-red-700 border-red-200"
    case "developer":
      return "bg-blue-50 text-blue-700 border-blue-200"
    case "viewer":
      return "bg-gray-50 text-gray-700 border-gray-200"
    default:
      return "bg-gray-50 text-gray-700 border-gray-200"
  }
}

const getStatusColor = (status: string) => {
  switch (status) {
    case "active":
      return "bg-green-50 text-green-700 border-green-200"
    case "invited":
    case "pending":
      return "bg-yellow-50 text-yellow-700 border-yellow-200"
    case "inactive":
      return "bg-gray-50 text-gray-700 border-gray-200"
    default:
      return "bg-gray-50 text-gray-700 border-gray-200"
  }
}

export default function TeamPage() {
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedMember, setSelectedMember] = useState<string | null>(null)

  const filteredMembers = mockTeamMembers.filter(member =>
    member.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    member.email.toLowerCase().includes(searchQuery.toLowerCase())
  )

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
        <Button>
          <UserPlus className="mr-2 h-4 w-4" />
          Invite Member
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
            <div className="text-2xl font-bold">{mockTeamMembers.length}</div>
            <p className="text-xs text-muted-foreground">
              {mockTeamMembers.filter(m => m.status === 'active').length} active
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending Invites</CardTitle>
            <Mail className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{invitations.length}</div>
            <p className="text-xs text-muted-foreground">
              Awaiting response
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Admins</CardTitle>
            <Shield className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {mockTeamMembers.filter(m => m.role === 'admin' || m.role === 'owner').length}
            </div>
            <p className="text-xs text-muted-foreground">
              With admin access
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Recently Active</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {mockTeamMembers.filter(m => 
                m.lastActive.includes('hour') || m.lastActive.includes('minute')
              ).length}
            </div>
            <p className="text-xs text-muted-foreground">
              In last 24 hours
            </p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="members" className="space-y-4">
        <TabsList>
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="invitations">Invitations</TabsTrigger>
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
              <div className="space-y-4">
                {filteredMembers.map((member) => (
                  <div key={member.id} className="flex items-center justify-between p-4 border rounded-lg">
                    <div className="flex items-center gap-4">
                      <div className="h-10 w-10 rounded-full bg-primary flex items-center justify-center text-primary-foreground font-medium">
                        {member.avatar}
                      </div>
                      <div>
                        <h4 className="font-medium">{member.name}</h4>
                        <p className="text-sm text-muted-foreground">{member.email}</p>
                        <div className="flex gap-2 mt-1">
                          <Badge variant="outline" className={getRoleColor(member.role)}>
                            {member.role}
                          </Badge>
                          <Badge variant="outline" className={getStatusColor(member.status)}>
                            {member.status}
                          </Badge>
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm text-muted-foreground">
                        <div>Joined {member.joinedAt}</div>
                        <div>Active {member.lastActive}</div>
                      </div>
                      <div className="flex gap-2 mt-2">
                        <Button variant="outline" size="sm">
                          <Edit className="mr-2 h-3 w-3" />
                          Edit
                        </Button>
                        <Button variant="outline" size="sm">
                          <MoreHorizontal className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="invitations" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Pending Invitations</CardTitle>
              <CardDescription>Team invitations waiting for response</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {invitations.map((invitation) => (
                  <div key={invitation.id} className="flex items-center justify-between p-4 border rounded-lg">
                    <div className="flex items-center gap-4">
                      <Mail className="h-8 w-8 text-muted-foreground" />
                      <div>
                        <h4 className="font-medium">{invitation.email}</h4>
                        <div className="flex gap-4 text-sm text-muted-foreground">
                          <span>Invited as {invitation.role}</span>
                          <span>by {invitation.invitedBy}</span>
                          <span>on {invitation.invitedAt}</span>
                        </div>
                        <div className="mt-1">
                          <Badge variant="outline" className={getStatusColor(invitation.status)}>
                            {invitation.status}
                          </Badge>
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm text-muted-foreground mb-2">
                        Expires {invitation.expiresAt}
                      </div>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm">
                          Resend
                        </Button>
                        <Button variant="outline" size="sm">
                          Cancel
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
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
                      <h4 className="font-medium">Developer</h4>
                      <p className="text-sm text-muted-foreground">Deploy and manage applications</p>
                    </div>
                    <Badge className={getRoleColor("developer")}>Developer</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-medium">Viewer</h4>
                      <p className="text-sm text-muted-foreground">Read-only access</p>
                    </div>
                    <Badge className={getRoleColor("viewer")}>Viewer</Badge>
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
                  <div className="grid grid-cols-5 gap-2 text-sm font-medium">
                    <span>Permission</span>
                    <span className="text-center">Owner</span>
                    <span className="text-center">Admin</span>
                    <span className="text-center">Dev</span>
                    <span className="text-center">Viewer</span>
                  </div>
                  <div className="grid grid-cols-5 gap-2 text-sm">
                    <span>Billing</span>
                    <span className="text-center">✓</span>
                    <span className="text-center">-</span>
                    <span className="text-center">-</span>
                    <span className="text-center">-</span>
                  </div>
                  <div className="grid grid-cols-5 gap-2 text-sm">
                    <span>Team Management</span>
                    <span className="text-center">✓</span>
                    <span className="text-center">✓</span>
                    <span className="text-center">-</span>
                    <span className="text-center">-</span>
                  </div>
                  <div className="grid grid-cols-5 gap-2 text-sm">
                    <span>Deploy Apps</span>
                    <span className="text-center">✓</span>
                    <span className="text-center">✓</span>
                    <span className="text-center">✓</span>
                    <span className="text-center">-</span>
                  </div>
                  <div className="grid grid-cols-5 gap-2 text-sm">
                    <span>View Resources</span>
                    <span className="text-center">✓</span>
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
              <CardDescription>Recent team management activities</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {auditLogs.map((log) => (
                  <div key={log.id} className="flex items-start gap-4 p-4 border rounded-lg">
                    <Activity className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium">{log.action}</span>
                        <span className="text-sm text-muted-foreground">•</span>
                        <span className="text-sm text-muted-foreground">{log.timestamp}</span>
                      </div>
                      <div className="text-sm text-muted-foreground mb-1">
                        {log.actor} → {log.target}
                      </div>
                      <div className="text-sm">{log.details}</div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}