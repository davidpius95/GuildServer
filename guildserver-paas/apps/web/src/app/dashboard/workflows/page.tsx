"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { 
  Workflow, Plus, Search, Play, Pause, Settings, GitBranch,
  Clock, CheckCircle, XCircle, AlertCircle, MoreHorizontal, Eye,
  Edit, Trash2, Loader2
} from "lucide-react"
import { trpc } from "@/components/trpc-provider"
import { useOrganization, useProjects } from "@/hooks/use-auth"
import { toast } from "sonner"
import { ConfirmDialog, useConfirmDialog } from "@/components/ui/confirm-dialog"
import { ResponsiveModal } from "@/components/ui/responsive-modal"
import { EmptyState } from "@/components/empty-state"
import { formatDateTime } from "@/lib/utils"
import { getFriendlyMessage } from "@/lib/errors"

const ACTIONS = [
  ["application.deploy", "Deploy application"], ["stack.deploy", "Deploy stack"],
  ["database.backup", "Back up database"], ["approval", "Wait for my approval"],
  ["http", "HTTP health check"], ["log", "Record a message"], ["delay", "Wait briefly"],
] as const
type DraftStep = { id: string; action: string; value: string }

const getStatusColor = (status: string) => {
  switch (status) {
    case "active":
    case "success":
    case "completed":
    case "running":
      return "bg-green-50 text-green-700 border-green-200"
    case "paused":
    case "pending":
    case "draft":
      return "bg-yellow-50 text-yellow-700 border-yellow-200"
    case "failed":
    case "error":
    case "cancelled":
      return "bg-red-50 text-red-700 border-red-200"
    default:
      return "bg-gray-50 text-gray-700 border-gray-200"
  }
}

const getStatusIcon = (status: string) => {
  switch (status) {
    case "success":
    case "completed":
      return <CheckCircle className="h-4 w-4 text-green-500" />
    case "failed":
    case "error":
    case "cancelled":
      return <XCircle className="h-4 w-4 text-red-500" />
    case "running":
      return <Clock className="h-4 w-4 text-blue-500 animate-spin" />
    case "warning":
    case "paused":
    case "pending":
    case "draft":
      return <AlertCircle className="h-4 w-4 text-yellow-500" />
    default:
      return <Clock className="h-4 w-4 text-gray-400" />
  }
}

export default function WorkflowsPage() {
  const [searchQuery, setSearchQuery] = useState("")
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showExecutionModal, setShowExecutionModal] = useState(false)
  const [selectedExecutionId, setSelectedExecutionId] = useState<string | null>(null)

  // Form state
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [editingId, setEditingId] = useState<string | null>(null)
  const [steps, setSteps] = useState<DraftStep[]>([{ id: "step-1", action: "application.deploy", value: "" }])
  
  const { confirm: showConfirm, dialogProps: confirmDialogProps } = useConfirmDialog()
  const { orgId, currentOrg, isLoading: orgLoading } = useOrganization()

  const { projectId } = useProjects(orgId)
  const appsQuery = trpc.application.list.useQuery({ projectId: projectId || "" }, { enabled: !!projectId && showCreateModal })
  const stacksQuery = trpc.service.list.useQuery({ projectId: projectId || "" }, { enabled: !!projectId && showCreateModal })
  const databasesQuery = trpc.database.list.useQuery({ projectId: projectId || "" }, { enabled: !!projectId && showCreateModal })

  const isValidUUID = (s: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)

  const utils = trpc.useUtils()

  const templatesQuery = trpc.workflow.listTemplates.useQuery(
    { organizationId: orgId },
    { enabled: isValidUUID(orgId), refetchInterval: 5000 }
  )

  const executionsQuery = trpc.workflow.listExecutions.useQuery(
    { organizationId: orgId },
    { enabled: isValidUUID(orgId), refetchInterval: 5000 }
  )

  const executionDetailsQuery = trpc.workflow.getExecutionById.useQuery(
    { id: selectedExecutionId || "" },
    { enabled: !!selectedExecutionId && showExecutionModal, refetchInterval: showExecutionModal ? 2000 : false }
  )

  const createTemplate = trpc.workflow.createTemplate.useMutation({
    onSuccess: () => {
      toast.success("Workflow template created!")
      utils.workflow.listTemplates.invalidate()
      setShowCreateModal(false)
      setName("")
      setDescription("")
    },
    onError: (err) => toast.error(getFriendlyMessage(err)),
  })

  const updateTemplate = trpc.workflow.updateTemplate.useMutation({
    onSuccess: () => {
      toast.success("Workflow updated!")
      setShowCreateModal(false)
      utils.workflow.listTemplates.invalidate()
    },
    onError: (err) => toast.error(getFriendlyMessage(err)),
  })

  const deleteTemplate = trpc.workflow.deleteTemplate.useMutation({
    onSuccess: () => {
      toast.success("Workflow template deleted!")
      utils.workflow.listTemplates.invalidate()
    },
    onError: (err) => toast.error(getFriendlyMessage(err)),
  })

  const executeWorkflow = trpc.workflow.executeWorkflow.useMutation({
    onSuccess: () => {
      toast.success("Workflow execution started!")
      utils.workflow.listExecutions.invalidate()
    },
    onError: (err) => toast.error(getFriendlyMessage(err)),
  })

  const approve = trpc.workflow.approveRequest.useMutation({
    onSuccess: () => { utils.workflow.getExecutionById.invalidate(); utils.workflow.listExecutions.invalidate() },
    onError: err => toast.error(getFriendlyMessage(err)),
  })
  const openEditor = (workflow?: any, action = "application.deploy") => {
    setEditingId(workflow?.id || null); setName(workflow?.name || ""); setDescription(workflow?.description || "")
    const existing = workflow?.definition?.steps
    setSteps(existing?.length ? existing.map((step: any) => ({ id: step.id, action: step.type === "approval" ? "approval" : step.config.action || "log", value: String(step.config.resourceId || step.config.url || step.config.message || step.config.ms || "") })) : [{ id: "step-1", action, value: "" }])
    setShowCreateModal(true)
  }
  const handleCreate = () => {
    if (!name.trim() || !steps.length || steps.some(step => step.action !== "approval" && !step.value.trim())) {
      toast.error("Give the workflow a name and configure every step."); return
    }
    const definition = { triggers: [{ type: "manual" as const, config: {} }], steps: steps.map(step => ({
      id: step.id, name: ACTIONS.find(a => a[0] === step.action)?.[1] || step.action,
      type: step.action === "approval" ? "approval" as const : "action" as const, nextSteps: [],
      config: step.action.endsWith(".deploy") || step.action === "database.backup" ? { action: step.action, resourceId: step.value }
        : step.action === "http" ? { action: "http", url: step.value, method: "GET" }
        : step.action === "delay" ? { action: "delay", ms: Number(step.value) }
        : { action: "log", message: step.value },
    })) }
    if (editingId) updateTemplate.mutate({ id: editingId, name, description, definition })
    else createTemplate.mutate({ organizationId: orgId, name, description, definition })
  }

  const handleDelete = (id: string, wfName: string) => {
    showConfirm({
      title: `Delete "${wfName}"?`,
      description: "This will permanently delete the workflow template. This action cannot be undone.",
      confirmLabel: "Delete Workflow",
      variant: "danger",
      onConfirm: () => deleteTemplate.mutate({ id }),
    })
  }

  const handleRun = (template: any) => {
    if (template.status !== "active") {
      showConfirm({
        title: "Workflow is not active",
        description: "This workflow template is currently a draft or inactive. Would you like to activate it and run?",
        confirmLabel: "Activate & Run",
        onConfirm: () => {
          updateTemplate.mutate({ id: template.id, status: "active" }, {
            onSuccess: () => {
              executeWorkflow.mutate({ templateId: template.id, context: {} })
            }
          })
        }
      })
      return
    }
    executeWorkflow.mutate({ templateId: template.id, context: {} })
  }

  const openExecutionLogs = (id: string) => {
    setSelectedExecutionId(id)
    setShowExecutionModal(true)
  }

  const workflows = templatesQuery.data || []
  const runs = executionsQuery.data || []

  const filteredWorkflows = workflows.filter((wf: any) =>
    wf.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    wf.description?.toLowerCase().includes(searchQuery.toLowerCase())
  )

  if (!orgLoading && !currentOrg) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Workflows</h1>
          <p className="text-muted-foreground">Automate your deployment and operational processes</p>
        </div>
        <Card className="text-center py-12">
          <CardContent>
            <Workflow className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">Create an organization first</h3>
            <p className="text-muted-foreground mb-6">You need an organization before creating workflows</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Workflows</h1>
          <p className="text-muted-foreground">Automate your deployment and operational processes</p>
        </div>
        <Button onClick={() => openEditor()}>
          <Plus className="mr-2 h-4 w-4" />
          Create Workflow
        </Button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search workflows..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10"
        />
      </div>

      <Tabs defaultValue="workflows" className="space-y-4">
        <TabsList>
          <TabsTrigger value="workflows">Workflows</TabsTrigger>
          <TabsTrigger value="runs">Recent Runs</TabsTrigger>
          <TabsTrigger value="templates">Templates</TabsTrigger>
        </TabsList>

        <TabsContent value="workflows" className="space-y-4">
          {templatesQuery.isLoading ? (
            <div className="flex justify-center p-8"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
          ) : filteredWorkflows.length === 0 ? (
            <Card className="text-center py-12">
              <CardContent>
                <EmptyState
                  icon={Workflow}
                  title={searchQuery ? "No workflows found" : "No workflows yet"}
                  description={searchQuery ? "No workflows match your search criteria" : "Get started by creating your first workflow"}
                  action={{ label: "Create Workflow", onClick: () => setShowCreateModal(true), icon: Plus }}
                />
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {filteredWorkflows.map((workflow: any) => (
                <Card key={workflow.id} className="relative">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Workflow className="h-5 w-5 text-muted-foreground" />
                        <CardTitle className="text-lg">{workflow.name}</CardTitle>
                      </div>
                      <Button variant="ghost" size="icon" onClick={() => handleDelete(workflow.id, workflow.name)}>
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </div>
                    <CardDescription className="truncate">{workflow.description || "No description"}</CardDescription>
                    <div className="flex items-center gap-2 mt-2">
                      <Badge variant="outline" className={getStatusColor(workflow.status)}>
                        {workflow.status}
                      </Badge>
                      <Badge variant="secondary">custom</Badge>
                    </div>
                  </CardHeader>

                  <CardContent className="space-y-4">
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Trigger:</span>
                        <span className="capitalize">{workflow.definition?.triggers?.[0]?.type || "Manual"}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Last Run:</span>
                        <span>{workflow.executions?.[0] ? formatDateTime(workflow.executions[0].createdAt) : "Never"}</span>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <span className="text-sm font-medium">Steps ({workflow.definition?.steps?.length || 0})</span>
                      <div className="space-y-1">
                        {(workflow.definition?.steps || []).slice(0, 3).map((step: any, index: number) => (
                          <div key={index} className="flex items-center gap-2 text-sm">
                            <Clock className="h-4 w-4 text-muted-foreground" />
                            <span className="truncate">{step.name}</span>
                          </div>
                        ))}
                        {(workflow.definition?.steps?.length || 0) === 0 && (
                          <div className="text-xs text-muted-foreground italic">No steps defined</div>
                        )}
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" className="flex-1" onClick={() => handleRun(workflow)} disabled={executeWorkflow.isLoading}>
                        <Play className="mr-2 h-3 w-3" />
                        Run
                      </Button>
                      <Button variant="outline" size="sm" className="flex-1" onClick={() => openEditor(workflow)}>
                        <Edit className="mr-2 h-3 w-3" />
                        Edit (soon)
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="runs" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Recent Workflow Runs</CardTitle>
              <CardDescription>Latest workflow executions and their status</CardDescription>
            </CardHeader>
            <CardContent>
              {executionsQuery.isLoading ? (
                <div className="flex justify-center py-8"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
              ) : runs.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Play className="mx-auto h-8 w-8 mb-4 opacity-50" />
                  <p>No executions have run yet.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {runs.map((run: any) => (
                    <div key={run.id} className="flex items-center justify-between p-4 border rounded-lg">
                      <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2">
                          {getStatusIcon(run.status)}
                          <div>
                            <h4 className="font-medium">{run.template?.name || run.name || "Unknown Workflow"}</h4>
                            <div className="flex gap-4 text-sm text-muted-foreground">
                              <span>{formatDateTime(run.createdAt)}</span>
                              <span>{run.status}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className={getStatusColor(run.status)}>
                          {run.status}
                        </Badge>
                        <Button variant="outline" size="sm" onClick={() => openExecutionLogs(run.id)}>
                          <Eye className="mr-2 h-3 w-3" />
                          View Logs
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="templates" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[
              { name: "Application deployment", desc: "Deploy an existing application and wait for its deployment result.", action: "application.deploy" },
              { name: "Stack deployment", desc: "Deploy a Compose stack and track its services becoming ready.", action: "stack.deploy" },
              { name: "Database backup", desc: "Create a real backup and wait for it to finish.", action: "database.backup" },
              { name: "HTTP health check", desc: "Check a public URL and fail the run if it does not respond successfully.", action: "http" },
            ].map((tmpl: { name: string; desc: string; action: string; experimental?: boolean }, i) => (
              <Card key={i} className="cursor-pointer hover:shadow-md transition-shadow">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Workflow className="h-5 w-5" />
                    {tmpl.name}
                    {tmpl.experimental && (
                      <span className="rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        Experimental
                      </span>
                    )}
                  </CardTitle>
                  <CardDescription>{tmpl.desc}</CardDescription>
                </CardHeader>
                <CardContent>
                  <Button variant="outline" className="w-full" onClick={() => openEditor({ name: tmpl.name, description: tmpl.desc }, tmpl.action)} disabled={createTemplate.isLoading}>
                    Use Template
                  </Button>
                </CardContent>
              </Card>
            ))}

            <Card className="cursor-pointer hover:shadow-md transition-shadow">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Workflow className="h-5 w-5" />
                  Custom Workflow
                </CardTitle>
                <CardDescription>
                  Start from scratch and build your own custom workflow
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button variant="outline" className="w-full" onClick={() => openEditor()}>
                  Create Custom
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      <ConfirmDialog {...confirmDialogProps} />

      {/* Create Modal */}
      <ResponsiveModal open={showCreateModal} onClose={() => setShowCreateModal(false)} title={editingId ? "Edit Workflow" : "Create Workflow"}>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="workflow-name">Workflow Name</Label>
            <Input id="workflow-name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. My CI/CD Pipeline" />
          </div>
          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="What does this workflow do?" />
          </div>
          <p className="text-sm text-muted-foreground">Steps run in order when you select Run. Resource actions use the current project and require owner or administrator access.</p>
          {steps.map((step, index) => {
            const resources = step.action === "application.deploy" ? appsQuery.data : step.action === "stack.deploy" ? stacksQuery.data : databasesQuery.data
            const update = (patch: Partial<DraftStep>) => setSteps(current => current.map(item => item.id === step.id ? { ...item, ...patch } : item))
            return <div key={step.id} className="space-y-2 rounded-lg border p-3">
              <div className="flex items-center justify-between"><Label htmlFor={`action-${step.id}`}>Step {index + 1}</Label><Button variant="ghost" size="sm" onClick={() => setSteps(current => current.filter(item => item.id !== step.id))}>Remove</Button></div>
              <select id={`action-${step.id}`} value={step.action} onChange={e => update({ action: e.target.value, value: "" })} className="w-full rounded-md border bg-background p-2 text-sm">{ACTIONS.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select>
              {step.action.endsWith(".deploy") || step.action === "database.backup" ? <select aria-label={`Resource for step ${index + 1}`} value={step.value} onChange={e => update({ value: e.target.value })} className="w-full rounded-md border bg-background p-2 text-sm"><option value="">Choose a resource</option>{(resources || []).map((resource: any) => <option key={resource.id} value={resource.id}>{resource.name}</option>)}</select>
                : step.action !== "approval" && <Input aria-label={`Value for step ${index + 1}`} value={step.value} onChange={e => update({ value: e.target.value })} placeholder={step.action === "http" ? "https://your-app.example.com/health" : step.action === "delay" ? "Milliseconds (0–30000)" : "Message"} />}
            </div>
          })}
          <Button variant="outline" disabled={steps.length >= 30} onClick={() => setSteps(current => [...current, { id: crypto.randomUUID(), action: "log", value: "" }])}>Add step</Button>
          <div className="pt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowCreateModal(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={createTemplate.isLoading}>
              {createTemplate.isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editingId ? "Save changes" : "Create"}
            </Button>
          </div>
        </div>
      </ResponsiveModal>

      {/* Execution Logs Modal */}
      <ResponsiveModal open={showExecutionModal} onClose={() => setShowExecutionModal(false)} title="Execution Details">
        <div className="space-y-4">
          {executionDetailsQuery.isLoading ? (
             <div className="flex justify-center p-8"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
          ) : executionDetailsQuery.data ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-medium text-lg">{executionDetailsQuery.data.template?.name || "Unknown"}</h3>
                <Badge variant="outline" className={getStatusColor(executionDetailsQuery.data.status ?? "")}>
                  {executionDetailsQuery.data.status}
                </Badge>
              </div>
              {executionDetailsQuery.data.approvalRequests.filter(request => request.status === "pending").map(request => <div key={request.id} className="flex gap-2"><Button disabled={approve.isLoading} onClick={() => approve.mutate({ requestId: request.id, approved: true })}>Approve and continue</Button><Button variant="outline" disabled={approve.isLoading} onClick={() => approve.mutate({ requestId: request.id, approved: false })}>Reject</Button></div>)}
              <div className="bg-muted p-4 rounded-md text-sm font-mono whitespace-pre-wrap">
                {JSON.stringify(Object.fromEntries(Object.entries(executionDetailsQuery.data.context as Record<string, unknown> || {}).filter(([key]) => key !== "__definition")), null, 2)}
                {"\n"}
                {executionDetailsQuery.data.errorMessage || `Step ${executionDetailsQuery.data.currentStep ?? 0} · ${executionDetailsQuery.data.status}`}
              </div>
            </div>
          ) : (
            <div className="text-center py-4 text-muted-foreground">Failed to load execution details.</div>
          )}
        </div>
      </ResponsiveModal>
    </div>
  )
}