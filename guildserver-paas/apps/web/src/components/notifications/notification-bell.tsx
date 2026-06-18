"use client"

import { useRef, useEffect, useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { timeAgo } from "@/lib/format"
import { trpc } from "@/components/trpc-provider"
import { Bell, CheckCheck, Loader2 } from "lucide-react"

interface Notification {
  id: string
  title: string
  message: string
  read: boolean
  createdAt: string | Date
}

export function NotificationBell({ enabled }: { enabled: boolean }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const unreadCountQuery = trpc.notification.getUnreadCount.useQuery(undefined, {
    refetchInterval: 60000,
    staleTime: 30 * 1000,
    enabled,
  })
  const notificationsQuery = trpc.notification.list.useQuery(
    { limit: 10, offset: 0 },
    { enabled: open && enabled, staleTime: 30 * 1000 }
  )
  const markReadMutation = trpc.notification.markRead.useMutation({
    onSuccess: () => {
      unreadCountQuery.refetch()
      notificationsQuery.refetch()
    },
  })
  const markAllReadMutation = trpc.notification.markAllRead.useMutation({
    onSuccess: () => {
      unreadCountQuery.refetch()
      notificationsQuery.refetch()
    },
  })

  const unreadCount = unreadCountQuery.data?.count ?? 0

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  return (
    <div className="relative" ref={ref}>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen(!open)}
        className="relative"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-red-500 text-[10px] font-bold text-white flex items-center justify-center">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </Button>

      {open && (
        <div className="absolute right-0 mt-2 w-96 max-h-[480px] overflow-hidden rounded-lg border bg-popover shadow-lg z-50">
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <h3 className="text-sm font-semibold">Notifications</h3>
            {unreadCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs gap-1"
                onClick={() => markAllReadMutation.mutate()}
                disabled={markAllReadMutation.isPending}
              >
                <CheckCheck className="h-3 w-3" />
                Mark all read
              </Button>
            )}
          </div>

          <div className="overflow-y-auto max-h-[380px]">
            {notificationsQuery.isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : !notificationsQuery.data || notificationsQuery.data.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Bell className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">No notifications yet</p>
              </div>
            ) : (
              (notificationsQuery.data as Notification[]).map((notif) => (
                <div
                  key={notif.id}
                  className={cn(
                    "px-4 py-3 border-b last:border-0 hover:bg-accent/50 transition-colors cursor-pointer",
                    !notif.read && "bg-primary/5"
                  )}
                  onClick={() => {
                    if (!notif.read) {
                      markReadMutation.mutate({ id: notif.id })
                    }
                  }}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className={cn("text-sm truncate", !notif.read && "font-semibold")}>
                          {notif.title}
                        </p>
                        {!notif.read && (
                          <span className="h-2 w-2 rounded-full bg-primary flex-shrink-0" />
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                        {notif.message}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {timeAgo(notif.createdAt)}
                      </p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="border-t px-4 py-2">
            <Link
              href="/dashboard/notifications"
              className="text-xs text-primary hover:underline"
              onClick={() => setOpen(false)}
            >
              View all notifications
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
