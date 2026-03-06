"use client"

import { motion } from "framer-motion"
import { CheckCircle, Circle, XCircle, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { type DeploymentPhase } from "@/hooks/useDeploymentStream"

interface DeployStepperProps {
  phases: DeploymentPhase[]
  className?: string
}

const phaseLabels: Record<string, string> = {
  validate: "Validate",
  clone: "Clone",
  build: "Build",
  deploy: "Deploy",
  health_check: "Health Check",
  rollback: "Rollback",
  pull: "Pull Image",
  preview: "Preview",
}

function formatDuration(start?: string, end?: string): string | null {
  if (!start) return null
  const s = new Date(start).getTime()
  const e = end ? new Date(end).getTime() : Date.now()
  const diff = Math.round((e - s) / 1000)
  if (diff < 1) return "<1s"
  if (diff < 60) return `${diff}s`
  return `${Math.floor(diff / 60)}m ${diff % 60}s`
}

function StepIcon({ status }: { status: DeploymentPhase["status"] }) {
  switch (status) {
    case "completed":
      return <CheckCircle className="h-5 w-5 text-green-500" />
    case "running":
      return (
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
        >
          <Loader2 className="h-5 w-5 text-blue-500" />
        </motion.div>
      )
    case "failed":
      return <XCircle className="h-5 w-5 text-red-500" />
    default:
      return <Circle className="h-5 w-5 text-muted-foreground/40" />
  }
}

export function DeployStepper({ phases, className }: DeployStepperProps) {
  if (phases.length === 0) return null

  return (
    <div
      className={cn("relative", className)}
      role="progressbar"
      aria-label="Deployment progress"
    >
      {/* Horizontal stepper for desktop */}
      <div className="hidden sm:flex items-start justify-between gap-2">
        {phases.map((phase, i) => {
          const isLast = i === phases.length - 1
          const duration = formatDuration(phase.startedAt, phase.completedAt)

          return (
            <div key={phase.name} className="flex items-start flex-1 min-w-0">
              {/* Step */}
              <div className="flex flex-col items-center text-center min-w-[80px]">
                <motion.div
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: i * 0.1 }}
                  className={cn(
                    "rounded-full p-1.5 border-2 transition-colors",
                    phase.status === "completed" && "border-green-500 bg-green-50 dark:bg-green-950",
                    phase.status === "running" && "border-blue-500 bg-blue-50 dark:bg-blue-950",
                    phase.status === "failed" && "border-red-500 bg-red-50 dark:bg-red-950",
                    phase.status === "pending" && "border-muted bg-muted/30"
                  )}
                >
                  <StepIcon status={phase.status} />
                </motion.div>
                <span
                  className={cn(
                    "text-xs font-medium mt-1.5",
                    phase.status === "running" && "text-blue-600 dark:text-blue-400",
                    phase.status === "completed" && "text-green-600 dark:text-green-400",
                    phase.status === "failed" && "text-red-600 dark:text-red-400",
                    phase.status === "pending" && "text-muted-foreground"
                  )}
                >
                  {phaseLabels[phase.name] || phase.name}
                </span>
                {duration && (
                  <span className="text-[10px] text-muted-foreground">{duration}</span>
                )}
              </div>

              {/* Connector line */}
              {!isLast && (
                <div className="flex-1 flex items-center mt-[18px] px-1">
                  <div className="w-full h-0.5 rounded-full overflow-hidden bg-muted">
                    <motion.div
                      className={cn(
                        "h-full rounded-full",
                        phase.status === "completed" ? "bg-green-500" : "bg-muted"
                      )}
                      initial={{ width: "0%" }}
                      animate={{
                        width: phase.status === "completed" ? "100%" : "0%",
                      }}
                      transition={{ duration: 0.4, ease: "easeOut" }}
                    />
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Vertical stepper for mobile */}
      <div className="sm:hidden space-y-3">
        {phases.map((phase, i) => {
          const isLast = i === phases.length - 1
          const duration = formatDuration(phase.startedAt, phase.completedAt)

          return (
            <div key={phase.name} className="flex gap-3">
              {/* Step icon + connector */}
              <div className="flex flex-col items-center">
                <motion.div
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: i * 0.1 }}
                  className={cn(
                    "rounded-full p-1 border-2 transition-colors",
                    phase.status === "completed" && "border-green-500",
                    phase.status === "running" && "border-blue-500",
                    phase.status === "failed" && "border-red-500",
                    phase.status === "pending" && "border-muted"
                  )}
                >
                  <StepIcon status={phase.status} />
                </motion.div>
                {!isLast && (
                  <div className="w-0.5 flex-1 my-1 bg-muted rounded-full overflow-hidden">
                    <motion.div
                      className={cn(
                        "w-full rounded-full",
                        phase.status === "completed" ? "bg-green-500" : "bg-muted"
                      )}
                      initial={{ height: "0%" }}
                      animate={{
                        height: phase.status === "completed" ? "100%" : "0%",
                      }}
                      transition={{ duration: 0.3 }}
                    />
                  </div>
                )}
              </div>

              {/* Label */}
              <div className="pb-3">
                <p
                  className={cn(
                    "text-sm font-medium",
                    phase.status === "running" && "text-blue-600 dark:text-blue-400",
                    phase.status === "completed" && "text-green-600 dark:text-green-400",
                    phase.status === "failed" && "text-red-600 dark:text-red-400",
                    phase.status === "pending" && "text-muted-foreground"
                  )}
                >
                  {phaseLabels[phase.name] || phase.name}
                </p>
                <p className="text-xs text-muted-foreground">{phase.message}</p>
                {duration && (
                  <p className="text-xs text-muted-foreground mt-0.5">{duration}</p>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
