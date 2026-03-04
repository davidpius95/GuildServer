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
  Settings2,
  Cloud,
  Container,
  Database,
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

export default function InfrastructurePage() {
  const [showAddDialog, setShowAddDialog] = useState(false);

  const providersQuery = trpc.provider.list.useQuery();
  const availableQuery = trpc.provider.listAvailable.useQuery();
  const testMutation = trpc.provider.testConnection.useMutation({
    onSuccess: () => providersQuery.refetch(),
  });
  const deleteMutation = trpc.provider.delete.useMutation({
    onSuccess: () => providersQuery.refetch(),
  });
  const createMutation = trpc.provider.create.useMutation({
    onSuccess: () => {
      providersQuery.refetch();
      setShowAddDialog(false);
    },
  });

  const providers = providersQuery.data || [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Infrastructure Providers</h1>
          <p className="mt-1 text-sm text-gray-400">
            Manage compute providers for deploying applications. Add cloud providers,
            Proxmox nodes, or remote Docker hosts.
          </p>
        </div>
        <button
          onClick={() => setShowAddDialog(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Add Provider
        </button>
      </div>

      {/* Provider Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {/* Built-in Local Docker card (always shown) */}
        <div className="rounded-xl border border-gray-700 bg-gray-800/50 p-5">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
                <Container className="h-5 w-5 text-blue-400" />
              </div>
              <div>
                <h3 className="font-semibold text-white">Local Docker</h3>
                <p className="text-xs text-gray-400">Built-in default</p>
              </div>
            </div>
            <StatusBadge status="connected" />
          </div>
          <div className="mt-4 flex items-center gap-4 text-xs text-gray-400">
            <span>docker-local</span>
            <span className="text-gray-600">|</span>
            <span>Default provider</span>
          </div>
        </div>

        {/* Dynamic providers from DB */}
        {providers.map((provider: any) => (
          <div
            key={provider.id}
            className="rounded-xl border border-gray-700 bg-gray-800/50 p-5"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-500/10">
                  <ProviderIcon type={provider.type} className="h-5 w-5 text-purple-400" />
                </div>
                <div>
                  <h3 className="font-semibold text-white">{provider.name}</h3>
                  <p className="text-xs text-gray-400">{provider.type}</p>
                </div>
              </div>
              <StatusBadge status={provider.status || "pending"} />
            </div>

            <div className="mt-4 flex items-center gap-4 text-xs text-gray-400">
              {provider.region && <span>{provider.region}</span>}
              {provider.isDefault && (
                <>
                  <span className="text-gray-600">|</span>
                  <span className="text-emerald-400">Default</span>
                </>
              )}
              {provider.lastHealthCheck && (
                <>
                  <span className="text-gray-600">|</span>
                  <span>
                    Last checked:{" "}
                    {new Date(provider.lastHealthCheck).toLocaleTimeString()}
                  </span>
                </>
              )}
            </div>

            {/* Actions */}
            <div className="mt-4 flex items-center gap-2 border-t border-gray-700 pt-3">
              <button
                onClick={() => testMutation.mutate({ id: provider.id })}
                disabled={testMutation.isPending}
                className="inline-flex items-center gap-1.5 rounded-md bg-gray-700 px-2.5 py-1.5 text-xs text-gray-300 hover:bg-gray-600 transition-colors disabled:opacity-50"
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
                className="inline-flex items-center gap-1.5 rounded-md bg-gray-700 px-2.5 py-1.5 text-xs text-red-400 hover:bg-red-900/30 transition-colors disabled:opacity-50"
              >
                <Trash2 className="h-3 w-3" />
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Add Provider Dialog */}
      {showAddDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-xl border border-gray-700 bg-gray-800 p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-white">Add Infrastructure Provider</h2>
              <button
                onClick={() => setShowAddDialog(false)}
                className="text-gray-400 hover:text-white"
              >
                <XCircle className="h-5 w-5" />
              </button>
            </div>

            <p className="mb-4 text-sm text-gray-400">
              Select a provider type to configure. Only implemented providers can be added.
            </p>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {(availableQuery.data || []).map((p: any) => (
                <button
                  key={p.type}
                  onClick={() => {
                    if (p.implemented) {
                      createMutation.mutate({
                        name: p.name,
                        type: p.type as any,
                        config: {},
                      });
                    }
                  }}
                  disabled={!p.implemented || createMutation.isPending}
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

            <div className="mt-6 flex justify-end">
              <button
                onClick={() => setShowAddDialog(false)}
                className="rounded-lg bg-gray-700 px-4 py-2 text-sm text-gray-300 hover:bg-gray-600 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
