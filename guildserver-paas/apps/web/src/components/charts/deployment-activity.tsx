"use client"

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts"
import { trpc } from "@/components/trpc-provider"
import { Skeleton } from "@/components/ui/skeleton"

function formatDate(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00")
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
}

function formatShortDate(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00")
  return d.toLocaleDateString("en-US", { weekday: "short" })
}

interface DeploymentActivityProps {
  days?: number
  className?: string
}

export function DeploymentActivity({ days = 7, className }: DeploymentActivityProps) {
  const activityQuery = trpc.deployment.activity.useQuery(
    { days },
    { refetchInterval: 60000 } // Refresh every minute
  )

  if (activityQuery.isLoading) {
    return (
      <div className={className}>
        <Skeleton className="h-[200px] w-full rounded-lg" />
      </div>
    )
  }

  const data = activityQuery.data ?? []

  if (data.length === 0 || data.every((d) => d.total === 0)) {
    return (
      <div className={`flex items-center justify-center h-[200px] text-muted-foreground text-sm ${className}`}>
        No deployment activity in the last {days} days
      </div>
    )
  }

  const chartData = data.map((d) => ({
    ...d,
    label: formatShortDate(d.date),
    fullDate: formatDate(d.date),
  }))

  return (
    <div className={className}>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11 }}
            className="text-muted-foreground"
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fontSize: 11 }}
            className="text-muted-foreground"
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null
              const entry = payload[0]?.payload
              return (
                <div className="rounded-lg border bg-background p-3 shadow-md">
                  <p className="text-sm font-medium mb-1">{entry?.fullDate}</p>
                  <div className="space-y-0.5 text-xs">
                    <p className="text-green-600">Completed: {entry?.completed}</p>
                    <p className="text-red-600">Failed: {entry?.failed}</p>
                    {entry?.building > 0 && (
                      <p className="text-blue-600">In Progress: {entry?.building}</p>
                    )}
                    <p className="text-muted-foreground font-medium mt-1">Total: {entry?.total}</p>
                  </div>
                </div>
              )
            }}
          />
          <Bar
            dataKey="completed"
            stackId="a"
            fill="hsl(142, 71%, 45%)"
            radius={[0, 0, 0, 0]}
            name="Completed"
          />
          <Bar
            dataKey="failed"
            stackId="a"
            fill="hsl(0, 84%, 60%)"
            radius={[0, 0, 0, 0]}
            name="Failed"
          />
          <Bar
            dataKey="building"
            stackId="a"
            fill="hsl(217, 91%, 60%)"
            radius={[4, 4, 0, 0]}
            name="In Progress"
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
