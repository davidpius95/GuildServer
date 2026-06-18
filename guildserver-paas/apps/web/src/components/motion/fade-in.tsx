"use client"

import { motion, useReducedMotion } from "framer-motion"
import { type ReactNode } from "react"

interface FadeInProps {
  children: ReactNode
  className?: string
  /** Delay before animation starts in seconds */
  delay?: number
  /** Animation duration in seconds */
  duration?: number
  /** Direction to animate from */
  direction?: "up" | "down" | "left" | "right" | "none"
}

export function FadeIn({
  children,
  className,
  delay = 0,
  duration = 0.22,
  direction = "up",
}: FadeInProps) {
  const prefersReduced = useReducedMotion()

  const directionOffset = {
    up: { y: 12 },
    down: { y: -12 },
    left: { x: 12 },
    right: { x: -12 },
    none: {},
  }

  return (
    <motion.div
      initial={prefersReduced ? { opacity: 1 } : { opacity: 0, ...directionOffset[direction] }}
      animate={{ opacity: 1, x: 0, y: 0 }}
      transition={{ duration: prefersReduced ? 0 : duration, delay: prefersReduced ? 0 : delay, ease: [0.16, 1, 0.3, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  )
}
