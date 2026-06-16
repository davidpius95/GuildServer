import re

with open("apps/web/src/app/dashboard/applications/page.tsx", "r") as f:
    content = f.read()

# 1. Add Icons
icons_to_add = """function GitLabIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M23.955 8.468a.952.952 0 0 0-.256-.838l-4.706-4.814-1.959-6.024A.944.944 0 0 0 16.14.004a.944.944 0 0 0-.853.64l-1.933 5.952H10.64L8.71.643a.944.944 0 0 0-.853-.64A.944.944 0 0 0 6.963.792L5.004 6.816.298 11.63a.952.952 0 0 0-.256.838.948.948 0 0 0 .524.717l11.434 8.577 11.431-8.577a.948.948 0 0 0 .524-.717z"/>
    </svg>
  )
}

function BitbucketIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M.76 1.139a.76.76 0 0 1 .737-.584h21.006a.76.76 0 0 1 .737.584L20.89 16.634a1.861 1.861 0 0 1-1.789 1.409H4.898A1.861 1.861 0 0 1 3.11 16.634L.76 1.139zm13.112 9.531L15.344 6.64H8.656l1.472 4.03h3.744z"/>
    </svg>
  )
}
"""
content = re.sub(r'(function GitHubIcon\(\{.*?\n\s*\)\n})', r'\1\n\n' + icons_to_add, content, flags=re.DOTALL)

# 2. Add state for selected provider
state_to_add = "  const [selectedGitProvider, setSelectedGitProvider] = useState<\"github\" | \"gitlab\" | \"bitbucket\">(\"github\")\n"
content = content.replace('const [showBranchDropdown, setShowBranchDropdown] = useState(false)', 'const [showBranchDropdown, setShowBranchDropdown] = useState(false)\n' + state_to_add)

# 3. Replace GitHub integration queries
queries_old = """  // GitHub integration queries
  const githubStatusQuery = trpc.github.getConnectionStatus.useQuery(undefined, { retry: false })
  const githubConnectedWithScope = githubStatusQuery.data?.connected === true && githubStatusQuery.data?.hasRepoScope === true
  const githubReposQuery = trpc.github.listRepos.useQuery(undefined, {
    enabled: githubConnectedWithScope && createMode === "git" && showCreateModal,
    retry: false,
  })
  const githubBranchesQuery = trpc.github.listBranches.useQuery(
    { owner: selectedRepo?.owner ?? "", repo: selectedRepo?.name ?? "" },
    {
      enabled: !!selectedRepo && !!selectedRepo.owner && !!selectedRepo.name,
      retry: false,
    }
  )

  const githubConnected = githubConnectedWithScope"""

queries_new = """  // Git Provider integration queries
  const connectedAccountsQuery = trpc.github.getConnectedAccounts.useQuery(undefined, { retry: false })
  const connectedProviders = useMemo(() => {
    return (connectedAccountsQuery.data ?? []).map((a: any) => a.provider)
  }, [connectedAccountsQuery.data])
  
  const gitProviderConnected = connectedProviders.includes(selectedGitProvider)

  const reposQuery = trpc.github.listRepos.useQuery({ provider: selectedGitProvider }, {
    enabled: gitProviderConnected && createMode === "git" && showCreateModal,
    retry: false,
  })

  const branchesQuery = trpc.github.listBranches.useQuery(
    { owner: selectedRepo?.owner ?? "", repo: selectedRepo?.name ?? "", provider: selectedGitProvider },
    {
      enabled: !!selectedRepo && !!selectedRepo.owner && !!selectedRepo.name,
      retry: false,
    }
  )"""
content = content.replace(queries_old, queries_new)

# 4. Replace GitHub UI block in createMode === "git"
ui_old = """{githubConnected ? (
                    <>
                      {/* GitHub Repo Browser */}"""

ui_new = """{/* Provider Tabs */}
                      <div className="flex space-x-2">
                        <Button 
                          type="button"
                          variant={selectedGitProvider === "github" ? "default" : "outline"} 
                          onClick={() => { setSelectedGitProvider("github"); setSelectedRepo(null) }}
                          className="flex-1"
                        >
                          <GitHubIcon className="mr-2 h-4 w-4" /> GitHub
                        </Button>
                        <Button 
                          type="button"
                          variant={selectedGitProvider === "gitlab" ? "default" : "outline"} 
                          onClick={() => { setSelectedGitProvider("gitlab"); setSelectedRepo(null) }}
                          className="flex-1"
                        >
                          <GitLabIcon className="mr-2 h-4 w-4" /> GitLab
                        </Button>
                        <Button 
                          type="button"
                          variant={selectedGitProvider === "bitbucket" ? "default" : "outline"} 
                          onClick={() => { setSelectedGitProvider("bitbucket"); setSelectedRepo(null) }}
                          className="flex-1"
                        >
                          <BitbucketIcon className="mr-2 h-4 w-4" /> Bitbucket
                        </Button>
                      </div>

                  {gitProviderConnected ? (
                    <>
                      {/* Git Repo Browser */}"""
content = content.replace(ui_old, ui_new)

# 5. Fix variable names in JSX
content = content.replace("githubReposQuery", "reposQuery")
content = content.replace("githubBranchesQuery", "branchesQuery")

# 6. Replace fallback connection UI
fallback_ui_old = """/* Manual input when GitHub not connected */
                    <div className="space-y-4">
                      {!githubStatusQuery.isLoading && (
                        <div className="flex items-center gap-3 p-3 border rounded-lg bg-muted/50">
                          <GitHubIcon className="h-5 w-5 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium">Connect GitHub for easy repo selection</p>
                            <p className="text-xs text-muted-foreground">Browse and select repos like Vercel</p>
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              window.location.href = `${API_URL}/auth/github?scope=repo&returnTo=/dashboard/applications`
                            }}
                          >
                            <Link2 className="mr-1.5 h-3.5 w-3.5" />
                            Connect
                          </Button>
                        </div>
                      )}"""

fallback_ui_new = """/* Manual input when not connected */
                    <div className="space-y-4">
                      {!connectedAccountsQuery.isLoading && (
                        <div className="flex items-center gap-3 p-3 border rounded-lg bg-muted/50">
                          {selectedGitProvider === "github" ? <GitHubIcon className="h-5 w-5 flex-shrink-0" /> : selectedGitProvider === "gitlab" ? <GitLabIcon className="h-5 w-5 flex-shrink-0" /> : <BitbucketIcon className="h-5 w-5 flex-shrink-0" />}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium capitalize">Connect {selectedGitProvider} for easy repo selection</p>
                            <p className="text-xs text-muted-foreground">Browse and select repos</p>
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              window.location.href = `${API_URL}/auth/${selectedGitProvider}?scope=repo&returnTo=/dashboard/applications`
                            }}
                          >
                            <Link2 className="mr-1.5 h-3.5 w-3.5" />
                            Connect
                          </Button>
                        </div>
                      )}"""
content = content.replace(fallback_ui_old, fallback_ui_new)

# Fix icon in selected repo
content = content.replace('<GitHubIcon className="h-4 w-4 flex-shrink-0" />', '{selectedGitProvider === "github" ? <GitHubIcon className="h-4 w-4 flex-shrink-0" /> : selectedGitProvider === "gitlab" ? <GitLabIcon className="h-4 w-4 flex-shrink-0" /> : <BitbucketIcon className="h-4 w-4 flex-shrink-0" /> }')

with open("apps/web/src/app/dashboard/applications/page.tsx", "w") as f:
    f.write(content)

