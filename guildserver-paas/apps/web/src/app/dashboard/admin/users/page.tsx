"use client"

import { useState } from "react"
import { trpc } from "@/components/trpc-provider"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { toast } from "sonner"
import {
  Users,
  UserCheck,
  Shield,
  UserX,
  Search,
  Loader2,
  MoreHorizontal,
  Crown,
  User,
} from "lucide-react"
import { cn } from "@/lib/utils"

function StatCard({
  title,
  value,
  icon: Icon,
  color,
}: {
  title: string
  value: number | string
  icon: React.ComponentType<{ className?: string }>
  color: string
}) {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{title}</p>
            <p className="text-3xl font-bold mt-1">{value}</p>
          </div>
          <div className={cn("p-3 rounded-xl", color)}>
            <Icon className="h-6 w-6" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export default function UserManagementPage() {
  const [search, setSearch] = useState("")
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null)

  const utils = trpc.useUtils()

  // Queries
  const statsQuery = trpc.user.getStats.useQuery()
  const usersQuery = trpc.user.list.useQuery(
    { search: search || undefined, limit: 50, offset: 0 },
    { keepPreviousData: true }
  )

  // Mutations
  const updateUser = trpc.user.update.useMutation({
    onSuccess: (data) => {
      toast.success(`User role updated to ${data.role}`)
      utils.user.list.invalidate()
      utils.user.getStats.invalidate()
      setUpdatingUserId(null)
    },
    onError: (err) => {
      toast.error(err.message)
      setUpdatingUserId(null)
    },
  })

  const deleteUser = trpc.user.delete.useMutation({
    onSuccess: () => {
      toast.success("User deleted")
      utils.user.list.invalidate()
      utils.user.getStats.invalidate()
    },
    onError: (err) => toast.error(err.message),
  })

  const handleRoleToggle = (userId: string, currentRole: string) => {
    const newRole = currentRole === "admin" ? "user" : "admin"
    setUpdatingUserId(userId)
    updateUser.mutate({ id: userId, role: newRole })
  }

  const stats = statsQuery.data
  const users = usersQuery.data ?? []

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold">User Management</h1>
        <p className="text-muted-foreground">
          Manage user accounts and permissions
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {statsQuery.isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <Skeleton className="h-4 w-20 mb-3" />
                <Skeleton className="h-9 w-12" />
              </CardContent>
            </Card>
          ))
        ) : (
          <>
            <StatCard
              title="Total Users"
              value={stats?.total ?? 0}
              icon={Users}
              color="bg-blue-500/10 text-blue-500"
            />
            <StatCard
              title="Active (30d)"
              value={stats?.active ?? 0}
              icon={UserCheck}
              color="bg-green-500/10 text-green-500"
            />
            <StatCard
              title="Admins"
              value={stats?.admins ?? 0}
              icon={Shield}
              color="bg-purple-500/10 text-purple-500"
            />
            <StatCard
              title="Regular Users"
              value={stats?.regular ?? 0}
              icon={User}
              color="bg-gray-500/10 text-gray-500"
            />
          </>
        )}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search users by name or email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Users Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">All Users</CardTitle>
        </CardHeader>
        <CardContent>
          {usersQuery.isLoading ? (
            <div className="space-y-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4">
                  <Skeleton className="h-10 w-10 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-48" />
                  </div>
                  <Skeleton className="h-6 w-16" />
                </div>
              ))}
            </div>
          ) : users.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <UserX className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">
                {search ? "No users match your search" : "No users found"}
              </p>
            </div>
          ) : (
            <div className="divide-y">
              {users.map((user: any) => (
                <div
                  key={user.id}
                  className="flex items-center gap-4 py-4 first:pt-0 last:pb-0"
                >
                  {/* Avatar */}
                  <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    {user.avatar ? (
                      <img
                        src={user.avatar}
                        alt={user.name || user.email}
                        className="h-10 w-10 rounded-full object-cover"
                      />
                    ) : (
                      <span className="text-sm font-semibold text-primary">
                        {(user.name || user.email || "?").charAt(0).toUpperCase()}
                      </span>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate">
                        {user.name || "Unnamed User"}
                      </p>
                      {user.role === "admin" && (
                        <Badge className="bg-purple-500/10 text-purple-600 border-purple-500/20 text-[10px] px-1.5">
                          <Crown className="h-2.5 w-2.5 mr-0.5" />
                          Admin
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {user.email}
                    </p>
                    <div className="flex items-center gap-3 mt-0.5">
                      {user.lastLogin && (
                        <p className="text-[10px] text-muted-foreground">
                          Last login:{" "}
                          {new Date(user.lastLogin).toLocaleDateString()}
                        </p>
                      )}
                      {user.twoFactorEnabled && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          2FA
                        </Badge>
                      )}
                    </div>
                  </div>

                  {/* Org memberships count */}
                  {user.memberships && user.memberships.length > 0 && (
                    <div className="text-xs text-muted-foreground hidden sm:block">
                      {user.memberships.length} org{user.memberships.length !== 1 ? "s" : ""}
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      className={cn(
                        "text-xs h-8",
                        user.role === "admin"
                          ? "text-purple-600 hover:text-purple-700"
                          : "text-muted-foreground"
                      )}
                      onClick={() => handleRoleToggle(user.id, user.role)}
                      disabled={updatingUserId === user.id}
                    >
                      {updatingUserId === user.id ? (
                        <Loader2 className="h-3 w-3 animate-spin mr-1" />
                      ) : user.role === "admin" ? (
                        <Shield className="h-3 w-3 mr-1" />
                      ) : (
                        <User className="h-3 w-3 mr-1" />
                      )}
                      {user.role === "admin" ? "Demote" : "Promote"}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
