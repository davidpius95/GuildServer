"use client"

import { type ReactNode } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { X } from "lucide-react"
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { useMediaQuery } from "@/hooks/use-media-query"

interface ResponsiveModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
}

/**
 * Renders a centered modal card on desktop, a bottom drawer on mobile.
 */
export function ResponsiveModal({ open, onClose, title, children }: ResponsiveModalProps) {
  const isMobile = useMediaQuery("(max-width: 640px)")

  if (!open) return null

  // Mobile: Bottom sheet drawer
  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={(o) => !o && onClose()}>
        <DrawerContent className="max-h-[90vh]">
          <DrawerHeader>
            <DrawerTitle>{title}</DrawerTitle>
          </DrawerHeader>
          <div className="px-4 pb-6 overflow-y-auto">
            {children}
          </div>
        </DrawerContent>
      </Drawer>
    )
  }

  // Desktop: Centered modal
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <Card className="w-full max-w-lg mx-4">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>{title}</CardTitle>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {children}
        </CardContent>
      </Card>
    </div>
  )
}
