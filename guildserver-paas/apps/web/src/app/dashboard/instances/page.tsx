"use client"

import { useState, useMemo } from "react"
import Link from "next/link"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { trpc } from "@/components/trpc-provider"
import { useOrganization } from "@/hooks/use-auth"
import { toast } from "sonner"
import { ResponsiveModal } from "@/components/ui/responsive-modal"
import { ConfirmDialog, useConfirmDialog } from "@/components/ui/confirm-dialog"
import {
  Server,
  Plus,
  Loader2,
  Cpu,
  MemoryStick,
  HardDrive,
  Network,
  Trash2,
  CheckCircle,
  Clock,
  AlertTriangle,
  XCircle,
} from "lucide-react"

const statusStyles: Record<string, string> = {
  active: "bg-green-50 text-green-700 border-green-200",
  provisioning: "bg-blue-50 text-blue-700 border-blue-200",
  pending: "bg-yellow-50 text-yellow-700 border-yellow-200",
  stopped: "bg-gray-50 text-gray-700 border-gray-200",
  error: "bg-red-50 text-red-700 border-red-200",
  terminated: "bg-gray-50 text-gray-500 border-gray-200",
}

function StatusIcon({ status }: { status: string }) {
  if (status === "active") return <CheckCircle className="h-4 w-4 text-green-500" />
  if (status === "provisioning" || status === "pending") return <Clock className="h-4 w-4 text-blue-500 animate-pulse" />
  if (status === "error") return <XCircle className="h-4 w-4 text-red-500" />
  return <AlertTriangle className="h-4 w-4 text-muted-foreground" />
}

function fmtUSD(cents: number, digits = 2) {
  return `$${(cents / 100).toFixed(digits)}`
}
function fmtRam(ramMb: number) {
  return ramMb >= 1024 ? `${ramMb / 1024} GB` : `${ramMb} MB`
}

export default function InstancesPage() {
  const { orgId } = useOrganization()
  const utils = trpc.useUtils()
  const { confirm: showConfirm, dialogProps: confirmDialogProps } = useConfirmDialog()

  const [showCreate, setShowCreate] = useState(false)
  const [name, setName] = useState("")
  const [typeId, setTypeId] = useState("")
  const [region, setRegion] = useState("default")
  const [billingPeriod, setBillingPeriod] = useState<"monthly" | "hourly">("monthly")
  const [extraStorage, setExtraStorage] = useState(0)
  const [backups, setBackups] = useState(false)

  const instancesQuery = trpc.instance.list.useQuery(
    { organizationId: orgId },
    { enabled: !!orgId, refetchInterval: 10000 }
  )
  const typesQuery = trpc.billing.getInstanceTypes.useQuery()

  const types = typesQuery.data || []
  const selectedType = useMemo(
    () => types.find((t: any) => t.id === typeId) || types[0],
    [types, typeId]
  )

  const estMonthlyCents = selectedType
    ? selectedType.priceMonthly + Math.max(0, extraStorage) * 10 + (backups ? Math.round(selectedType.priceMonthly * 0.2) : 0)
    : 0

  const createInstance = trpc.instance.create.useMutation({
    onSuccess: (data: any) => {
      if (data?.checkoutUrl) {
        window.location.href = data.checkoutUrl
        return
      }
      toast.success("Instance is being provisioned")
      setShowCreate(false)
      resetForm()
      utils.instance.list.invalidate()
    },
    onError: (err: any) => toast.error(err.message),
  })

  const destroyInstance = trpc.instance.destroy.useMutation({
    onSuccess: () => {
      toast.success("Instance termination queued")
      utils.instance.list.invalidate()
    },
    onError: (err: any) => toast.error(err.message),
  })

  const resetForm = () => {
    setName("")
    setTypeId("")
    setRegion("default")
    setBillingPeriod("monthly")
    setExtraStorage(0)
    setBackups(false)
  }

  const handleCreate = () => {
    if (!name.trim()) return toast.error("Instance name is required")
    if (!selectedType) return toast.error("Select an instance type")
    if (!orgId) return toast.error("Create an organization first")
    createInstance.mutate({
      organizationId: orgId,
      instanceTypeId: selectedType.id,
      name: name.trim(),
      region,
      billingPeriod,
      extraStorageGb: extraStorage,
      backupsEnabled: backups,
    })
  }

  const handleDestroy = (id: string, instanceName: string) => {
    showConfirm({
      title: `Destroy "${instanceName}"?`,
      description: "This permanently deletes the instance and its data, and cancels its subscription. This cannot be undone.",
      confirmLabel: "Destroy",
      variant: "danger",
      onConfirm: () => destroyInstance.mutate({ id, organizationId: orgId }),
    })
  }

  const instances = instancesQuery.data || []

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">VPS Instances</h1>
          <p className="text-muted-foreground">Raw compute — sized vCPU, RAM, and NVMe storage you control.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" asChild>
            <Link href="/pricing">View pricing</Link>
          </Button>
          <Button onClick={() => setShowCreate(true)} disabled={!orgId}>
            <Plus className="mr-2 h-4 w-4" />
            New Instance
          </Button>
        </div>
      </div>

      {/* List */}
      {instancesQuery.isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : instances.length === 0 ? (
        <Card className="text-center py-12">
          <CardContent>
            <Server className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No instances yet</h3>
            <p className="text-muted-foreground mb-6">Spin up your first VPS in seconds.</p>
            <Button onClick={() => setShowCreate(true)} disabled={!orgId}>
              <Plus className="mr-2 h-4 w-4" />
              New Instance
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {instances.map((inst: any) => (
            <Card key={inst.id} className="hover:shadow-md transition-shadow">
              <CardContent className="flex items-center justify-between py-4">
                <div className="flex items-center gap-4">
                  <Server className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{inst.name}</span>
                      {inst.instanceType && (
                        <Badge variant="outline" className="text-xs">{inst.instanceType.name}</Badge>
                      )}
                      <Badge variant="outline" className={`text-xs ${statusStyles[inst.status] || ""}`}>
                        <span className="inline-flex items-center gap-1"><StatusIcon status={inst.status} />{inst.status}</span>
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
                      {inst.instanceType && (
                        <>
                          <span className="inline-flex items-center gap-1"><Cpu className="h-3 w-3" />{inst.instanceType.vcpu} vCPU</span>
                          <span className="inline-flex items-center gap-1"><MemoryStick className="h-3 w-3" />{fmtRam(inst.instanceType.ramMb)}</span>
                          <span className="inline-flex items-center gap-1"><HardDrive className="h-3 w-3" />{inst.instanceType.storageGb + (inst.extraStorageGb || 0)} GB</span>
                        </>
                      )}
                      {inst.ipv4 && <span className="inline-flex items-center gap-1"><Network className="h-3 w-3" />{inst.ipv4}</span>}
                      <span className="capitalize">{inst.billingPeriod}</span>
                    </div>
                    {inst.statusMessage && (
                      <p className={`text-xs mt-1 ${inst.status === "error" ? "text-red-500" : "text-muted-foreground"}`}>{inst.statusMessage}</p>
                    )}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-red-500"
                  onClick={() => handleDestroy(inst.id, inst.name)}
                  disabled={inst.status === "terminated"}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create modal */}
      <ResponsiveModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        title="New VPS Instance"
        footer={
          <div className="flex items-center justify-between w-full">
            <div className="text-sm">
              <span className="text-muted-foreground">Estimated </span>
              <span className="font-semibold">{fmtUSD(estMonthlyCents)}/mo</span>
              <span className="text-muted-foreground"> · ${(estMonthlyCents / 100 / 730).toFixed(4)}/hr</span>
            </div>
            <Button onClick={handleCreate} disabled={createInstance.isPending}>
              {createInstance.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              Create
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="inst-name">Name</Label>
            <Input id="inst-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="my-server" />
          </div>

          <div className="space-y-2">
            <Label>Instance type</Label>
            <select
              value={selectedType?.id || ""}
              onChange={(e) => setTypeId(e.target.value)}
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
            >
              {types.map((t: any) => (
                <option key={t.id} value={t.id}>
                  {t.name} — {t.vcpu} vCPU / {fmtRam(t.ramMb)} / {t.storageGb} GB ({fmtUSD(t.priceMonthly, 0)}/mo)
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="inst-region">Region</Label>
              <Input id="inst-region" value={region} onChange={(e) => setRegion(e.target.value)} placeholder="default" />
            </div>
            <div className="space-y-2">
              <Label>Billing</Label>
              <select
                value={billingPeriod}
                onChange={(e) => setBillingPeriod(e.target.value as "monthly" | "hourly")}
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
              >
                <option value="monthly">Monthly</option>
                <option value="hourly">Hourly</option>
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="inst-storage">Extra block storage (GB)</Label>
            <Input
              id="inst-storage"
              type="number"
              min={0}
              value={extraStorage}
              onChange={(e) => setExtraStorage(Math.max(0, Number(e.target.value) || 0))}
            />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={backups} onChange={(e) => setBackups(e.target.checked)} />
            Automated backups (+20%)
          </label>
        </div>
      </ResponsiveModal>

      <ConfirmDialog {...confirmDialogProps} />
    </div>
  )
}
