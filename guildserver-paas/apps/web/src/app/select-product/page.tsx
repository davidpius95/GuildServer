"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Rocket, ArrowRight } from "lucide-react"
import { motion } from "framer-motion"

export default function SelectProductPage() {
  const router = useRouter()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    const savedProduct = localStorage.getItem("guildserver-preferred-product")
    if (savedProduct === "paas") {
      router.replace("/dashboard")
    }
  }, [router])

  if (!mounted) return null

  return (
    <div className="min-h-screen bg-[#fbfaf6] text-[#171713] dark:bg-[#080c0a] dark:text-[#f8f6ee] flex flex-col items-center justify-center p-4">
      <div className="max-w-4xl w-full space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-4xl font-black tracking-[-0.04em]">Welcome to GuildServer</h1>
          <p className="text-xl text-[#171713]/58 dark:text-white/58">Open your deployment workspace.</p>
        </div>

        <div className="grid md:grid-cols-1 gap-6 pt-8 max-w-xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            <Card 
              className="relative overflow-hidden cursor-pointer rounded-[1.5rem] border-[#171713]/10 bg-white/75 transition-colors hover:border-[#171713]/30 group h-full flex flex-col dark:border-white/10 dark:bg-white/[0.06] dark:hover:border-white/25"
              onClick={() => {
                localStorage.setItem("guildserver-preferred-product", "paas")
                router.push("/dashboard")
              }}
            >
              <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              <CardHeader>
                <div className="h-12 w-12 rounded-2xl bg-[#171713] text-white dark:bg-white dark:text-[#080c0a] flex items-center justify-center mb-4">
                  <Rocket className="h-6 w-6" />
                </div>
                <CardTitle className="text-2xl font-black tracking-[-0.03em]">Deployment workspace</CardTitle>
                <CardDescription className="text-base">
                  Deploy and manage applications, databases, and VPS instances.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex-1 flex flex-col justify-end">
                <ul className="space-y-2 mb-6 text-sm text-muted-foreground">
                  <li className="flex items-center gap-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-[#276f54]" />
                    Docker container deployments
                  </li>
                  <li className="flex items-center gap-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-[#276f54]" />
                    Managed PostgreSQL & Redis
                  </li>
                  <li className="flex items-center gap-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-[#276f54]" />
                    VPS Instance management
                  </li>
                </ul>
                <Button className="w-full rounded-full bg-[#171713] text-white hover:bg-[#171713]/90 dark:bg-white dark:text-[#080c0a] dark:hover:bg-white/90">
                  Open workspace <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </div>
    </div>
  )
}
