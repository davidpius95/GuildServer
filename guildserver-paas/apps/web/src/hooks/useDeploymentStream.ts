"use client"

import { useState, useEffect, useCallback, useRef } from "react"

interface DeploymentLog {
  timestamp: string
  message: string
  phase?: string
}

interface UseDeploymentStreamOptions {
  deploymentId: string | null
  enabled?: boolean
}

interface UseDeploymentStreamResult {
  logs: DeploymentLog[]
  status: string | null
  isConnected: boolean
  accessUrl: string | null
  directUrl: string | null
  error: string | null
  clearLogs: () => void
}

export function useDeploymentStream({
  deploymentId,
  enabled = true,
}: UseDeploymentStreamOptions): UseDeploymentStreamResult {
  const [logs, setLogs] = useState<DeploymentLog[]>([])
  const [status, setStatus] = useState<string | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [accessUrl, setAccessUrl] = useState<string | null>(null)
  const [directUrl, setDirectUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearLogs = useCallback(() => {
    setLogs([])
    setStatus(null)
    setAccessUrl(null)
    setDirectUrl(null)
    setError(null)
  }, [])

  useEffect(() => {
    if (!deploymentId || !enabled) {
      return
    }

    const token = localStorage.getItem("guildserver-token")
    if (!token) {
      setError("No auth token found")
      return
    }

    // Determine WebSocket URL
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000"
    const wsProtocol = apiUrl.startsWith("https") ? "wss" : "ws"
    const wsHost = apiUrl.replace(/^https?:\/\//, "").replace(/\/trpc$/, "")
    const wsUrl = `${wsProtocol}://${wsHost}/ws?token=${token}`

    let ws: WebSocket

    const connect = () => {
      try {
        ws = new WebSocket(wsUrl)
        wsRef.current = ws

        ws.onopen = () => {
          setIsConnected(true)
          setError(null)

          // Subscribe to deployment events
          ws.send(JSON.stringify({
            type: "subscribe",
            payload: {
              channel: "deployment",
              resourceId: deploymentId,
            },
          }))
        }

        ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data)

            // Handle deployment log lines
            if (message.type === "deployment_log" && message.deploymentId === deploymentId) {
              const logEntry: DeploymentLog = {
                timestamp: new Date().toISOString(),
                message: message.log || message.message || "",
                phase: message.phase,
              }
              setLogs((prev) => [...prev, logEntry])
            }

            // Handle deployment status updates
            if (message.type === "deployment_status" && message.deploymentId === deploymentId) {
              setStatus(message.status)

              // Capture URLs when deployment completes
              if (message.accessUrl) setAccessUrl(message.accessUrl)
              if (message.directUrl) setDirectUrl(message.directUrl)
              if (message.url) setAccessUrl(message.url)

              // Add status change as a log entry
              const statusMessages: Record<string, string> = {
                building: "🔨 Build started...",
                deploying: "🚀 Deploying container...",
                completed: `✅ Deployment completed successfully${message.url ? ` — ${message.url}` : ""}`,
                failed: `❌ Deployment failed${message.error ? `: ${message.error}` : ""}`,
              }

              if (statusMessages[message.status]) {
                setLogs((prev) => [
                  ...prev,
                  {
                    timestamp: new Date().toISOString(),
                    message: statusMessages[message.status],
                    phase: "status",
                  },
                ])
              }
            }
          } catch {
            // Ignore parse errors
          }
        }

        ws.onclose = () => {
          setIsConnected(false)
          wsRef.current = null

          // Auto-reconnect if deployment is still in progress
          if (status !== "completed" && status !== "failed") {
            reconnectTimerRef.current = setTimeout(connect, 3000)
          }
        }

        ws.onerror = () => {
          setError("WebSocket connection error")
          setIsConnected(false)
        }
      } catch (err: any) {
        setError(err.message || "Failed to connect")
      }
    }

    connect()

    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
      }
      if (wsRef.current) {
        // Unsubscribe before closing
        try {
          wsRef.current.send(JSON.stringify({
            type: "unsubscribe",
            payload: {
              channel: "deployment",
              resourceId: deploymentId,
            },
          }))
        } catch { /* ignore */ }
        wsRef.current.close()
        wsRef.current = null
      }
    }
  }, [deploymentId, enabled]) // eslint-disable-line react-hooks/exhaustive-deps

  return { logs, status, isConnected, accessUrl, directUrl, error, clearLogs }
}
