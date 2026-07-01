"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Label } from "@/components/ui/label"
import { 
  Database, Plus, Search, Settings, Download, Upload,
  HardDrive, Activity, Clock, Users, Copy,
  Loader2, Trash2, RefreshCw
} from "lucide-react"
import { trpc } from "@/components/trpc-provider"
import { useOrganization, useProjects } from "@/hooks/use-auth"
import { toast } from "sonner"
import { ConfirmDialog, useConfirmDialog } from "@/components/ui/confirm-dialog"
import { ResponsiveModal } from "@/components/ui/responsive-modal"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { EmptyState } from "@/components/empty-state"
import { formatDateTime } from "@/lib/utils"

// ──────────────────────────────────────────────────────────────────────────────

const getStatusColor = (status: string) => {
  switch (status) {
    case "running":
      return "bg-green-50 text-green-700 border-green-200"
    case "stopped":
      return "bg-red-50 text-red-700 border-red-200"
    case "starting":
      return "bg-blue-50 text-blue-700 border-blue-200"
    case "maintenance":
      return "bg-yellow-50 text-yellow-700 border-yellow-200"
    default:
      return "bg-gray-50 text-gray-700 border-gray-200"
  }
}

const getTypeIcon = (type: string) => {
  const iconClass = "h-5 w-5 text-muted-foreground"
  switch (type.toLowerCase()) {
    case "postgresql":
      return <Database className={iconClass} />
    case "mysql":
    case "mariadb":
      return <Database className={iconClass} />
    case "redis":
      return <Activity className={iconClass} />
    default:
      return <Database className={iconClass} />
  }
}

export default function DatabasesPage() {
  const [searchQuery, setSearchQuery] = useState("")
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showSettingsModal, setShowSettingsModal] = useState(false)
  const [selectedDatabase, setSelectedDatabase] = useState<any>(null)

  // Form state
  const [name, setName] = useState("")
  const [type, setType] = useState<"postgresql" | "mysql" | "mongodb" | "redis" | "mariadb">("postgresql")
  const [databaseName, setDatabaseName] = useState("")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")

  // Backup configuration (shared by create + settings)
  const [backupEnabled, setBackupEnabled] = useState(false)
  const [backupFrequency, setBackupFrequency] = useState<"hourly" | "daily" | "weekly">("daily")
  const [backupHour, setBackupHour] = useState("3")
  const [backupRetentionDays, setBackupRetentionDays] = useState("7")
  const [backupDir, setBackupDir] = useState("")

  // Settings form state
  const [settingsMemory, setSettingsMemory] = useState("")
  const [settingsCpu, setSettingsCpu] = useState("")
  const [settingsPort, setSettingsPort] = useState("")

  const { confirm: showConfirm, dialogProps: confirmDialogProps } = useConfirmDialog()
  const { orgId, currentOrg, isLoading: orgLoading } = useOrganization()
  const { projectId } = useProjects(orgId)

  const isValidUUID = (s: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)

  const utils = trpc.useUtils()

  const databasesQuery = trpc.database.listByOrg.useQuery(
    { organizationId: orgId },
    { enabled: isValidUUID(orgId), refetchInterval: 30000 }
  )

  const createDatabase = trpc.database.create.useMutation({
    onSuccess: () => {
      toast.success("Database created!")
      utils.database.listByOrg.invalidate({ organizationId: orgId })
      setShowCreateModal(false)
      resetForm()
    },
    onError: (err) => toast.error(err.message),
  })

  const restartDatabase = trpc.database.restart.useMutation({
    onSuccess: () => {
      toast.success("Database restart initiated!")
      utils.database.listByOrg.invalidate({ organizationId: orgId })
    },
    onError: (err) => toast.error(err.message),
  })

  const deleteDatabase = trpc.database.delete.useMutation({
    onSuccess: () => {
      toast.success("Database deleted!")
      utils.database.listByOrg.invalidate({ organizationId: orgId })
    },
    onError: (err) => toast.error(err.message),
  })

  const updateDatabase = trpc.database.update.useMutation({
    onSuccess: () => {
      toast.success("Database updated!")
      utils.database.listByOrg.invalidate({ organizationId: orgId })
      setShowSettingsModal(false)
    },
    onError: (err) => toast.error(err.message),
  })

  const backupsQuery = trpc.database.listBackupsByOrg.useQuery(
    { organizationId: orgId },
    { enabled: isValidUUID(orgId), refetchInterval: 30000 }
  )

  const backupDatabase = trpc.database.backup.useMutation({
    onSuccess: () => {
      toast.success("Backup started!")
      utils.database.listBackupsByOrg.invalidate({ organizationId: orgId })
    },
    onError: (err) => toast.error(err.message),
  })

  const restoreDatabase = trpc.database.restore.useMutation({
    onSuccess: () => {
      toast.success("Restore started!")
      utils.database.listBackupsByOrg.invalidate({ organizationId: orgId })
    },
    onError: (err) => toast.error(err.message),
  })

  const updateBackupSettings = trpc.database.updateBackupSettings.useMutation({
    onSuccess: () => {
      toast.success("Backup settings saved!")
      utils.database.listByOrg.invalidate({ organizationId: orgId })
      setShowSettingsModal(false)
    },
    onError: (err) => toast.error(err.message),
  })

  const resetForm = () => {
    setName("")
    setType("postgresql")
    setDatabaseName("")
    setUsername("")
    setPassword("")
    setBackupEnabled(false)
    setBackupFrequency("daily")
    setBackupHour("3")
    setBackupRetentionDays("7")
    setBackupDir("")
  }

  const handleCreate = () => {
    if (!name || !databaseName || !username || !password) {
      toast.error("Please fill in all required fields.")
      return
    }
    createDatabase.mutate({
      projectId,
      name,
      type,
      databaseName,
      username,
      password,
      backupEnabled,
      backupFrequency,
      backupHour: parseInt(backupHour) || 3,
      backupRetentionDays: parseInt(backupRetentionDays) || 7,
      backupDir: backupDir || undefined,
    })
  }

  const handleDelete = (id: string, dbName: string) => {
    showConfirm({
      title: `Delete "${dbName}"?`,
      description: "This will permanently delete the database and all its data. This action cannot be undone.",
      confirmLabel: "Delete Database",
      variant: "danger",
      onConfirm: () => deleteDatabase.mutate({ id }),
    })
  }

  const handleRestart = (id: string) => {
    restartDatabase.mutate({ id })
  }

  const handleBackup = (id: string) => {
    backupDatabase.mutate({ id })
  }

  const handleRestore = (backupId: string, dbName: string) => {
    showConfirm({
      title: `Restore "${dbName}"?`,
      description: "This will overwrite current database data with the backup. Existing data will be lost.",
      confirmLabel: "Restore Database",
      variant: "danger",
      onConfirm: () => restoreDatabase.mutate({ backupId }),
    })
  }

  const handleDownloadBackup = (backupId: string) => {
    // The backup is streamed by the API's authenticated /downloads route. The
    // browser navigation can't send an auth header, so pass the JWT as a query
    // param (same short-lived token the SPA already holds).
    const token = typeof window !== "undefined" ? localStorage.getItem("guildserver-token") : ""
    const apiBase = (process.env.NEXT_PUBLIC_API_URL || "/trpc").replace(/\/trpc$/, "")
    window.open(`${apiBase}/downloads/backup/${backupId}?token=${encodeURIComponent(token || "")}`, "_blank")
  }

  const openSettings = (db: any) => {
    setSelectedDatabase(db)
    setSettingsMemory(db.memoryLimit?.toString() || "")
    setSettingsCpu(db.cpuLimit?.toString() || "")
    setSettingsPort(db.externalPort?.toString() || "")
    setBackupEnabled(!!db.backupEnabled)
    setBackupFrequency(db.backupFrequency || "daily")
    setBackupHour(db.backupHour?.toString() || "3")
    setBackupRetentionDays(db.backupRetentionDays?.toString() || "7")
    setBackupDir(db.backupDir || "")
    setShowSettingsModal(true)
  }

  const handleUpdateSettings = () => {
    if (!selectedDatabase) return
    updateDatabase.mutate({
      id: selectedDatabase.id,
      memoryLimit: settingsMemory ? parseInt(settingsMemory) : undefined,
      cpuLimit: settingsCpu ? parseInt(settingsCpu) : undefined,
      externalPort: settingsPort ? parseInt(settingsPort) : undefined,
    })
  }

  const handleSaveBackupSettings = () => {
    if (!selectedDatabase) return
    updateBackupSettings.mutate({
      id: selectedDatabase.id,
      backupEnabled,
      backupFrequency,
      backupHour: parseInt(backupHour) || 3,
      backupRetentionDays: parseInt(backupRetentionDays) || 7,
      backupDir: backupDir || undefined,
    })
  }

  const copyConnectionString = async (dbId: string) => {
    try {
      const info = await utils.database.getConnectionInfo.fetch({ id: dbId })
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(info.connectionString)
        toast.success("Connection string copied!")
      }
    } catch (e: any) {
      toast.error(e.message || "Failed to get connection string")
    }
  }

  // Shared backup-configuration fields (used in both Create and Settings modals).
  const backupConfigFields = (
    <div className="space-y-4 rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <div>
          <Label>Automatic Backups</Label>
          <p className="text-xs text-muted-foreground">Schedule recurring engine-native backups</p>
        </div>
        <Switch checked={backupEnabled} onCheckedChange={setBackupEnabled} />
      </div>
      {backupEnabled && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Frequency</Label>
              <Select value={backupFrequency} onValueChange={(v: any) => setBackupFrequency(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="hourly">Hourly</SelectItem>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Preferred Hour (0-23)</Label>
              <Input
                type="number"
                min={0}
                max={23}
                value={backupHour}
                onChange={e => setBackupHour(e.target.value)}
                disabled={backupFrequency === "hourly"}
                placeholder="3"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Retention (days)</Label>
            <Input
              type="number"
              min={1}
              max={365}
              value={backupRetentionDays}
              onChange={e => setBackupRetentionDays(e.target.value)}
              placeholder="7"
            />
            <p className="text-xs text-muted-foreground">Backups older than this are deleted automatically.</p>
          </div>
        </div>
      )}
      <div className="space-y-2">
        <Label>Backup Directory (optional)</Label>
        <Input
          value={backupDir}
          onChange={e => setBackupDir(e.target.value)}
          placeholder="Default: /var/lib/guildserver/backups/<db-id>"
        />
        <p className="text-xs text-muted-foreground">Host path where dump files are stored.</p>
      </div>
    </div>
  )

  const databases = databasesQuery.data || []
  const filteredDatabases = databases.filter((db: any) =>
    db.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    db.type.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const backups = backupsQuery.data || []

  if (!orgLoading && !currentOrg) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Databases</h1>
          <p className="text-muted-foreground">Manage your database instances and backups</p>
        </div>
        <Card className="text-center py-12">
          <CardContent>
            <Database className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">Create an organization first</h3>
            <p className="text-muted-foreground mb-6">You need an organization and project before creating databases</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Databases</h1>
          <p className="text-muted-foreground">Manage your database instances and backups</p>
        </div>
        <Button onClick={() => setShowCreateModal(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Create Database
        </Button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search databases..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10"
        />
      </div>

      <Tabs defaultValue="databases" className="space-y-4">
        <TabsList>
          <TabsTrigger value="databases">Databases</TabsTrigger>
          <TabsTrigger value="backups">Backups</TabsTrigger>
          <TabsTrigger value="monitoring">Monitoring</TabsTrigger>
        </TabsList>

        <TabsContent value="databases" className="space-y-4">
          {databasesQuery.isLoading ? (
            <div className="flex justify-center p-8"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
          ) : filteredDatabases.length === 0 ? (
            <Card className="text-center py-12">
              <CardContent>
                <EmptyState
                  icon={Database}
                  title={searchQuery ? "No databases found" : "No databases yet"}
                  description={searchQuery ? "No databases match your search criteria" : "Get started by creating your first database"}
                  action={{ label: "Create Database", onClick: () => setShowCreateModal(true), icon: Plus }}
                />
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {filteredDatabases.map((db: any) => (
                <Card key={db.id} className="relative hover:shadow-md transition-shadow">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {getTypeIcon(db.type)}
                        <CardTitle className="text-lg">{db.name}</CardTitle>
                      </div>
                      <Button variant="ghost" size="icon" className="text-red-500 hover:text-red-600 hover:bg-red-50" onClick={() => handleDelete(db.id, db.name)}>
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      <Badge variant="outline" className={getStatusColor(db.status || "running")}>
                        {db.status || "running"}
                      </Badge>
                      <Badge variant="secondary">{db.environment?.NODE_ENV || "production"}</Badge>
                    </div>
                  </CardHeader>

                  <CardContent className="space-y-4">
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Type:</span>
                        <span className="capitalize">{db.type}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Created:</span>
                        <span>{formatDateTime(db.createdAt)}</span>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <span className="text-sm font-medium">Connection</span>
                      <div className="flex gap-2">
                        <Input value="••••••••••••••••••••" readOnly className="text-xs text-muted-foreground" />
                        <Button variant="outline" size="sm" onClick={() => copyConnectionString(db.id)}>
                          <Copy className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" className="flex-1" onClick={() => handleRestart(db.id)} disabled={restartDatabase.isLoading}>
                        <RefreshCw className="mr-2 h-3 w-3" />
                        Restart
                      </Button>
                      <Button variant="outline" size="sm" className="flex-1" onClick={() => handleBackup(db.id)} disabled={backupDatabase.isLoading}>
                        <Download className="mr-2 h-3 w-3" />
                        Backup
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => openSettings(db)}>
                        <Settings className="h-3 w-3" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="backups" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle>Backup History</CardTitle>
                <CardDescription>Recent database backups for your project</CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => backupsQuery.refetch()}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Refresh
              </Button>
            </CardHeader>
            <CardContent>
              {backupsQuery.isLoading ? (
                <div className="flex justify-center py-8"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
              ) : backups.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Download className="mx-auto h-8 w-8 mb-4 opacity-50" />
                  <p>No backups found. Create one from the Databases tab.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {backups.map((backup: any) => (
                    <div key={backup.id} className="flex items-center justify-between p-4 border rounded-lg">
                      <div className="flex items-center gap-4">
                        <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                          <HardDrive className="h-5 w-5" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="font-medium">{backup.databaseName}</h4>
                            <Badge variant={backup.status === 'completed' ? 'secondary' : backup.status === 'failed' ? 'destructive' : 'outline'}>
                              {backup.status}
                            </Badge>
                            <Badge variant="outline" className="capitalize">{backup.backupType || 'manual'}</Badge>
                          </div>
                          <div className="text-sm text-muted-foreground flex items-center gap-3">
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {formatDateTime(backup.createdAt)}
                            </span>
                            <span>•</span>
                            <span>{(backup.sizeBytes / 1024 / 1024).toFixed(2)} MB</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={backup.status !== 'completed' || restoreDatabase.isLoading}
                          onClick={() => handleRestore(backup.id, backup.databaseName)}
                        >
                          <Upload className="mr-2 h-4 w-4" />
                          Restore
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={backup.status !== 'completed'}
                          onClick={() => handleDownloadBackup(backup.id)}
                        >
                          <Download className="mr-2 h-4 w-4" />
                          Download
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="monitoring" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Databases</CardTitle>
                <Database className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold font-mono tabular-nums">{databases.length}</div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      <ConfirmDialog {...confirmDialogProps} />

      {/* Create Modal */}
      <ResponsiveModal open={showCreateModal} onClose={() => setShowCreateModal(false)} title="Create Database">
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Instance Name</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. prod-db" />
          </div>
          <div className="space-y-2">
            <Label>Database Type</Label>
            <Select value={type} onValueChange={(v: any) => setType(v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="postgresql">PostgreSQL</SelectItem>
                <SelectItem value="mysql">MySQL</SelectItem>
                <SelectItem value="mariadb">MariaDB</SelectItem>
                <SelectItem value="mongodb">MongoDB</SelectItem>
                <SelectItem value="redis">Redis</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Logical Database Name</Label>
            <Input value={databaseName} onChange={e => setDatabaseName(e.target.value)} placeholder="e.g. main_db" />
          </div>
          <div className="space-y-2">
            <Label>Username</Label>
            <Input value={username} onChange={e => setUsername(e.target.value)} placeholder="e.g. dbuser" />
          </div>
          <div className="space-y-2">
            <Label>Password</Label>
            <Input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Minimum 8 characters" />
          </div>
          {backupConfigFields}
          <div className="pt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowCreateModal(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={createDatabase.isLoading}>
              {createDatabase.isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create
            </Button>
          </div>
        </div>
      </ResponsiveModal>

      {/* Settings Modal */}
      <ResponsiveModal open={showSettingsModal} onClose={() => setShowSettingsModal(false)} title="Database Settings">
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Memory Limit (MB)</Label>
            <Input type="number" value={settingsMemory} onChange={e => setSettingsMemory(e.target.value)} placeholder="e.g. 512" />
          </div>
          <div className="space-y-2">
            <Label>CPU Limit (Cores)</Label>
            <Input type="number" step="0.1" value={settingsCpu} onChange={e => setSettingsCpu(e.target.value)} placeholder="e.g. 1.0" />
          </div>
          <div className="space-y-2">
            <Label>External Port (Optional)</Label>
            <Input type="number" value={settingsPort} onChange={e => setSettingsPort(e.target.value)} placeholder="e.g. 5432" />
          </div>
          <div className="pt-2 flex justify-end">
            <Button variant="outline" size="sm" onClick={handleUpdateSettings} disabled={updateDatabase.isLoading}>
              {updateDatabase.isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Resources
            </Button>
          </div>

          <div className="border-t pt-4 space-y-4">
            <h4 className="text-sm font-medium">Backups</h4>
            {backupConfigFields}
          </div>
          <div className="pt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowSettingsModal(false)}>Close</Button>
            <Button onClick={handleSaveBackupSettings} disabled={updateBackupSettings.isLoading}>
              {updateBackupSettings.isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Backup Settings
            </Button>
          </div>
        </div>
      </ResponsiveModal>
    </div>
  )
}