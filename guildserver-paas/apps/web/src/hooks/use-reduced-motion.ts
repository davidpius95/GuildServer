"use client"

import { useMediaQuery } from "./use-media-query"

/**
 * Returns true when the user prefers reduced motion.
 * Use this to disable animations when the system setting is enabled.
 *
 * @example
 * const prefersReducedMotion = useReducedMotion()
 * <motion.div animate={prefersReducedMotion ? false : { opacity: 1 }} />
 */
export function useReducedMotion(): boolean {
  return useMediaQuery("(prefers-reduced-motion: reduce)")
}
