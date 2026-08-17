import { Network } from "lucide-react"

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#fbfaf6] text-[#171713] dark:bg-[#080c0a] dark:text-[#f8f6ee]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(39,95,74,0.16),transparent_28%),radial-gradient(circle_at_80%_0%,rgba(238,164,83,0.16),transparent_32%),linear-gradient(90deg,rgba(23,23,19,0.052)_1px,transparent_1px),linear-gradient(rgba(23,23,19,0.052)_1px,transparent_1px)] bg-[size:auto,auto,52px_52px,52px_52px] dark:bg-[radial-gradient(circle_at_20%_20%,rgba(66,185,127,0.13),transparent_28%),radial-gradient(circle_at_80%_0%,rgba(238,164,83,0.11),transparent_32%),linear-gradient(90deg,rgba(255,255,255,0.055)_1px,transparent_1px),linear-gradient(rgba(255,255,255,0.055)_1px,transparent_1px)]" />
      <div className="w-full max-w-md space-y-8 p-8">
        <div className="relative text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#171713] text-white shadow-sm dark:bg-[#f8f6ee] dark:text-[#080c0a]">
            <Network className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-black tracking-[-0.04em]">GuildServer</h1>
          <p className="text-[#171713]/58 dark:text-white/58">Deploy apps without the infrastructure drag.</p>
        </div>
        <div className="relative">{children}</div>
      </div>
    </div>
  )
}
