"use client"

import { Suspense, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Loader2, AlertCircle } from "lucide-react"

const ERROR_MESSAGES: Record<string, string> = {
  invalid_state: "Security check failed. Please try again.",
  no_code: "No authorization code received.",
  token_exchange_failed: "Failed to complete authentication.",
  no_email: "No email found on your account. Please ensure your email is public or verified.",
  oauth_failed: "Authentication failed. Please try again.",
}

export default function OAuthCallbackPage() {
  return (
    <Suspense fallback={
      <Card>
        <CardHeader>
          <CardTitle>Signing you in...</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </CardContent>
      </Card>
    }>
      <OAuthCallbackContent />
    </Suspense>
  )
}

function OAuthCallbackContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const token = searchParams.get("token")
    const errorParam = searchParams.get("error")

    if (errorParam) {
      setError(ERROR_MESSAGES[errorParam] || `Authentication error: ${errorParam}`)
      setTimeout(() => router.replace("/auth/login"), 3000)
      return
    }

    if (token) {
      localStorage.setItem("guildserver-token", token)
      router.replace("/dashboard")
    } else {
      setError("No authentication token received.")
      setTimeout(() => router.replace("/auth/login"), 3000)
    }
  }, [searchParams, router])

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-red-600">
            <AlertCircle className="h-5 w-5" />
            Authentication Error
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">{error}</p>
          <p className="text-sm text-muted-foreground mt-2">Redirecting to login...</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Signing you in...</CardTitle>
      </CardHeader>
      <CardContent className="flex items-center justify-center py-8">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </CardContent>
    </Card>
  )
}
