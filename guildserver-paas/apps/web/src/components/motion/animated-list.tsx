"use client"

import { motion, useReducedMotion } from "framer-motion"
import { type ReactNode } from "react"

interface AnimatedListProps {
  children: ReactNode
  className?: string
  /** Delay between items in seconds */
  staggerDelay?: number
}

export function AnimatedList({
  children,
  className,
  staggerDelay = 0.05,
}: AnimatedListProps) {
  const prefersReduced = useReducedMotion()

  return (
    <motion.div
      variants={{
        hidden: { opacity: prefersReduced ? 1 : 0 },
        show: {
          opacity: 1,
          transition: { staggerChildren: prefersReduced ? 0 : staggerDelay },
        },
      }}
      initial="hidden"
      animate="show"
      className={className}
    >
      {children}
    </motion.div>
  )
}

interface AnimatedItemProps {
  children: ReactNode
  className?: string
}

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.25, ease: "easeOut" },
  },
}

const reducedItemVariants = {
  hidden: { opacity: 1, y: 0 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0 },
  },
}

export function AnimatedItem({ children, className }: AnimatedItemProps) {
  const prefersReduced = useReducedMotion()

  return (
    <motion.div variants={prefersReduced ? reducedItemVariants : itemVariants} className={className}>
      {children}
    </motion.div>
  )
}
