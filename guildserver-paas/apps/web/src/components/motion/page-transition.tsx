"use client"

import { motion, useReducedMotion } from "framer-motion"
import { type ReactNode } from "react"

interface PageTransitionProps {
  children: ReactNode
  className?: string
}

const variants = {
  hidden: { opacity: 0, y: 8 },
  enter: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
}

const reducedVariants = {
  hidden: { opacity: 1, y: 0 },
  enter: { opacity: 1, y: 0 },
  exit: { opacity: 1, y: 0 },
}

export function PageTransition({ children, className }: PageTransitionProps) {
  const prefersReduced = useReducedMotion()

  return (
    <motion.div
      variants={prefersReduced ? reducedVariants : variants}
      initial="hidden"
      animate="enter"
      exit="exit"
      transition={{ duration: prefersReduced ? 0 : 0.2, ease: "easeOut" }}
      className={className}
    >
      {children}
    </motion.div>
  )
}
