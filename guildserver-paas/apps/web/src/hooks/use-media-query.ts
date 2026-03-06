"use client"

import { useState, useEffect } from "react"

/**
 * Hook to track media query state.
 * Returns true when the query matches.
 *
 * @example
 * const isMobile = useMediaQuery("(max-width: 640px)")
 * const isTablet = useMediaQuery("(max-width: 768px)")
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false)

  useEffect(() => {
    const mql = window.matchMedia(query)
    setMatches(mql.matches)

    const handler = (e: MediaQueryListEvent) => setMatches(e.matches)
    mql.addEventListener("change", handler)
    return () => mql.removeEventListener("change", handler)
  }, [query])

  return matches
}
