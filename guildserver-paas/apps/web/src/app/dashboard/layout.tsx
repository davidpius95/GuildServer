"use client"

import { useState, memo } from "react"
import Image from "next/image"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { useAuth, useCurrentUser } from "@/hooks/use-auth"
import { ThemeToggle } from "@/components/theme-toggle"
import { NotificationBell } from "@/components/notifications/notification-bell"
import {
  LayoutDashboard,
  Rocket,
  Database,
  Settings,
  Users,
  BarChart3,
  Workflow,
  Shield,
  Menu,
  LogOut,
  Boxes,
  History,
  CreditCard,
  Server,
  UserCog,
} from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { PageTransition } from "@/components/motion/page-transition"
import { AnimatePresence, motion } from "framer-motion"

const navigation = [
  { name: "Overview", href: "/dashboard", icon: LayoutDashboard },
  { name: "Applications", href: "/dashboard/applications", icon: Rocket },
  { name: "Deployments", href: "/dashboard/deployments", icon: History },
  { name: "Databases", href: "/dashboard/databases", icon: Database },
  { name: "VPS Instances", href: "/dashboard/instances", icon: Server },
  { name: "Templates", href: "/dashboard/templates", icon: Boxes },
  { name: "Workflows", href: "/dashboard/workflows", icon: Workflow },
  { name: "Monitoring", href: "/dashboard/monitoring", icon: BarChart3 },
  { name: "Team", href: "/dashboard/team", icon: Users },
  { name: "Security", href: "/dashboard/security", icon: Shield },
  { name: "Billing", href: "/dashboard/billing", icon: CreditCard },
  { name: "Infrastructure", href: "/dashboard/admin/infrastructure", icon: Server, adminOnly: true },
  { name: "User Management", href: "/dashboard/admin/users", icon: UserCog, adminOnly: true },
  { name: "Settings", href: "/dashboard/settings", icon: Settings },
]

// Memoized sidebar navigation to prevent re-renders
const SidebarNav = memo(function SidebarNav({ pathname, isAdmin }: { pathname: string; isAdmin: boolean }) {
  const visibleNav = navigation.filter(item => !item.adminOnly || isAdmin)
  // Separate admin items for visual grouping
  const mainItems = visibleNav.filter(item => !item.adminOnly)
  const adminItems = visibleNav.filter(item => item.adminOnly)

  return (
    <nav className="flex-1 space-y-1 p-4 overflow-y-auto">
      {mainItems.map((item) => {
        const isActive = pathname === item.href ||
          (item.href !== "/dashboard" && pathname.startsWith(item.href))
        return (
          <Link
            key={item.name}
            href={item.href}
            prefetch={true}
            className={cn(
              "group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              isActive
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
            )}
          >
            <item.icon className={cn("h-4 w-4 shrink-0 transition-colors", isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground")} />
            {item.name}
          </Link>
        )
      })}
      {adminItems.length > 0 && (
        <>
          <div className="pt-4 pb-1 px-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">
              Admin
            </span>
          </div>
          {adminItems.map((item) => {
            const isActive = pathname === item.href ||
              (item.href !== "/dashboard" && pathname.startsWith(item.href))
            return (
              <Link
                key={item.name}
                href={item.href}
                prefetch={true}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.name}
              </Link>
            )
          })}
        </>
      )}
    </nav>
  )
})

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const pathname = usePathname()
  const { isReady, isAuthenticated, logout } = useAuth({ redirect: true })
  const { isAdmin } = useCurrentUser()

  // Show loading skeleton while checking auth
  if (!isReady || !isAuthenticated) {
    return (
      <div className="min-h-screen bg-background flex">
        {/* Sidebar skeleton */}
        <div className="hidden lg:flex w-64 flex-col border-r bg-card">
          <div className="flex h-16 items-center gap-2 border-b px-6">
            <Skeleton className="h-8 w-8 rounded-lg" />
            <Skeleton className="h-5 w-28" />
          </div>
          <div className="flex-1 p-4 space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full rounded-lg" />
            ))}
          </div>
        </div>
        {/* Main content skeleton */}
        <div className="flex-1">
          <div className="h-16 border-b flex items-center justify-end px-6 gap-2">
            <Skeleton className="h-8 w-8 rounded-full" />
            <Skeleton className="h-8 w-8 rounded-full" />
          </div>
          <div className="p-8 space-y-6">
            <div>
              <Skeleton className="h-9 w-48 mb-2" />
              <Skeleton className="h-5 w-72" />
            </div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="rounded-xl border bg-card p-6 space-y-3">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-8 w-16" />
                  <Skeleton className="h-3 w-32" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Sidebar — desktop: always visible; mobile: animated slide-in */}
      <aside
        aria-label="Main navigation"
        className="fixed inset-y-0 left-0 z-50 w-64 sidebar hidden lg:flex flex-col"
      >
        <div className="flex h-full flex-col">
          <div className="flex h-16 items-center gap-2 border-b px-6">
            <Image src="/logo.png" alt="GuildServer Logo" width={32} height={32} className="object-contain dark:invert" />
            <span className="text-xl font-bold">GuildServer</span>
            <Badge variant="secondary" className="ml-auto text-xs">
              PaaS
            </Badge>
          </div>
          <SidebarNav pathname={pathname} isAdmin={isAdmin} />
          <div className="border-t p-4 space-y-2">
            <Button
              variant="ghost"
              className="w-full justify-start gap-3"
              onClick={logout}
            >
              <LogOut className="h-4 w-4" />
              Sign Out
            </Button>
          </div>
        </div>
      </aside>

      {/* Mobile sidebar — animated with Framer Motion */}
      <AnimatePresence>
        {sidebarOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-40 bg-black/50 lg:hidden"
              onClick={() => setSidebarOpen(false)}
              aria-hidden="true"
            />
            <motion.aside
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="fixed inset-y-0 left-0 z-50 w-64 sidebar flex flex-col lg:hidden"
              aria-label="Main navigation"
            >
              <div className="flex h-full flex-col">
                <div className="flex h-16 items-center gap-2 border-b px-6">
                  <Image src="/logo.png" alt="GuildServer Logo" width={32} height={32} className="object-contain dark:invert" />
                  <span className="text-xl font-bold">GuildServer</span>
                  <Badge variant="secondary" className="ml-auto text-xs">
                    PaaS
                  </Badge>
                </div>
                <SidebarNav pathname={pathname} isAdmin={isAdmin} />
                <div className="border-t p-4 space-y-2">
                  <Button
                    variant="ghost"
                    className="w-full justify-start gap-3"
                    onClick={logout}
                  >
                    <LogOut className="h-4 w-4" />
                    Sign Out
                  </Button>
                </div>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Main content */}
      <div className="lg:pl-64">
        {/* Top bar */}
        <header className="page-header sticky top-0 z-40 h-16">
          <div className="flex h-full items-center justify-between px-4 sm:px-6 lg:px-8">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              aria-label={sidebarOpen ? "Close navigation menu" : "Open navigation menu"}
              aria-expanded={sidebarOpen}
            >
              <Menu className="h-5 w-5" />
            </Button>

            <div className="flex items-center gap-2 ml-auto">
              <ThemeToggle />
              <NotificationBell enabled={isAuthenticated} />
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="p-4 sm:p-6 lg:p-8">
          <AnimatePresence mode="wait">
            <PageTransition key={pathname}>
              {children}
            </PageTransition>
          </AnimatePresence>
        </main>
      </div>

      {/* Mobile sidebar overlay is handled by AnimatePresence above */}
    </div>
  )
}
