"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { trpc } from "@/components/trpc-provider"
import { toast } from "sonner"
import {
  Bell,
  Loader2,
  CheckCheck,
  Check,
  RefreshCw,
  Rocket,
  XCircle,
  GitBranch,
  Clock,
  Shield,
  Users,
  Webhook,
} from "lucide-react"
import { cn } from "@/lib/utils"

const getNotificationIcon = (type: string) => {
  switch (type) {
    case "deployment_success":
      return <Rocket className="h-4 w-4 text-green-500" />
    case "deployment_failed":
      return <XCircle className="h-4 w-4 text-red-500" />
    case "preview_created":
      return <GitBranch className="h-4 w-4 text-purple-500" />
    case "preview_expired":
      return <Clock className="h-4 w-4 text-yellow-500" />
    case "certificate_expiring":
    case "certificate_failed":
      return <Shield className="h-4 w-4 text-yellow-500" />
    case "webhook_failed":
      return <Webhook className="h-4 w-4 text-orange-500" />
    case "member_added":
    case "member_removed":
      return <Users className="h-4 w-4 text-blue-500" />
    default:
      return <Bell className="h-4 w-4 text-muted-foreground" />
  }
}

function timeAgo(date: string | Date) {
  const now = new Date()
  const d = new Date(date)
  const diffMs = now.getTime() - d.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  if (diffMins < 1) return "just now"
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHrs = Math.floor(diffMins / 60)
  if (diffHrs < 24) return `${diffHrs}h ago`
  const diffDays = Math.floor(diffHrs / 24)
  return `${diffDays}d ago`
}

export default function NotificationsPage() {
  const [page, setPage] = useState(0)
  const [filterUnread, setFilterUnread] = useState(false)
  const limit = 20

  const notificationsQuery = trpc.notification.list.useQuery({
    limit,
    offset: page * limit,
    unreadOnly: filterUnread,
  })

  const unreadCountQuery = trpc.notification.getUnreadCount.useQuery()

  const markReadMutation = trpc.notification.markRead.useMutation({
    onSuccess: () => {
      notificationsQuery.refetch()
      unreadCountQuery.refetch()
    },
  })

  const markAllReadMutation = trpc.notification.markAllRead.useMutation({
    onSuccess: () => {
      toast.success("All notifications marked as read")
      notificationsQuery.refetch()
      unreadCountQuery.refetch()
    },
  })

  const notifications = notificationsQuery.data ?? []
  const unreadCount = unreadCountQuery.data?.count ?? 0

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <Bell className="h-8 w-8" />
            Notifications
          </h1>
          <p className="text-muted-foreground mt-1">
            {unreadCount > 0
              ? `You have ${unreadCount} unread notification${unreadCount !== 1 ? "s" : ""}`
              : "You're all caught up!"
            }
          </p>
        </div>
        <div className="flex gap-2">
          {unreadCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => markAllReadMutation.mutate()}
              disabled={markAllReadMutation.isPending}
            >
              <CheckCheck className="h-4 w-4 mr-2" />
              Mark all read
            </Button>
          )}
          <Button
            variant="outline"
            size="icon"
            onClick={() => notificationsQuery.refetch()}
            disabled={notificationsQuery.isRefetching}
          >
            <RefreshCw className={`h-4 w-4 ${notificationsQuery.isRefetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2">
        <Button
          variant={!filterUnread ? "default" : "outline"}
          size="sm"
          onClick={() => {
            setFilterUnread(false)
            setPage(0)
          }}
        >
          All
        </Button>
        <Button
          variant={filterUnread ? "default" : "outline"}
          size="sm"
          onClick={() => {
            setFilterUnread(true)
            setPage(0)
          }}
        >
          Unread
          {unreadCount > 0 && (
            <Badge variant="secondary" className="ml-1.5 text-xs">
              {unreadCount}
            </Badge>
          )}
        </Button>
      </div>

      {/* Notification List */}
      {notificationsQuery.isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : notifications.length === 0 ? (
        <Card className="text-center py-12">
          <CardContent>
            <Bell className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-30" />
            <h3 className="text-lg font-semibold mb-2">No notifications</h3>
            <p className="text-muted-foreground">
              {filterUnread
                ? "No unread notifications. You're all caught up!"
                : "Notifications will appear here when deployments complete, previews are created, or team events occur."
              }
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {notifications.map((notif: any) => (
            <Card
              key={notif.id}
              className={cn(
                "transition-colors",
                !notif.read && "border-primary/30 bg-primary/5"
              )}
            >
              <CardContent className="py-4">
                <div className="flex items-start gap-4">
                  <div className="mt-0.5">
                    {getNotificationIcon(notif.type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className={cn("text-sm", !notif.read && "font-semibold")}>
                        {notif.title}
                      </p>
                      {!notif.read && (
                        <span className="h-2 w-2 rounded-full bg-primary flex-shrink-0" />
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      {notif.message}
                    </p>
                    <p className="text-xs text-muted-foreground mt-2">
                      {timeAgo(notif.createdAt)}
                    </p>
                  </div>
                  <div>
                    {!notif.read && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs gap-1"
                        onClick={() => markReadMutation.mutate({ id: notif.id })}
                        disabled={markReadMutation.isPending}
                      >
                        <Check className="h-3 w-3" />
                        Read
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Pagination */}
      {notifications.length >= limit && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {page + 1}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={notifications.length < limit}
              onClick={() => setPage(page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
