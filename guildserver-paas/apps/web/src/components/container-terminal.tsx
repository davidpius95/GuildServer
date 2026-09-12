"use client"

import { useEffect, useRef, useState } from "react"
import { trpc } from "@/components/trpc-provider"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Terminal as TerminalIcon } from "lucide-react"
import "@xterm/xterm/css/xterm.css"

type Target = { kind: "application" | "stack" | "database"; id: string; service?: string }
export function ContainerTerminal({ target, name }: { target: Target; name: string }) {
  const [open, setOpen] = useState(false)
  return <>
    <Button variant="outline" size="sm" onClick={() => setOpen(true)}><TerminalIcon className="mr-2 h-4 w-4" />Terminal</Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-4xl">
        <DialogTitle>Terminal · {name}</DialogTitle>
        <DialogDescription>Commands run inside this container as its configured user. Owner or administrator access is required. Changes outside persistent volumes disappear on redeploy.</DialogDescription>
        {open && <TerminalSession target={target} />}
      </DialogContent>
    </Dialog>
  </>
}

function TerminalSession({ target }: { target: Target }) {
  const host = useRef<HTMLDivElement>(null)
  const cleanup = useRef<() => void>(() => {})
  const generation = useRef(0)
  const [status, setStatus] = useState("Disconnected")
  const [connected, setConnected] = useState(false)
  const [shell, setShell] = useState<"/bin/sh" | "/bin/bash">("/bin/sh")
  const ticket = trpc.terminal.ticket.useMutation()
  useEffect(() => () => { generation.current++; cleanup.current() }, [])
  const connect = async () => {
    const run = ++generation.current
    cleanup.current()
    setStatus("Connecting…")
    try {
      const [{ Terminal }, { FitAddon }, authorization] = await Promise.all([
        import("@xterm/xterm"), import("@xterm/addon-fit"), ticket.mutateAsync({ ...target, shell }),
      ])
      if (run !== generation.current || !host.current) return
      const term = new Terminal({ cursorBlink: true, fontSize: 13, scrollback: 1500, theme: { background: "#101014", foreground: "#e4e4e7" } })
      const fit = new FitAddon()
      term.loadAddon(fit); term.open(host.current); fit.fit()
      const base = new URL(process.env.NEXT_PUBLIC_API_BASE_URL || location.origin)
      const socket = new WebSocket(`${base.protocol === "https:" ? "wss:" : "ws:"}//${base.host}/ws?ticket=${authorization.ticket}`)
      const send = (value: object) => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value)) }
      const resize = () => { fit.fit(); send({ type: "resize", cols: term.cols, rows: term.rows }) }
      const observer = new ResizeObserver(resize); observer.observe(host.current)
      const input = term.onData(data => send({ type: "input", data }))
      cleanup.current = () => { observer.disconnect(); input.dispose(); socket.close(); term.dispose() }
      socket.onmessage = event => {
        const message = JSON.parse(event.data)
        if (message.type === "ready") { setConnected(true); setStatus("Connected"); resize(); term.focus() }
        if (message.type === "output") term.write(Uint8Array.from(atob(message.data), char => char.charCodeAt(0)))
        if (message.type === "error") { setStatus(message.message); term.writeln(`\r\n${message.message}`) }
      }
      socket.onclose = event => { if (run === generation.current) { setConnected(false); setStatus(current => current === "Connected" || current === "Connecting…" ? event.reason || "Disconnected. Reconnect to continue." : current) } }
      socket.onerror = () => { if (run === generation.current) setStatus("Connection failed. Check your connection and reconnect.") }
    } catch (error) { if (run === generation.current) setStatus(error instanceof Error ? error.message : "Unable to connect") }
  }
  return <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-3">
      <label className="text-sm">Shell <select aria-label="Terminal shell" value={shell} disabled={connected} onChange={e => setShell(e.target.value as typeof shell)} className="ml-2 rounded-md border bg-background px-2 py-1"><option>/bin/sh</option><option>/bin/bash</option></select></label>
      <Button size="sm" disabled={ticket.isLoading || status === "Connecting…"} onClick={connected ? () => { generation.current++; cleanup.current(); setConnected(false); setStatus("Disconnected") } : connect}>{connected ? "Disconnect" : "Connect"}</Button>
      <span role="status" className="text-xs text-muted-foreground">{status}</span>
    </div>
    <div ref={host} aria-label="Container terminal" className="h-[min(55vh,450px)] min-h-[220px] overflow-hidden rounded-lg bg-[#101014] p-2" />
  </div>
}
