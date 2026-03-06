"use client";

import { useState } from "react";
import { trpc } from "@/components/trpc-provider";
import {
  Server,
  Plus,
  CheckCircle2,
  XCircle,
  Clock,
  RefreshCw,
  Trash2,
  Cloud,
  Container,
  Database,
  ArrowLeft,
  ArrowRight,
  Loader2,
  AlertCircle,
  Cpu,
  HardDrive,
  MemoryStick,
  ChevronDown,
  ChevronUp,
  Wrench,
  Play,
  Square,
  Box,
  Eye,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Shared components
// ---------------------------------------------------------------------------

function ProviderIcon({ type, className }: { type: string; className?: string }) {
  switch (type) {
    case "docker-local":
    case "docker-remote":
      return <Container className={className} />;
    case "proxmox":
      return <Server className={className} />;
    case "kubernetes":
      return <Database className={className} />;
    case "aws-ecs":
    case "gcp-cloudrun":
    case "azure-aci":
    case "hetzner":
    case "digitalocean":
      return <Cloud className={className} />;
    default:
      return <Server className={className} />;
  }
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    connected: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
    error: "bg-red-500/10 text-red-500 border-red-500/20",
    pending: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
    disabled: "bg-gray-500/10 text-gray-400 border-gray-500/20",
  };

  const icons: Record<string, React.ReactNode> = {
    connected: <CheckCircle2 className="h-3 w-3" />,
    error: <XCircle className="h-3 w-3" />,
    pending: <Clock className="h-3 w-3" />,
    disabled: <Wrench className="h-3 w-3" />,
  };

  const labels: Record<string, string> = {
    connected: "Connected",
    error: "Error",
    pending: "Pending",
    disabled: "Maintenance",
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${
        styles[status] || styles.pending
      }`}
    >
      {icons[status] || icons.pending}
      {labels[status] || status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

/** Progress bar with color based on usage level */
function ResourceBar({
  label,
  percent,
  detail,
  icon: Icon,
}: {
  label: string;
  percent: number;
  detail?: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  const barColor =
    percent >= 90
      ? "bg-red-500"
      : percent >= 70
      ? "bg-yellow-500"
      : "bg-emerald-500";

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Icon className="h-3 w-3" />
          {label}
        </span>
        <span className="font-mono text-muted-foreground">
          {percent}%{detail && ` — ${detail}`}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
        <div
          className={`h-full rounded-full transition-all duration-500 ${barColor}`}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
    </div>
  );
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  if (days > 0) return `${days}d ${hours}h`;
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

// ---------------------------------------------------------------------------
// Provider Config Form
// ---------------------------------------------------------------------------

function ProviderConfigForm({
  schema,
  values,
  onChange,
}: {
  schema: any[];
  values: Record<string, any>;
  onChange: (key: string, value: any) => void;
}) {
  if (!schema || schema.length === 0) {
    return (
      <p className="text-sm text-gray-400 italic">
        No configuration required for this provider type.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {schema.map((field: any) => (
        <div key={field.name}>
          <label className="mb-1.5 block text-sm font-medium text-gray-300">
            {field.label}
            {field.required && <span className="ml-1 text-red-400">*</span>}
          </label>

          {field.type === "select" ? (
            <select
              value={values[field.name] ?? field.defaultValue ?? ""}
              onChange={(e) => onChange(field.name, e.target.value)}
              className="w-full rounded-lg border border-gray-600 bg-gray-700 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
            >
              <option value="">Select...</option>
              {field.options?.map((opt: any) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          ) : field.type === "textarea" ? (
            <textarea
              value={values[field.name] ?? ""}
              onChange={(e) => onChange(field.name, e.target.value)}
              placeholder={field.placeholder}
              rows={4}
              className="w-full rounded-lg border border-gray-600 bg-gray-700 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-emerald-500 focus:outline-none font-mono"
            />
          ) : field.type === "boolean" ? (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={values[field.name] ?? field.defaultValue ?? false}
                onChange={(e) => onChange(field.name, e.target.checked)}
                className="h-4 w-4 rounded border-gray-600 bg-gray-700 text-emerald-500"
              />
              <span className="text-sm text-gray-400">{field.description}</span>
            </label>
          ) : (
            <input
              type={field.type === "password" ? "password" : field.type === "number" ? "number" : "text"}
              value={values[field.name] ?? field.defaultValue ?? ""}
              onChange={(e) =>
                onChange(
                  field.name,
                  field.type === "number" ? Number(e.target.value) : e.target.value
                )
              }
              placeholder={field.placeholder}
              className="w-full rounded-lg border border-gray-600 bg-gray-700 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-emerald-500 focus:outline-none"
            />
          )}

          {field.description && field.type !== "boolean" && (
            <p className="mt-1 text-xs text-gray-500">{field.description}</p>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add Provider Wizard
// ---------------------------------------------------------------------------

function AddProviderWizard({
  onClose,
  onCreated,
  availableProviders,
}: {
  onClose: () => void;
  onCreated: () => void;
  availableProviders: any[];
}) {
  const [step, setStep] = useState<"select" | "configure" | "test">("select");
  const [selectedType, setSelectedType] = useState<any>(null);
  const [providerName, setProviderName] = useState("");
  const [providerRegion, setProviderRegion] = useState("");
  const [configValues, setConfigValues] = useState<Record<string, any>>({});
  const [testResult, setTestResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const createMutation = trpc.provider.create.useMutation({
    onSuccess: (data: any) => {
      setTestResult({
        connected: data.status === "connected",
        message: data.healthMessage || (data.status === "connected" ? "Connected successfully" : "Connection failed"),
      });
      setStep("test");
    },
    onError: (err: any) => {
      setError(err.message);
    },
  });

  const handleSelectType = (provider: any) => {
    setSelectedType(provider);
    setProviderName(provider.name);
    setConfigValues({});
    setError(null);
    setTestResult(null);
    setStep("configure");
  };

  const handleCreate = () => {
    setError(null);
    createMutation.mutate({
      name: providerName || selectedType.name,
      type: selectedType.type,
      config: configValues,
      region: providerRegion || undefined,
      isDefault: false,
    });
  };

  const handleConfigChange = (key: string, value: any) => {
    setConfigValues((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-xl border border-gray-700 bg-gray-800 p-6 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            {step !== "select" && (
              <button
                onClick={() => {
                  if (step === "configure") setStep("select");
                  if (step === "test") setStep("configure");
                }}
                className="text-gray-400 hover:text-white"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
            )}
            <h2 className="text-lg font-semibold text-white">
              {step === "select" && "Add Infrastructure Provider"}
              {step === "configure" && `Configure ${selectedType?.name || "Provider"}`}
              {step === "test" && "Connection Test"}
            </h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <XCircle className="h-5 w-5" />
          </button>
        </div>

        {/* Step indicator */}
        <div className="mb-6 flex items-center gap-2">
          {["select", "configure", "test"].map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <div
                className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                  step === s
                    ? "bg-emerald-500 text-white"
                    : i < ["select", "configure", "test"].indexOf(step)
                    ? "bg-emerald-500/20 text-emerald-400"
                    : "bg-gray-700 text-gray-500"
                }`}
              >
                {i + 1}
              </div>
              {i < 2 && (
                <div
                  className={`h-0.5 w-8 ${
                    i < ["select", "configure", "test"].indexOf(step)
                      ? "bg-emerald-500/40"
                      : "bg-gray-700"
                  }`}
                />
              )}
            </div>
          ))}
          <span className="ml-2 text-xs text-gray-500">
            {step === "select" && "Choose provider type"}
            {step === "configure" && "Enter connection details"}
            {step === "test" && "Verify connection"}
          </span>
        </div>

        {/* Step 1: Select provider type */}
        {step === "select" && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {availableProviders.map((p: any) => (
              <button
                key={p.type}
                onClick={() => p.implemented && handleSelectType(p)}
                disabled={!p.implemented}
                className={`flex flex-col items-center gap-2 rounded-lg border p-4 text-center transition-colors ${
                  p.implemented
                    ? "border-gray-600 bg-gray-700/50 hover:border-emerald-500 hover:bg-emerald-500/10 cursor-pointer"
                    : "border-gray-700/50 bg-gray-800/30 opacity-50 cursor-not-allowed"
                }`}
              >
                <ProviderIcon type={p.type} className="h-8 w-8 text-gray-300" />
                <span className="text-sm font-medium text-white">{p.name}</span>
                <span className="text-xs text-gray-400 line-clamp-2">{p.description}</span>
                {!p.implemented && (
                  <span className="mt-1 rounded-full bg-gray-700 px-2 py-0.5 text-[10px] text-gray-400">
                    Coming Soon
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Step 2: Configure */}
        {step === "configure" && selectedType && (
          <div className="space-y-5">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-300">
                Provider Name <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={providerName}
                onChange={(e) => setProviderName(e.target.value)}
                placeholder={`My ${selectedType.name}`}
                className="w-full rounded-lg border border-gray-600 bg-gray-700 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-300">
                Region / Location
              </label>
              <input
                type="text"
                value={providerRegion}
                onChange={(e) => setProviderRegion(e.target.value)}
                placeholder="e.g. homelab, us-east, eu-west"
                className="w-full rounded-lg border border-gray-600 bg-gray-700 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <div className="border-t border-gray-700 pt-4">
              <h3 className="mb-3 text-sm font-semibold text-gray-300">Connection Settings</h3>
              <ProviderConfigForm
                schema={selectedType.configSchema}
                values={configValues}
                onChange={handleConfigChange}
              />
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3">
                <AlertCircle className="h-4 w-4 mt-0.5 text-red-400 flex-shrink-0" />
                <p className="text-sm text-red-300">{error}</p>
              </div>
            )}

            <div className="flex justify-between pt-2">
              <button
                onClick={() => setStep("select")}
                className="inline-flex items-center gap-1.5 rounded-lg bg-gray-700 px-4 py-2 text-sm text-gray-300 hover:bg-gray-600 transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </button>
              <button
                onClick={handleCreate}
                disabled={createMutation.isPending || !providerName.trim()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 transition-colors disabled:opacity-50"
              >
                {createMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Testing Connection...
                  </>
                ) : (
                  <>
                    Connect & Test
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Test result */}
        {step === "test" && (
          <div className="space-y-6">
            <div
              className={`flex flex-col items-center gap-4 rounded-xl border p-8 ${
                testResult?.connected
                  ? "border-emerald-500/30 bg-emerald-500/5"
                  : "border-red-500/30 bg-red-500/5"
              }`}
            >
              {testResult?.connected ? (
                <CheckCircle2 className="h-16 w-16 text-emerald-400" />
              ) : (
                <XCircle className="h-16 w-16 text-red-400" />
              )}
              <h3 className="text-lg font-semibold text-white">
                {testResult?.connected ? "Connection Successful!" : "Connection Failed"}
              </h3>
              <p className="text-sm text-gray-400 text-center">{testResult?.message}</p>
            </div>

            <div className="flex justify-end gap-3">
              {!testResult?.connected && (
                <button
                  onClick={() => setStep("configure")}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-gray-700 px-4 py-2 text-sm text-gray-300 hover:bg-gray-600 transition-colors"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Edit Config
                </button>
              )}
              <button
                onClick={() => {
                  onCreated();
                  onClose();
                }}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 transition-colors"
              >
                {testResult?.connected ? "Done" : "Close"}
              </button>
            </div>
          </div>
        )}

        {step === "select" && (
          <div className="mt-6 flex justify-end">
            <button
              onClick={onClose}
              className="rounded-lg bg-gray-700 px-4 py-2 text-sm text-gray-300 hover:bg-gray-600 transition-colors"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Proxmox Node Detail Panel
// ---------------------------------------------------------------------------

function ProxmoxDetailPanel({ providerId }: { providerId: string }) {
  const [activeTab, setActiveTab] = useState<"resources" | "containers" | "storage">("resources");
  const [actionVmid, setActionVmid] = useState<number | null>(null);

  const resourcesQuery = trpc.infrastructure.getNodeResources.useQuery(
    { id: providerId },
    { refetchInterval: 15000 }, // auto-refresh every 15s
  );
  const containersQuery = trpc.infrastructure.listLxcContainers.useQuery(
    { id: providerId },
    { enabled: activeTab === "containers", refetchInterval: activeTab === "containers" ? 10000 : false },
  );
  const storageQuery = trpc.infrastructure.listStorages.useQuery(
    { id: providerId },
    { enabled: activeTab === "storage" },
  );

  const startMutation = trpc.infrastructure.startContainer.useMutation({
    onSuccess: (data) => { setActionVmid(null); containersQuery.refetch(); },
    onError: (err) => { setActionVmid(null); alert(err.message); },
  });
  const stopMutation = trpc.infrastructure.stopContainer.useMutation({
    onSuccess: (data) => { setActionVmid(null); containersQuery.refetch(); },
    onError: (err) => { setActionVmid(null); alert(err.message); },
  });
  const destroyMutation = trpc.infrastructure.destroyContainer.useMutation({
    onSuccess: (data) => { setActionVmid(null); containersQuery.refetch(); },
    onError: (err) => { setActionVmid(null); alert(err.message); },
  });

  const isContainerBusy = (vmid: number) =>
    actionVmid === vmid || startMutation.isPending || stopMutation.isPending || destroyMutation.isPending;

  const tabs = [
    { id: "resources" as const, label: "Resources", icon: Cpu },
    { id: "containers" as const, label: "Containers", icon: Box },
    { id: "storage" as const, label: "Storage", icon: HardDrive },
  ];

  return (
    <div className="mt-4 rounded-lg border bg-card/50 p-4">
      {/* Tab navigation */}
      <div className="flex gap-1 border-b pb-3 mb-4">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              activeTab === tab.id
                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                : "text-muted-foreground hover:bg-secondary"
            }`}
          >
            <tab.icon className="h-3 w-3" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Resources tab */}
      {activeTab === "resources" && (
        <div>
          {resourcesQuery.isLoading && (
            <div className="flex items-center gap-2 py-8 justify-center text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading node resources...
            </div>
          )}
          {resourcesQuery.error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3">
              <AlertCircle className="h-4 w-4 mt-0.5 text-red-400 flex-shrink-0" />
              <p className="text-sm text-red-300">{resourcesQuery.error.message}</p>
            </div>
          )}
          {resourcesQuery.data && (
            <div className="space-y-4">
              {/* Summary stats row */}
              <div className="grid grid-cols-3 gap-4">
                <div className="rounded-lg border bg-card p-3">
                  <div className="text-xs text-muted-foreground mb-1">Node</div>
                  <div className="text-sm font-semibold">{resourcesQuery.data.node}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Uptime: {formatUptime(resourcesQuery.data.uptime)}
                  </div>
                </div>
                <div className="rounded-lg border bg-card p-3">
                  <div className="text-xs text-muted-foreground mb-1">CPU Cores</div>
                  <div className="text-sm font-semibold">{resourcesQuery.data.cpu.cores}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {resourcesQuery.data.cpu.usagePercent}% utilized
                  </div>
                </div>
                <div className="rounded-lg border bg-card p-3">
                  <div className="text-xs text-muted-foreground mb-1">Memory</div>
                  <div className="text-sm font-semibold">
                    {resourcesQuery.data.memory.usedFormatted}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    of {resourcesQuery.data.memory.totalFormatted}
                  </div>
                </div>
              </div>

              {/* Resource bars */}
              <div className="space-y-3">
                <ResourceBar
                  label="CPU"
                  percent={resourcesQuery.data.cpu.usagePercent}
                  detail={`${resourcesQuery.data.cpu.cores} cores`}
                  icon={Cpu}
                />
                <ResourceBar
                  label="Memory"
                  percent={resourcesQuery.data.memory.usagePercent}
                  detail={`${resourcesQuery.data.memory.usedFormatted} / ${resourcesQuery.data.memory.totalFormatted}`}
                  icon={MemoryStick}
                />
                <ResourceBar
                  label="Disk"
                  percent={resourcesQuery.data.disk.usagePercent}
                  detail={`${resourcesQuery.data.disk.usedFormatted} / ${resourcesQuery.data.disk.totalFormatted}`}
                  icon={HardDrive}
                />
              </div>

              {/* Auto-refresh indicator */}
              <p className="text-[10px] text-muted-foreground text-right">
                Auto-refreshes every 15s
              </p>
            </div>
          )}
        </div>
      )}

      {/* Containers tab */}
      {activeTab === "containers" && (
        <div>
          {containersQuery.isLoading && (
            <div className="flex items-center gap-2 py-8 justify-center text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading containers...
            </div>
          )}
          {containersQuery.error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3">
              <AlertCircle className="h-4 w-4 mt-0.5 text-red-400 flex-shrink-0" />
              <p className="text-sm text-red-300">{containersQuery.error.message}</p>
            </div>
          )}
          {containersQuery.data && (
            <div className="space-y-3">
              {/* Summary */}
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span>{containersQuery.data.total} container(s)</span>
                <span className="opacity-30">|</span>
                <span className="text-emerald-400">
                  {containersQuery.data.guildServerManaged} managed by GuildServer
                </span>
              </div>

              {/* Container list */}
              {containersQuery.data.containers.length === 0 ? (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  No LXC containers on this node
                </div>
              ) : (
                <div className="space-y-2">
                  {containersQuery.data.containers.map((c: any) => (
                    <div
                      key={c.vmid}
                      className={`flex items-center justify-between rounded-lg border p-3 ${
                        c.isGuildServer ? "border-emerald-500/20 bg-emerald-500/5" : "bg-card"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`h-2 w-2 rounded-full ${
                            c.status === "running" ? "bg-emerald-500" : "bg-gray-500"
                          }`}
                        />
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">{c.name}</span>
                            <span className="font-mono text-xs text-muted-foreground">
                              CT {c.vmid}
                            </span>
                            {c.isGuildServer && (
                              <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">
                                GS
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                            <span>{c.status}</span>
                            {c.status === "running" && (
                              <>
                                <span>
                                  RAM: {c.memory.usedFormatted} / {c.memory.totalFormatted}
                                </span>
                                <span>
                                  Disk: {c.disk.usedFormatted} / {c.disk.totalFormatted}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {c.status === "running" && (
                          <div className="flex h-6 items-center rounded bg-secondary px-2 text-[10px] font-mono">
                            CPU {Math.round(c.cpu * 100)}%
                          </div>
                        )}
                        <div className="flex h-6 items-center rounded bg-secondary px-2 text-[10px] font-mono">
                          RAM {c.memory.usagePercent}%
                        </div>
                        {/* Container action buttons */}
                        {c.status === "running" ? (
                          <button
                            onClick={() => { setActionVmid(c.vmid); stopMutation.mutate({ id: providerId, vmid: c.vmid }); }}
                            disabled={isContainerBusy(c.vmid)}
                            className="ml-1 flex h-6 items-center gap-1 rounded bg-yellow-500/10 px-2 text-[10px] font-medium text-yellow-400 hover:bg-yellow-500/20 transition-colors disabled:opacity-50"
                            title="Stop container"
                          >
                            {actionVmid === c.vmid && stopMutation.isPending ? (
                              <Loader2 className="h-2.5 w-2.5 animate-spin" />
                            ) : (
                              <Square className="h-2.5 w-2.5" />
                            )}
                            Stop
                          </button>
                        ) : (
                          <button
                            onClick={() => { setActionVmid(c.vmid); startMutation.mutate({ id: providerId, vmid: c.vmid }); }}
                            disabled={isContainerBusy(c.vmid)}
                            className="ml-1 flex h-6 items-center gap-1 rounded bg-emerald-500/10 px-2 text-[10px] font-medium text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
                            title="Start container"
                          >
                            {actionVmid === c.vmid && startMutation.isPending ? (
                              <Loader2 className="h-2.5 w-2.5 animate-spin" />
                            ) : (
                              <Play className="h-2.5 w-2.5" />
                            )}
                            Start
                          </button>
                        )}
                        <button
                          onClick={() => {
                            if (window.confirm(`Are you sure you want to destroy CT ${c.vmid} (${c.name})? This cannot be undone.`)) {
                              setActionVmid(c.vmid);
                              destroyMutation.mutate({ id: providerId, vmid: c.vmid });
                            }
                          }}
                          disabled={isContainerBusy(c.vmid)}
                          className="flex h-6 items-center gap-1 rounded bg-red-500/10 px-2 text-[10px] font-medium text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50"
                          title="Destroy container"
                        >
                          {actionVmid === c.vmid && destroyMutation.isPending ? (
                            <Loader2 className="h-2.5 w-2.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-2.5 w-2.5" />
                          )}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <button
                onClick={() => containersQuery.refetch()}
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                <RefreshCw
                  className={`h-3 w-3 ${containersQuery.isFetching ? "animate-spin" : ""}`}
                />
                Refresh
              </button>
            </div>
          )}
        </div>
      )}

      {/* Storage tab */}
      {activeTab === "storage" && (
        <div>
          {storageQuery.isLoading && (
            <div className="flex items-center gap-2 py-8 justify-center text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading storage pools...
            </div>
          )}
          {storageQuery.error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3">
              <AlertCircle className="h-4 w-4 mt-0.5 text-red-400 flex-shrink-0" />
              <p className="text-sm text-red-300">{storageQuery.error.message}</p>
            </div>
          )}
          {storageQuery.data && (
            <div className="space-y-3">
              {storageQuery.data.storages.map((s: any) => (
                <div key={s.storage} className="rounded-lg border bg-card p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <HardDrive className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">{s.storage}</span>
                      <span className="text-xs text-muted-foreground">({s.type})</span>
                      {s.supportsRootfs && (
                        <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-400">
                          rootfs
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {s.availableFormatted} free
                    </span>
                  </div>
                  <ResourceBar
                    label="Usage"
                    percent={s.usagePercent}
                    detail={`${s.usedFormatted} / ${s.totalFormatted}`}
                    icon={HardDrive}
                  />
                  <div className="mt-2 text-xs text-muted-foreground">
                    Content: {s.content}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Provider Card (enhanced for Proxmox)
// ---------------------------------------------------------------------------

function ProviderCard({
  provider,
  liveData,
  onTest,
  onDelete,
  onToggleMaintenance,
  isTestPending,
  isDeletePending,
  isMaintenancePending,
}: {
  provider: any;
  liveData?: any;
  onTest: () => void;
  onDelete: () => void;
  onToggleMaintenance: () => void;
  isTestPending: boolean;
  isDeletePending: boolean;
  isMaintenancePending: boolean;
}) {
  const [showDetail, setShowDetail] = useState(false);
  const isProxmox = provider.type === "proxmox";
  const isInMaintenance = provider.status === "disabled";

  return (
    <div className="rounded-xl border bg-card p-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div
            className={`flex h-10 w-10 items-center justify-center rounded-lg ${
              isProxmox ? "bg-purple-500/10" : "bg-blue-500/10"
            }`}
          >
            <ProviderIcon
              type={provider.type}
              className={`h-5 w-5 ${isProxmox ? "text-purple-400" : "text-blue-400"}`}
            />
          </div>
          <div>
            <h3 className="font-semibold">{provider.name}</h3>
            <p className="text-xs text-muted-foreground">{provider.type}</p>
          </div>
        </div>
        <StatusBadge status={provider.status || "pending"} />
      </div>

      {/* Live resource bars for Proxmox (from overview data) */}
      {isProxmox && liveData?.live?.reachable && (
        <div className="mt-4 space-y-2">
          <ResourceBar
            label="CPU"
            percent={liveData.live.cpu.usagePercent}
            detail={`${liveData.live.cpu.cores} cores`}
            icon={Cpu}
          />
          <ResourceBar
            label="Memory"
            percent={liveData.live.memory.usagePercent}
            detail={`${liveData.live.memory.usedFormatted} / ${liveData.live.memory.totalFormatted}`}
            icon={MemoryStick}
          />
          <ResourceBar
            label="Disk"
            percent={liveData.live.disk.usagePercent}
            detail={`${liveData.live.disk.usedFormatted} / ${liveData.live.disk.totalFormatted}`}
            icon={HardDrive}
          />
          {liveData.live.uptime && (
            <div className="text-xs text-muted-foreground">
              Uptime: {formatUptime(liveData.live.uptime)}
            </div>
          )}
        </div>
      )}

      {/* Unreachable warning */}
      {isProxmox && liveData && !liveData.live?.reachable && (
        <div className="mt-4 flex items-center gap-2 rounded-lg bg-red-500/10 border border-red-500/20 p-2 text-xs text-red-400">
          <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
          Node unreachable — check connection
        </div>
      )}

      {/* Info line */}
      <div className="mt-4 flex items-center gap-4 text-xs text-muted-foreground">
        {provider.region && <span>{provider.region}</span>}
        {provider.isDefault && (
          <>
            <span className="opacity-30">|</span>
            <span className="text-emerald-400">Default</span>
          </>
        )}
        {provider.healthMessage && (
          <>
            <span className="opacity-30">|</span>
            <span className="truncate max-w-[180px]">{provider.healthMessage}</span>
          </>
        )}
      </div>

      {/* Actions */}
      <div className="mt-4 flex items-center gap-2 border-t pt-3 flex-wrap">
        <button
          onClick={onTest}
          disabled={isTestPending}
          className="inline-flex items-center gap-1.5 rounded-md bg-secondary px-2.5 py-1.5 text-xs hover:bg-secondary/80 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`h-3 w-3 ${isTestPending ? "animate-spin" : ""}`} />
          Test
        </button>

        {isProxmox && (
          <>
            <button
              onClick={onToggleMaintenance}
              disabled={isMaintenancePending}
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-colors disabled:opacity-50 ${
                isInMaintenance
                  ? "bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
                  : "bg-yellow-500/10 text-yellow-600 hover:bg-yellow-500/20"
              }`}
            >
              {isMaintenancePending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : isInMaintenance ? (
                <Play className="h-3 w-3" />
              ) : (
                <Wrench className="h-3 w-3" />
              )}
              {isInMaintenance ? "Enable" : "Maintenance"}
            </button>

            <button
              onClick={() => setShowDetail(!showDetail)}
              className="inline-flex items-center gap-1.5 rounded-md bg-secondary px-2.5 py-1.5 text-xs hover:bg-secondary/80 transition-colors"
            >
              <Eye className="h-3 w-3" />
              Details
              {showDetail ? (
                <ChevronUp className="h-3 w-3" />
              ) : (
                <ChevronDown className="h-3 w-3" />
              )}
            </button>
          </>
        )}

        <button
          onClick={onDelete}
          disabled={isDeletePending}
          className="inline-flex items-center gap-1.5 rounded-md bg-secondary px-2.5 py-1.5 text-xs text-red-400 hover:bg-red-900/30 transition-colors disabled:opacity-50 ml-auto"
        >
          <Trash2 className="h-3 w-3" />
          Delete
        </button>
      </div>

      {/* Expandable detail panel for Proxmox */}
      {isProxmox && showDetail && <ProxmoxDetailPanel providerId={provider.id} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function InfrastructurePage() {
  const [showAddWizard, setShowAddWizard] = useState(false);

  const providersQuery = trpc.provider.list.useQuery();
  const availableQuery = trpc.provider.listAvailable.useQuery();
  const overviewQuery = trpc.infrastructure.overview.useQuery(undefined, {
    refetchInterval: 30000, // refresh overview every 30s
  });

  const testMutation = trpc.provider.testConnection.useMutation({
    onSuccess: () => {
      providersQuery.refetch();
      overviewQuery.refetch();
    },
  });

  const deleteMutation = trpc.provider.delete.useMutation({
    onSuccess: () => {
      providersQuery.refetch();
      overviewQuery.refetch();
    },
  });

  const maintenanceMutation = trpc.infrastructure.setMaintenance.useMutation({
    onSuccess: () => {
      providersQuery.refetch();
      overviewQuery.refetch();
    },
  });

  const providers = providersQuery.data || [];
  const overviewData = overviewQuery.data || [];

  // Map overview data by provider ID for quick lookup
  const liveDataMap: Record<string, any> = {};
  for (const item of overviewData) {
    if (item) liveDataMap[item.id] = item;
  }

  // Count Proxmox providers and their health
  const proxmoxProviders = providers.filter((p: any) => p.type === "proxmox");
  const healthyCount = overviewData.filter((d: any) => d?.live?.reachable).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Infrastructure Providers</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage compute providers for deploying applications. Add Proxmox nodes,
            cloud providers, or remote Docker hosts.
          </p>
        </div>
        <button
          onClick={() => setShowAddWizard(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Add Provider
        </button>
      </div>

      {/* Overview summary bar (when Proxmox providers exist) */}
      {proxmoxProviders.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-4">
          <div className="rounded-xl border bg-card p-4">
            <div className="text-xs text-muted-foreground">Total Providers</div>
            <div className="mt-1 text-2xl font-bold">{providers.length + 1}</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              including Local Docker
            </div>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <div className="text-xs text-muted-foreground">Proxmox Nodes</div>
            <div className="mt-1 text-2xl font-bold">{proxmoxProviders.length}</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {healthyCount} online
            </div>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <div className="text-xs text-muted-foreground">Avg CPU</div>
            <div className="mt-1 text-2xl font-bold">
              {overviewData.length > 0
                ? Math.round(
                    overviewData
                      .filter((d: any) => d?.live?.reachable)
                      .reduce((sum: number, d: any) => sum + (d.live.cpu?.usagePercent || 0), 0) /
                      Math.max(healthyCount, 1)
                  )
                : 0}
              %
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">across nodes</div>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <div className="text-xs text-muted-foreground">Avg Memory</div>
            <div className="mt-1 text-2xl font-bold">
              {overviewData.length > 0
                ? Math.round(
                    overviewData
                      .filter((d: any) => d?.live?.reachable)
                      .reduce(
                        (sum: number, d: any) => sum + (d.live.memory?.usagePercent || 0),
                        0
                      ) / Math.max(healthyCount, 1)
                  )
                : 0}
              %
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">across nodes</div>
          </div>
        </div>
      )}

      {/* Provider Grid */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {/* Built-in Local Docker card */}
        <div className="rounded-xl border bg-card p-5">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
                <Container className="h-5 w-5 text-blue-400" />
              </div>
              <div>
                <h3 className="font-semibold">Local Docker</h3>
                <p className="text-xs text-muted-foreground">Built-in default</p>
              </div>
            </div>
            <StatusBadge status="connected" />
          </div>
          <div className="mt-4 flex items-center gap-4 text-xs text-muted-foreground">
            <span>docker-local</span>
            <span className="opacity-30">|</span>
            <span>Default provider</span>
          </div>
        </div>

        {/* Dynamic providers from DB */}
        {providers.map((provider: any) => (
          <ProviderCard
            key={provider.id}
            provider={provider}
            liveData={liveDataMap[provider.id]}
            onTest={() => testMutation.mutate({ id: provider.id })}
            onDelete={() => {
              if (confirm("Are you sure you want to delete this provider?")) {
                deleteMutation.mutate({ id: provider.id });
              }
            }}
            onToggleMaintenance={() => {
              maintenanceMutation.mutate({
                id: provider.id,
                maintenance: provider.status !== "disabled",
              });
            }}
            isTestPending={testMutation.isPending}
            isDeletePending={deleteMutation.isPending}
            isMaintenancePending={maintenanceMutation.isPending}
          />
        ))}
      </div>

      {/* Empty state when no providers added */}
      {providers.length === 0 && (
        <div className="rounded-xl border border-dashed bg-card/50 p-12 text-center">
          <Server className="mx-auto h-12 w-12 text-muted-foreground/50" />
          <h3 className="mt-4 text-lg font-semibold">No providers configured</h3>
          <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto">
            Add a Proxmox node, cloud provider, or remote Docker host to deploy
            applications beyond your local Docker environment.
          </p>
          <button
            onClick={() => setShowAddWizard(true)}
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Add Your First Provider
          </button>
        </div>
      )}

      {/* Add Provider Wizard */}
      {showAddWizard && (
        <AddProviderWizard
          onClose={() => setShowAddWizard(false)}
          onCreated={() => {
            providersQuery.refetch();
            overviewQuery.refetch();
          }}
          availableProviders={availableQuery.data || []}
        />
      )}
    </div>
  );
}
