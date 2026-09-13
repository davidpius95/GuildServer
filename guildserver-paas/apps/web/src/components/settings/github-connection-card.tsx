"use client"

import { AlertTriangle, CheckCircle, ExternalLink, Unplug } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { GitHubIcon } from "@/components/ui/github-icon"
import { trpc } from "@/components/trpc-provider"
import { useOrganization } from "@/hooks/use-auth"
import { getFriendlyMessage } from "@/lib/errors"

const API_URL = process.env.NEXT_PUBLIC_API_BASE_URL || ""

/**
 * The GitHub row of Connected Accounts.
 *
 * It carries three separate ideas that are easy to confuse:
 *  - the *connection*: this user's OAuth login, which can expire or be revoked;
 *  - the *scope*: whether that login may read repositories at all;
 *  - the *App installation*: a credential owned by the organization, which keeps
 *    deploys working after the person who connected the repository loses access.
 */
export function GithubConnectionCard({ onChanged }: { onChanged?: () => void }) {
  const { orgId } = useOrganization()

  const statusQuery = trpc.github.getConnectionStatus.useQuery({ organizationId: orgId || undefined })
  const status = statusQuery.data

  const installIntent = trpc.github.createInstallIntent.useMutation({
    onSuccess: (data) => {
      window.location.href = data.url
    },
    onError: (err) => toast.error(getFriendlyMessage(err)),
  })

  const disconnect = trpc.github.disconnect.useMutation({
    onSuccess: () => {
      toast.success("Account disconnected")
      statusQuery.refetch()
      onChanged?.()
    },
    onError: (err) => toast.error(getFriendlyMessage(err)),
  })

  // Connecting must attach GitHub to THIS account. A plain OAuth redirect matched
  // by email, which the GitHub App cannot read, so it created a second empty
  // account. The API issues a short-lived link token, POSTed as a form so it
  // stays out of logs and browser history.
  const linkIntent = trpc.github.createLinkIntent.useMutation({
    onError: (err) => toast.error(getFriendlyMessage(err)),
  })

  const startGithubLink = async () => {
    const { token } = await linkIntent.mutateAsync()
    const form = document.createElement("form")
    form.method = "POST"
    form.action = `${API_URL}/auth/github/link`
    for (const [name, value] of Object.entries({ token, returnTo: "/dashboard/settings" })) {
      const input = document.createElement("input")
      input.type = "hidden"
      input.name = name
      input.value = value
      form.appendChild(input)
    }
    document.body.appendChild(form)
    form.submit()
  }

  const installedOn = status?.installations?.map((i) => i.accountLogin) ?? []

  return (
    <div className="flex items-center justify-between p-4 border rounded-lg">
      <div className="flex items-center gap-4">
        <div className="h-10 w-10 rounded-full bg-gray-900 dark:bg-white flex items-center justify-center">
          <GitHubIcon className="h-5 w-5 text-white dark:text-gray-900" />
        </div>
        <div>
          <div className="font-medium flex items-center gap-2">
            GitHub
            {status?.connected && !status.needsReconnect && (
              <Badge variant="outline" className="bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-400 text-xs">
                <CheckCircle className="w-3 h-3 mr-1" />
                Connected
              </Badge>
            )}
            {status?.needsReconnect && (
              <Badge variant="outline" className="bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400 text-xs">
                <AlertTriangle className="w-3 h-3 mr-1" />
                Reconnect required
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {status?.needsReconnect
              ? "GitHub no longer accepts this connection. Reconnect to keep browsing and deploying your repositories."
              : status?.connected
              ? status.hasRepoScope
                ? "Full access — can browse and deploy from your repositories"
                : "Login only — grant repo access to browse repositories"
              : "Connect to sign in with GitHub and browse your repositories"}
          </p>
          {status?.connected && status.scope && (
            <p className="text-xs text-muted-foreground mt-1">Scopes: {status.scope}</p>
          )}
          {status?.appConfigured && (
            <p className="text-xs text-muted-foreground mt-1">
              {installedOn.length > 0
                ? `App installed on ${installedOn.join(", ")} — deploys keep working if you lose access`
                : "Install the GitHub App to keep deploys working when a teammate leaves or revokes access"}
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        {status?.connected ? (
          <>
            {status.needsReconnect ? (
              <Button size="sm" onClick={() => void startGithubLink()}>
                <GitHubIcon className="mr-2 h-3.5 w-3.5" />
                Reconnect
              </Button>
            ) : (
              !status.hasRepoScope && (
                <Button variant="outline" size="sm" onClick={() => void startGithubLink()}>
                  <ExternalLink className="mr-2 h-3.5 w-3.5" />
                  Grant Repo Access
                </Button>
              )
            )}
            {status.appConfigured && orgId && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => installIntent.mutate({ organizationId: orgId })}
                disabled={installIntent.isLoading}
              >
                <ExternalLink className="mr-2 h-3.5 w-3.5" />
                {installedOn.length > 0 ? "Manage App access" : "Install on GitHub"}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="text-red-600 hover:text-red-700 hover:bg-red-50"
              onClick={() => disconnect.mutate({ provider: "github" })}
              disabled={disconnect.isLoading}
            >
              <Unplug className="mr-2 h-3.5 w-3.5" />
              Disconnect
            </Button>
          </>
        ) : (
          <Button onClick={() => void startGithubLink()}>
            <GitHubIcon className="mr-2 h-4 w-4" />
            Connect GitHub
          </Button>
        )}
      </div>
    </div>
  )
}
