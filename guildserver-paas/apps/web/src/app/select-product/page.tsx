"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Rocket, Database, Layers, ArrowRight } from "lucide-react"
import { motion } from "framer-motion"

export default function SelectProductPage() {
  const router = useRouter()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    const savedProduct = localStorage.getItem("guildserver-preferred-product")
    if (savedProduct === "paas") {
      router.replace("/dashboard")
    } else if (savedProduct === "baas") {
      router.replace("/baas/dashboard")
    }
  }, [router])

  const selectProduct = (product: "paas" | "baas") => {
    localStorage.setItem("guildserver-preferred-product", product)
    if (product === "paas") {
      router.push("/dashboard")
    } else {
      window.location.href = "/baas/dashboard"
    }
  }

  if (!mounted) return null

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <div className="max-w-4xl w-full space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-4xl font-bold tracking-tight">Welcome to GuildServer</h1>
          <p className="text-xl text-muted-foreground">Select a product to continue</p>
        </div>

        <div className="grid md:grid-cols-2 gap-6 pt-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            <Card 
              className="relative overflow-hidden cursor-pointer hover:border-primary/50 transition-colors group h-full flex flex-col"
              onClick={() => selectProduct("paas")}
            >
              <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              <CardHeader>
                <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                  <Rocket className="h-6 w-6 text-primary" />
                </div>
                <CardTitle className="text-2xl">PaaS Platform</CardTitle>
                <CardDescription className="text-base">
                  Deploy and manage applications, databases, and VPS instances.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex-1 flex flex-col justify-end">
                <ul className="space-y-2 mb-6 text-sm text-muted-foreground">
                  <li className="flex items-center gap-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                    Docker container deployments
                  </li>
                  <li className="flex items-center gap-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                    Managed PostgreSQL & Redis
                  </li>
                  <li className="flex items-center gap-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                    VPS Instance management
                  </li>
                </ul>
                <Button className="w-full group-hover:bg-primary group-hover:text-primary-foreground transition-colors" variant="outline">
                  Open PaaS <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <Card 
              className="relative overflow-hidden cursor-pointer hover:border-primary/50 transition-colors group h-full flex flex-col"
              onClick={() => selectProduct("baas")}
            >
              <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              <CardHeader>
                <div className="h-12 w-12 rounded-lg bg-indigo-500/10 flex items-center justify-center mb-4">
                  <Database className="h-6 w-6 text-indigo-500" />
                </div>
                <CardTitle className="text-2xl">BaaS (Supabase Alt)</CardTitle>
                <CardDescription className="text-base">
                  Instant backend with Postgres, Auth, and Storage.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex-1 flex flex-col justify-end">
                <ul className="space-y-2 mb-6 text-sm text-muted-foreground">
                  <li className="flex items-center gap-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
                    Auto-scaling PostgreSQL
                  </li>
                  <li className="flex items-center gap-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
                    Built-in Authentication
                  </li>
                  <li className="flex items-center gap-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
                    S3-compatible Storage
                  </li>
                </ul>
                <Button className="w-full hover:bg-indigo-500 hover:text-white transition-colors" variant="outline">
                  Open BaaS <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </div>
    </div>
  )
}
