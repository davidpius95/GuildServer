"use client"

import Link from "next/link"

/**
 * Stretched-link overlay. Renders an absolutely-positioned link that fills its
 * nearest `position: relative` ancestor (e.g. a <Card className="relative">),
 * making the ENTIRE card a single click + keyboard target.
 *
 * Any interactive controls inside the card (buttons, other links) must sit
 * above this overlay with `relative z-10` so they remain independently
 * clickable and don't trigger the card's navigation.
 *
 * This keeps the markup valid (no nested <a> tags) and the whole surface
 * accessible, while giving a visible focus ring on keyboard navigation.
 */
export function CardLinkOverlay({
  href,
  label,
  onFocus,
  onMouseEnter,
}: {
  href: string
  /** Accessible label announced to screen readers, e.g. "Open my-app". */
  label: string
  onFocus?: () => void
  onMouseEnter?: () => void
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      onFocus={onFocus}
      onMouseEnter={onMouseEnter}
      className="absolute inset-0 z-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    />
  )
}
