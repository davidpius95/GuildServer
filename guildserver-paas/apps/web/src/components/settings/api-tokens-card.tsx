"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Copy, KeyRound, Loader2, Plus } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { trpc } from "@/components/trpc-provider"
import { useOrganization } from "@/hooks/use-auth"
import { getFriendlyMessage } from "@/lib/errors"
import { NATIVE_SELECT_CLASS, formatWhen, useCanManage } from "./shared"

const SCOPES = [
  { value: "read", label: "Read", description: "View projects, applications and deployments" },
  { value: "deploy", label: "Deploy", description: "Trigger and roll back deployments" },
  { value: "write", label: "Write", description: "Create and change resources" },
  { value: "admin", label: "Admin", description: "Everything in the organization" },
] as const

/** Scopes a plain member may grant; the API refuses the others for them. */
const MEMBER_SCOPES = new Set(["read", "deploy"])

const EXPIRY_OPTIONS = [
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "1 year" },
  { value: "never", label: "Never" },
]

type TokenRow = {
  id: string
  name: string
  tokenPrefix: string
  scopes: string[]
  expiresAt: string | Date | null
  lastUsedAt: string | Date | null
  revokedAt: string | Date | null
  createdAt: string | Date | null
}

function tokenStatus(token: TokenRow): { label: string; className: string } {
  if (token.revokedAt) return { label: "Revoked", className: "text-muted-foreground" }
  if (token.expiresAt && new Date(token.expiresAt).getTime() <= Date.now()) {
    return { label: "Expired", className: "text-muted-foreground" }
  }
  return { label: "Active", className: "border-green-500/40 text-green-600 dark:text-green-400" }
}

export function ApiTokensCard() {
  const { orgId } = useOrganization()
  const canManage = useCanManage()
  const tokensQuery = trpc.apiToken.list.useQuery({ organizationId: orgId }, { enabled: !!orgId })

  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [scopes, setScopes] = useState<string[]>(["read"])
  const [expiry, setExpiry] = useState("90")
  const [createdToken, setCreatedToken] = useState<string | null>(null)
  const [revoking, setRevoking] = useState<TokenRow | null>(null)

  const createMutation = trpc.apiToken.create.useMutation({
    onSuccess: (data: { token: string }) => {
      setCreatedToken(data.token)
      tokensQuery.refetch()
    },
    onError: (err: unknown) => toast.error(getFriendlyMessage(err)),
  })

  const revokeMutation = trpc.apiToken.revoke.useMutation({
    onSuccess: () => {
      toast.success("Token revoked")
      setRevoking(null)
      tokensQuery.refetch()
    },
    onError: (err: unknown) => toast.error(getFriendlyMessage(err)),
  })

  const closeDialog = (next: boolean) => {
    setOpen(next)
    if (!next) {
      setName("")
      setScopes(["read"])
      setExpiry("90")
      setCreatedToken(null)
    }
  }

  const toggleScope = (scope: string) => {
    setScopes((current) => (current.includes(scope) ? current.filter((s) => s !== scope) : [...current, scope]))
  }

  const handleCreate = () => {
    const expiresAt = expiry === "never" ? null : new Date(Date.now() + Number(expiry) * 86_400_000).toISOString()
    createMutation.mutate({ organizationId: orgId, name: name.trim(), scopes: scopes as any, expiresAt })
  }

  const copyToken = async () => {
    if (!createdToken) return
    try {
      await navigator.clipboard.writeText(createdToken)
      toast.success("Token copied")
    } catch {
      toast.error("Copy failed; select the token and copy it manually")
    }
  }

  const tokens = (tokensQuery.data ?? []) as TokenRow[]

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div className="space-y-1.5">
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5" />
            API Tokens
          </CardTitle>
          <CardDescription>
            Personal access tokens for the REST API at <code>/api/v1</code>. Send one as{" "}
            <code>Authorization: Bearer gs_pat_…</code>.
          </CardDescription>
        </div>
        <Button onClick={() => setOpen(true)} disabled={!orgId}>
          <Plus className="mr-2 h-4 w-4" />
          New token
        </Button>
      </CardHeader>
      <CardContent>
        {tokensQuery.isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : tokens.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No API tokens yet.</p>
        ) : (
          <div className="divide-y rounded-md border">
            {tokens.map((token) => {
              const status = tokenStatus(token)
              return (
                <div key={token.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{token.name}</span>
                      <code className="text-xs text-muted-foreground">{token.tokenPrefix}…</code>
                      <Badge variant="outline" className={status.className}>{status.label}</Badge>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {token.scopes.map((scope) => (
                        <Badge key={scope} variant="secondary">{scope}</Badge>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Created {formatWhen(token.createdAt)} · Last used {formatWhen(token.lastUsedAt)} · Expires{" "}
                      {token.expiresAt ? formatWhen(token.expiresAt) : "never"}
                    </p>
                  </div>
                  {!token.revokedAt && (
                    <Button variant="outline" size="sm" onClick={() => setRevoking(token)}>
                      Revoke
                    </Button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={closeDialog}>
        <DialogContent>
          {createdToken ? (
            <>
              <DialogHeader>
                <DialogTitle>Token created</DialogTitle>
                <DialogDescription>Copy it now. It won&apos;t be shown again.</DialogDescription>
              </DialogHeader>
              <div className="flex gap-2">
                <Input readOnly value={createdToken} aria-label="New API token" className="font-mono text-xs" />
                <Button variant="outline" onClick={copyToken}>
                  <Copy className="mr-2 h-4 w-4" />
                  Copy
                </Button>
              </div>
              <div className="flex justify-end">
                <Button onClick={() => closeDialog(false)}>Done</Button>
              </div>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>New API token</DialogTitle>
                <DialogDescription>Grant only the scopes the integration needs.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="token-name">Name</Label>
                  <Input id="token-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="CI deploys" />
                </div>
                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium">Scopes</legend>
                  {SCOPES.map((scope) => {
                    const allowed = canManage || MEMBER_SCOPES.has(scope.value)
                    return (
                      <label key={scope.value} className="flex items-start gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={scopes.includes(scope.value)}
                          onChange={() => toggleScope(scope.value)}
                          disabled={!allowed}
                        />
                        <span>
                          <span className="font-medium">{scope.label}</span>
                          <span className="block text-xs text-muted-foreground">
                            {scope.description}
                            {!allowed && " (owners and admins only)"}
                          </span>
                        </span>
                      </label>
                    )
                  })}
                </fieldset>
                <div className="space-y-2">
                  <Label htmlFor="token-expiry">Expires</Label>
                  <select id="token-expiry" className={NATIVE_SELECT_CLASS} value={expiry} onChange={(e) => setExpiry(e.target.value)}>
                    {EXPIRY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => closeDialog(false)}>Cancel</Button>
                  <Button onClick={handleCreate} disabled={!name.trim() || scopes.length === 0 || createMutation.isPending}>
                    {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Create token
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!revoking}
        onOpenChange={(next) => !next && setRevoking(null)}
        title="Revoke token?"
        description={`Anything using "${revoking?.name ?? ""}" will stop working immediately.`}
        confirmLabel="Revoke"
        variant="danger"
        loading={revokeMutation.isPending}
        onConfirm={() => revoking && revokeMutation.mutate({ id: revoking.id })}
      />
    </Card>
  )
}
