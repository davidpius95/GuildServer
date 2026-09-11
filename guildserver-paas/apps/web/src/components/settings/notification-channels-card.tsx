"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Loader2, Plus, Send, Trash2, Webhook } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { trpc } from "@/components/trpc-provider"
import { useOrganization } from "@/hooks/use-auth"
import { getFriendlyMessage } from "@/lib/errors"
import { DeliveryStatus, NATIVE_SELECT_CLASS, humanizeEvent, useCanManage } from "./shared"

const CHANNEL_TYPES = [
  { value: "slack", label: "Slack" },
  { value: "discord", label: "Discord" },
  { value: "webhook", label: "Webhook" },
  { value: "telegram", label: "Telegram" },
  { value: "email", label: "Email" },
] as const
type ChannelType = (typeof CHANNEL_TYPES)[number]["value"]

type ChannelRow = {
  id: string
  name: string
  type: string
  events: string[]
  enabled: boolean
  target: string
  lastDeliveryAt: string | Date | null
  lastDeliveryOk: boolean | null
  lastError: string | null
}

const DEFAULT_EVENTS = ["deployment_failed", "backup_failed"]

export function NotificationChannelsCard() {
  const { orgId } = useOrganization()
  const canManage = useCanManage()
  const channelsQuery = trpc.notificationChannel.list.useQuery({ organizationId: orgId }, { enabled: !!orgId })
  const eventsQuery = trpc.notificationChannel.events.useQuery()

  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [type, setType] = useState<ChannelType>("slack")
  const [url, setUrl] = useState("")
  const [signingSecret, setSigningSecret] = useState("")
  const [botToken, setBotToken] = useState("")
  const [chatId, setChatId] = useState("")
  const [recipients, setRecipients] = useState("")
  const [events, setEvents] = useState<string[]>(DEFAULT_EVENTS)
  const [deleting, setDeleting] = useState<ChannelRow | null>(null)

  const refetch = () => channelsQuery.refetch()
  const onError = (err: unknown) => toast.error(getFriendlyMessage(err))

  const createMutation = trpc.notificationChannel.create.useMutation({
    onSuccess: () => {
      toast.success("Channel added")
      setOpen(false)
      resetForm()
      refetch()
    },
    onError,
  })
  const updateMutation = trpc.notificationChannel.update.useMutation({ onSuccess: refetch, onError })
  const deleteMutation = trpc.notificationChannel.delete.useMutation({
    onSuccess: () => {
      toast.success("Channel deleted")
      setDeleting(null)
      refetch()
    },
    onError,
  })
  const testMutation = trpc.notificationChannel.test.useMutation({
    onSuccess: (result: { ok: boolean; error?: string }) => {
      if (result.ok) toast.success("Test notification sent")
      else toast.error(`Test failed: ${result.error}`)
      refetch()
    },
    onError,
  })

  function resetForm() {
    setName("")
    setType("slack")
    setUrl("")
    setSigningSecret("")
    setBotToken("")
    setChatId("")
    setRecipients("")
    setEvents(DEFAULT_EVENTS)
  }

  const buildTarget = () => {
    switch (type) {
      case "slack":
      case "discord":
        return { type, url: url.trim() }
      case "webhook":
        return { type, url: url.trim(), ...(signingSecret ? { signingSecret } : {}) }
      case "telegram":
        return { type, botToken: botToken.trim(), chatId: chatId.trim() }
      case "email":
        return { type, recipients: recipients.split(/[\s,]+/).map((r) => r.trim()).filter(Boolean) }
    }
  }

  const toggleEvent = (event: string) => {
    setEvents((current) => (current.includes(event) ? current.filter((e) => e !== event) : [...current, event]))
  }

  const channels = (channelsQuery.data ?? []) as ChannelRow[]
  const availableEvents = (eventsQuery.data ?? []) as string[]

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div className="space-y-1.5">
          <CardTitle className="flex items-center gap-2">
            <Webhook className="h-5 w-5" />
            Organization Channels
          </CardTitle>
          <CardDescription>
            Send events to Slack, Discord, Telegram, email or any webhook. Each event is delivered to each channel once.
          </CardDescription>
        </div>
        {canManage && (
          <Button onClick={() => setOpen(true)} disabled={!orgId}>
            <Plus className="mr-2 h-4 w-4" />
            Add channel
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {channelsQuery.isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : channels.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No channels yet.</p>
        ) : (
          <div className="divide-y rounded-md border">
            {channels.map((channel) => (
              <div key={channel.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{channel.name}</span>
                    <Badge variant="secondary">{CHANNEL_TYPES.find((t) => t.value === channel.type)?.label ?? channel.type}</Badge>
                    <DeliveryStatus ok={channel.lastDeliveryOk} error={channel.lastError} at={channel.lastDeliveryAt} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {channel.target} · {channel.events.map(humanizeEvent).join(", ")}
                  </p>
                  {channel.lastDeliveryOk === false && channel.lastError && (
                    <p className="text-xs text-red-600 dark:text-red-400">{channel.lastError}</p>
                  )}
                </div>
                {canManage && (
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={channel.enabled}
                      aria-label={`${channel.enabled ? "Disable" : "Enable"} ${channel.name}`}
                      onCheckedChange={(checked: boolean) => updateMutation.mutate({ id: channel.id, enabled: checked })}
                    />
                    <Button variant="outline" size="sm" onClick={() => testMutation.mutate({ id: channel.id })} disabled={testMutation.isPending}>
                      <Send className="mr-1 h-3.5 w-3.5" />
                      Test
                    </Button>
                    <Button variant="ghost" size="sm" aria-label={`Delete ${channel.name}`} onClick={() => setDeleting(channel)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) resetForm() }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add notification channel</DialogTitle>
            <DialogDescription>Credentials are stored encrypted and never shown again.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="channel-name">Name</Label>
                <Input id="channel-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Deploy alerts" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="channel-type">Type</Label>
                <select id="channel-type" className={NATIVE_SELECT_CLASS} value={type} onChange={(e) => setType(e.target.value as ChannelType)}>
                  {CHANNEL_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
            </div>

            {(type === "slack" || type === "discord" || type === "webhook") && (
              <div className="space-y-2">
                <Label htmlFor="channel-url">{type === "webhook" ? "URL" : "Webhook URL"}</Label>
                <Input
                  id="channel-url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder={
                    type === "slack" ? "https://hooks.slack.com/services/…" : type === "discord" ? "https://discord.com/api/webhooks/…" : "https://example.com/hooks/guildserver"
                  }
                />
              </div>
            )}
            {type === "webhook" && (
              <div className="space-y-2">
                <Label htmlFor="channel-secret">Signing secret (optional)</Label>
                <Input id="channel-secret" type="password" value={signingSecret} onChange={(e) => setSigningSecret(e.target.value)} placeholder="At least 16 characters" />
                <p className="text-xs text-muted-foreground">Requests carry an X-GuildServer-Signature HMAC you can verify.</p>
              </div>
            )}
            {type === "telegram" && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="channel-bot-token">Bot token</Label>
                  <Input id="channel-bot-token" type="password" value={botToken} onChange={(e) => setBotToken(e.target.value)} placeholder="123456:ABC…" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="channel-chat-id">Chat ID</Label>
                  <Input id="channel-chat-id" value={chatId} onChange={(e) => setChatId(e.target.value)} placeholder="-1001234567890 or @channel" />
                </div>
              </div>
            )}
            {type === "email" && (
              <div className="space-y-2">
                <Label htmlFor="channel-recipients">Recipients</Label>
                <Textarea id="channel-recipients" value={recipients} onChange={(e) => setRecipients(e.target.value)} placeholder="ops@example.com, oncall@example.com" rows={2} />
              </div>
            )}

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Events</legend>
              <div className="grid gap-1 sm:grid-cols-2">
                {availableEvents.map((event) => (
                  <label key={event} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={events.includes(event)} onChange={() => toggleEvent(event)} />
                    {humanizeEvent(event)}
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button
                onClick={() => createMutation.mutate({ organizationId: orgId, name: name.trim(), events: events as any, target: buildTarget() as any })}
                disabled={!name.trim() || events.length === 0 || createMutation.isPending}
              >
                {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Add channel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(next) => !next && setDeleting(null)}
        title="Delete channel?"
        description={`"${deleting?.name ?? ""}" will stop receiving notifications.`}
        confirmLabel="Delete"
        variant="danger"
        loading={deleteMutation.isPending}
        onConfirm={() => deleting && deleteMutation.mutate({ id: deleting.id })}
      />
    </Card>
  )
}
