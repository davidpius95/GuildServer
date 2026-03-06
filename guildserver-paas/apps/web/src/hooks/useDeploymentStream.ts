"use client"

import { useState, useEffect, useCallback, useRef } from "react"

interface DeploymentLog {
  timestamp: string
  message: string
  phase?: string
}

export interface DeploymentPhase {
  name: string
  status: "pending" | "running" | "completed" | "failed"
  message: string
  startedAt?: string
  completedAt?: string
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
  phases: DeploymentPhase[]
  clearLogs: () => void
}

// Process a single WS message into state updates
function processMessage(
  message: any,
  targetId: string,
  setLogs: React.Dispatch<React.SetStateAction<DeploymentLog[]>>,
  setPhases: React.Dispatch<React.SetStateAction<DeploymentPhase[]>>,
  setStatus: React.Dispatch<React.SetStateAction<string | null>>,
  setAccessUrl: React.Dispatch<React.SetStateAction<string | null>>,
  setDirectUrl: React.Dispatch<React.SetStateAction<string | null>>
) {
  if (message.deploymentId !== targetId) return

  if (message.type === "deployment_log") {
    setLogs((prev) => [
      ...prev,
      {
        timestamp: new Date().toISOString(),
        message: message.log || message.message || "",
        phase: message.phase,
      },
    ])
  }

  if (message.type === "deployment_phase") {
    setPhases((prev) => {
      const existing = prev.find((p) => p.name === message.phase)
      if (existing) {
        return prev.map((p) =>
          p.name === message.phase
            ? {
                ...p,
                status: message.status,
                message: message.message || p.message,
                ...(message.status === "running" ? { startedAt: message.timestamp } : {}),
                ...(message.status === "completed" || message.status === "failed"
                  ? { completedAt: message.timestamp }
                  : {}),
              }
            : p
        )
      }
      return [
        ...prev,
        {
          name: message.phase,
          status: message.status,
          message: message.message || "",
          startedAt: message.status === "running" ? message.timestamp : undefined,
          completedAt: message.status === "completed" ? message.timestamp : undefined,
        },
      ]
    })
  }

  if (message.type === "deployment_status") {
    setStatus(message.status)

    if (message.status === "failed") {
      setPhases((prev) =>
        prev.map((p) =>
          p.status === "running"
            ? { ...p, status: "failed", completedAt: new Date().toISOString() }
            : p
        )
      )
    }

    if (message.accessUrl) setAccessUrl(message.accessUrl)
    if (message.directUrl) setDirectUrl(message.directUrl)
    if (message.url) setAccessUrl(message.url)

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
  const [phases, setPhases] = useState<DeploymentPhase[]>([])
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Buffer: stores recent deployment events so they can be replayed
  // when the deploymentId becomes known (handles the race condition where
  // BullMQ starts processing before the mutation response arrives).
  const eventBufferRef = useRef<Map<string, any[]>>(new Map())
  const deploymentIdRef = useRef<string | null>(deploymentId)

  const clearLogs = useCallback(() => {
    setLogs([])
    setStatus(null)
    setAccessUrl(null)
    setDirectUrl(null)
    setError(null)
    setPhases([])
  }, [])

  // When deploymentId changes, replay any buffered events for it
  useEffect(() => {
    if (deploymentId && deploymentId !== deploymentIdRef.current) {
      deploymentIdRef.current = deploymentId

      // Replay buffered events for this deployment
      const buffered = eventBufferRef.current.get(deploymentId) || []
      if (buffered.length > 0) {
        for (const msg of buffered) {
          processMessage(msg, deploymentId, setLogs, setPhases, setStatus, setAccessUrl, setDirectUrl)
        }
        // Clear buffer for this deployment after replay
        eventBufferRef.current.delete(deploymentId)
      }
    }
    deploymentIdRef.current = deploymentId
  }, [deploymentId])

  // Persistent WebSocket connection
  useEffect(() => {
    if (!enabled) return

    const token = localStorage.getItem("guildserver-token")
    if (!token) {
      setError("No auth token found")
      return
    }

    // Use NEXT_PUBLIC_API_BASE_URL for the actual server host (NEXT_PUBLIC_API_URL may be just "/trpc")
    const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || process.env.NEXT_PUBLIC_API_URL || ""
    // If the URL is just a path (e.g. "/trpc"), derive host from window.location
    const isRelative = apiBaseUrl.startsWith("/")
    const fullBaseUrl = isRelative
      ? `${window.location.protocol}//${window.location.hostname}:4000`
      : apiBaseUrl
    const wsProtocol = fullBaseUrl.startsWith("https") ? "wss" : "ws"
    const wsHost = fullBaseUrl.replace(/^https?:\/\//, "").replace(/\/trpc$/, "").replace(/\/$/, "")

    let ws: WebSocket

    const connect = () => {
      try {
        const fullWsUrl = `${wsProtocol}://${wsHost}/ws?token=${token}`
        ws = new WebSocket(fullWsUrl)
        wsRef.current = ws

        ws.onopen = () => {
          setIsConnected(true)
          setError(null)
        }

        ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data)
            const currentId = deploymentIdRef.current

            // Only process deployment-related events
            if (!message.deploymentId) return

            if (currentId && message.deploymentId === currentId) {
              // We know which deployment to track — process immediately
              processMessage(message, currentId, setLogs, setPhases, setStatus, setAccessUrl, setDirectUrl)
            } else {
              // Buffer events for unknown/future deployments
              const id = message.deploymentId
              if (!eventBufferRef.current.has(id)) {
                eventBufferRef.current.set(id, [])
              }
              const buf = eventBufferRef.current.get(id)!
              buf.push(message)
              if (buf.length > 200) buf.shift()

              if (eventBufferRef.current.size > 10) {
                const ids = Array.from(eventBufferRef.current.keys())
                for (const oldId of ids.slice(0, ids.length - 5)) {
                  eventBufferRef.current.delete(oldId)
                }
              }
            }
          } catch {
            // Ignore parse errors
          }
        }

        ws.onclose = () => {
          setIsConnected(false)
          wsRef.current = null
          reconnectTimerRef.current = setTimeout(connect, 3000)
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
        reconnectTimerRef.current = null
      }
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
    }
  }, [enabled])

  return { logs, status, isConnected, accessUrl, directUrl, error, phases, clearLogs }
}
