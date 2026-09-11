"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Layers, Loader2, Plus } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { EmptyState } from "@/components/empty-state"
import { StackStatusBadge } from "@/components/stacks/stack-status-badge"
import { NATIVE_SELECT_CLASS } from "@/components/settings/shared"
import { trpc } from "@/components/trpc-provider"
import { useOrganization, useProjects } from "@/hooks/use-auth"
import { getFriendlyMessage } from "@/lib/errors"
import { EXAMPLE_COMPOSE, stackErrorMessage } from "@/lib/stacks"
import { formatDateTime } from "@/lib/utils"

type StackRow = {
  id: string
  name: string
  description?: string | null
  status: string | null
  templateId?: string | null
  containerCount: number
  runningCount: number
  updatedAt: string | Date | null
  projectName?: string
}

export default function StacksPage() {
  const router = useRouter()
  const { orgId } = useOrganization()
  const { projects, isLoading: projectsLoading } = useProjects(orgId)
  const stackQueries = trpc.useQueries((t) => projects.map((project: { id: string }) => t.service.list({ projectId: project.id })))

  const stacks = useMemo<StackRow[]>(
    () =>
      stackQueries.flatMap((query, index) =>
        ((query.data ?? []) as StackRow[]).map((stack) => ({ ...stack, projectName: (projects[index] as { name?: string })?.name })),
      ),
    [stackQueries, projects],
  )
  const loading = projectsLoading || stackQueries.some((query) => query.isLoading)

  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [projectId, setProjectId] = useState("")
  const [composeFile, setComposeFile] = useState(EXAMPLE_COMPOSE)
  const [problem, setProblem] = useState<string | null>(null)

  const createMutation = trpc.service.create.useMutation({
    onSuccess: (stack: { id: string }) => {
      toast.success("Stack created. Deploy it when you're ready.")
      setOpen(false)
      router.push(`/dashboard/stacks/${stack.id}`)
    },
    onError: (err: unknown) => setProblem(stackErrorMessage(err, getFriendlyMessage)),
  })

  const openDialog = () => {
    setName("")
    setProjectId((projects[0] as { id?: string })?.id ?? "")
    setComposeFile(EXAMPLE_COMPOSE)
    setProblem(null)
    setOpen(true)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Stacks</h1>
          <p className="text-muted-foreground">Deploy multi-container apps from a Docker Compose file</p>
        </div>
        <Button onClick={openDialog} disabled={projects.length === 0}>
          <Plus className="mr-2 h-4 w-4" />
          New stack
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : stacks.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="No stacks yet"
          description="A stack runs several containers together (for example a web app, a worker, Postgres and Redis) from one Compose file."
          action={projects.length > 0 ? { label: "New stack", onClick: openDialog, icon: Plus } : undefined}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {stacks.map((stack) => (
            <Link key={stack.id} href={`/dashboard/stacks/${stack.id}`} className="block">
              <Card className="h-full transition-colors hover:border-primary/40">
                <CardContent className="space-y-3 p-5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{stack.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{stack.projectName}</p>
                    </div>
                    <StackStatusBadge status={stack.status} />
                  </div>
                  {stack.description && <p className="line-clamp-2 text-sm text-muted-foreground">{stack.description}</p>}
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      {stack.runningCount}/{stack.containerCount} running
                    </span>
                    {stack.updatedAt && <span>Updated {formatDateTime(stack.updatedAt)}</span>}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New stack</DialogTitle>
            <DialogDescription>
              Paste a Docker Compose file. GuildServer namespaces its containers, networks and volumes, and generates values for
              SERVICE_PASSWORD_* style variables.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="stack-name">Name</Label>
                <Input id="stack-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Analytics" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="stack-project">Project</Label>
                <select id="stack-project" className={NATIVE_SELECT_CLASS} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                  {projects.map((project: { id: string; name: string }) => (
                    <option key={project.id} value={project.id}>{project.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="stack-compose">Compose file</Label>
              <Textarea
                id="stack-compose"
                value={composeFile}
                onChange={(e) => setComposeFile(e.target.value)}
                rows={16}
                spellCheck={false}
                className="font-mono text-xs"
              />
            </div>
            {problem && (
              <div role="alert" className="whitespace-pre-wrap rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-400">
                {problem}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button
                onClick={() => {
                  setProblem(null)
                  createMutation.mutate({ name: name.trim(), projectId, composeFile })
                }}
                disabled={!name.trim() || !projectId || !composeFile.trim() || createMutation.isPending}
              >
                {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create stack
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
