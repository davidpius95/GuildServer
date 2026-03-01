export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-muted/50">
      <div className="w-full max-w-md space-y-8 p-8">
        <div className="text-center">
          <div className="mx-auto h-12 w-12 rounded-xl bg-primary flex items-center justify-center mb-4">
            <span className="text-primary-foreground font-bold text-lg">G</span>
          </div>
          <h1 className="text-2xl font-bold">GuildServer</h1>
          <p className="text-muted-foreground">Enterprise Platform as a Service</p>
        </div>
        {children}
      </div>
    </div>
  )
}