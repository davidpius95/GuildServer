import Link from "next/link"
import { Button } from "@/components/ui/button"
import { LayoutDashboard, Search } from "lucide-react"

export default function DashboardNotFound() {
  return (
    <div className="flex items-center justify-center py-20 px-4">
      <div className="text-center max-w-md">
        <div className="rounded-full bg-muted p-4 w-fit mx-auto mb-6">
          <Search className="h-8 w-8 text-muted-foreground" />
        </div>
        <h1 className="text-5xl font-bold mb-2 text-primary">404</h1>
        <h2 className="text-lg font-semibold mb-2">Page not found</h2>
        <p className="text-muted-foreground mb-8">
          This dashboard page doesn&apos;t exist. It may have been removed or
          the URL is incorrect.
        </p>
        <Link href="/dashboard">
          <Button size="lg">
            <LayoutDashboard className="mr-2 h-4 w-4" />
            Back to Dashboard
          </Button>
        </Link>
      </div>
    </div>
  )
}
