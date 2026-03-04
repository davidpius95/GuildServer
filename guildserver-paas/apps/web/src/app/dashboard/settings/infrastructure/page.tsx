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
} from "lucide-react";

// Provider type icon mapping
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

// Status badge colors
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
    disabled: <XCircle className="h-3 w-3" />,
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${
        styles[status] || styles.pending
      }`}
    >
      {icons[status] || icons.pending}
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

// === Provider Config Form (renders dynamic fields from the registry schema) ===
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

// === Add Provider Wizard (multi-step) ===
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

    // If no config fields, skip straight to test
    if (!provider.configSchema || provider.configSchema.length === 0) {
      setStep("configure");
    } else {
      setStep("configure");
    }
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
            {/* Provider name */}
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

            {/* Region */}
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

            {/* Dynamic config fields from schema */}
            <div className="border-t border-gray-700 pt-4">
              <h3 className="mb-3 text-sm font-semibold text-gray-300">Connection Settings</h3>
              <ProviderConfigForm
                schema={selectedType.configSchema}
                values={configValues}
                onChange={handleConfigChange}
              />
            </div>

            {/* Error display */}
            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3">
                <AlertCircle className="h-4 w-4 mt-0.5 text-red-400 flex-shrink-0" />
                <p className="text-sm text-red-300">{error}</p>
              </div>
            )}

            {/* Actions */}
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

        {/* Cancel button at bottom of select step */}
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

// === Main Page ===
export default function InfrastructurePage() {
  const [showAddWizard, setShowAddWizard] = useState(false);

  const providersQuery = trpc.provider.list.useQuery();
  const availableQuery = trpc.provider.listAvailable.useQuery();
  const testMutation = trpc.provider.testConnection.useMutation({
    onSuccess: () => providersQuery.refetch(),
  });
  const deleteMutation = trpc.provider.delete.useMutation({
    onSuccess: () => providersQuery.refetch(),
  });

  const providers = providersQuery.data || [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Infrastructure Providers</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage compute providers for deploying applications. Add cloud providers,
            Proxmox nodes, or remote Docker hosts.
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

      {/* Provider Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
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
          <div
            key={provider.id}
            className="rounded-xl border bg-card p-5"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-500/10">
                  <ProviderIcon type={provider.type} className="h-5 w-5 text-purple-400" />
                </div>
                <div>
                  <h3 className="font-semibold">{provider.name}</h3>
                  <p className="text-xs text-muted-foreground">{provider.type}</p>
                </div>
              </div>
              <StatusBadge status={provider.status || "pending"} />
            </div>

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
            <div className="mt-4 flex items-center gap-2 border-t pt-3">
              <button
                onClick={() => testMutation.mutate({ id: provider.id })}
                disabled={testMutation.isPending}
                className="inline-flex items-center gap-1.5 rounded-md bg-secondary px-2.5 py-1.5 text-xs hover:bg-secondary/80 transition-colors disabled:opacity-50"
              >
                <RefreshCw
                  className={`h-3 w-3 ${testMutation.isPending ? "animate-spin" : ""}`}
                />
                Test
              </button>
              <button
                onClick={() => {
                  if (confirm("Are you sure you want to delete this provider?")) {
                    deleteMutation.mutate({ id: provider.id });
                  }
                }}
                disabled={deleteMutation.isPending}
                className="inline-flex items-center gap-1.5 rounded-md bg-secondary px-2.5 py-1.5 text-xs text-red-400 hover:bg-red-900/30 transition-colors disabled:opacity-50"
              >
                <Trash2 className="h-3 w-3" />
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Add Provider Wizard */}
      {showAddWizard && (
        <AddProviderWizard
          onClose={() => setShowAddWizard(false)}
          onCreated={() => providersQuery.refetch()}
          availableProviders={availableQuery.data || []}
        />
      )}
    </div>
  );
}
