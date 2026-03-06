"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { trpc } from "@/components/trpc-provider"
import { toast } from "sonner"
import {
  Building2,
  GitBranch,
  Rocket,
  Container,
  ArrowRight,
  ArrowLeft,
  CheckCircle,
  Loader2
} from "lucide-react"

export default function OnboardingPage() {
  const router = useRouter()
  const [step, setStep] = useState(1)

  // Step 1: Organization
  const [orgName, setOrgName] = useState("")
  const [orgSlug, setOrgSlug] = useState("")

  // Step 2: First app
  const [appName, setAppName] = useState("")
  const [sourceType, setSourceType] = useState<"docker" | "git">("docker")
  const [dockerImage, setDockerImage] = useState("nginx")
  const [dockerTag, setDockerTag] = useState("alpine")
  const [repository, setRepository] = useState("")

  const [orgId, setOrgId] = useState("")
  const [projectId, setProjectId] = useState("")

  const utils = trpc.useUtils()

  const createOrg = trpc.organization.create.useMutation({
    onSuccess: (data) => {
      setOrgId(data.id)
      toast.success("Organization created!")
    },
    onError: (err) => toast.error(err.message),
  })

  const createProject = trpc.project.create.useMutation({
    onSuccess: (data) => {
      setProjectId(data.id)
    },
    onError: (err) => toast.error(err.message),
  })

  const createApp = trpc.application.create.useMutation({
    onError: (err) => toast.error(err.message),
  })

  const deployApp = trpc.application.deploy.useMutation({
    onError: (err) => toast.error(err.message),
  })

  const handleCreateOrg = async () => {
    if (!orgName.trim()) {
      toast.error("Organization name is required")
      return
    }
    const slug = orgSlug.trim() || orgName.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "")

    try {
      const org = await createOrg.mutateAsync({ name: orgName.trim(), slug, description: "" })
      const project = await createProject.mutateAsync({
        name: "Default Project",
        organizationId: org.id,
      })
      setOrgId(org.id)
      setProjectId(project.id)
      setStep(2)
    } catch (e) {
      // errors handled by mutation callbacks
    }
  }

  const handleDeployFirst = async () => {
    if (!appName.trim()) {
      toast.error("Application name is required")
      return
    }

    try {
      const appData: any = {
        name: appName.trim(),
        projectId,
        buildType: "dockerfile",
      }

      if (sourceType === "docker") {
        appData.sourceType = "docker"
        appData.dockerImage = dockerImage
        appData.dockerTag = dockerTag
      } else {
        appData.sourceType = "github"
        appData.repository = repository
        appData.branch = "main"
      }

      const app = await createApp.mutateAsync(appData)
      await deployApp.mutateAsync({ id: app.id })
      utils.organization.list.invalidate()
      utils.application.list.invalidate()
      toast.success("Deploying your first app!")
      router.push(`/dashboard/applications/${app.id}`)
    } catch (e) {
      // errors handled by mutation callbacks
    }
  }

  const handleSkip = () => {
    utils.organization.list.invalidate()
    router.push("/dashboard")
  }

  return (
    <div className="max-w-2xl mx-auto py-12">
      {/* Progress */}
      <div className="flex items-center justify-center gap-4 mb-8">
        <div className={`flex items-center gap-2 ${step >= 1 ? "text-primary" : "text-muted-foreground"}`}>
          <div className={`h-8 w-8 rounded-full flex items-center justify-center text-sm font-bold ${
            step > 1 ? "bg-primary text-primary-foreground" : step === 1 ? "bg-primary text-primary-foreground" : "bg-muted"
          }`}>
            {step > 1 ? <CheckCircle className="h-4 w-4" /> : "1"}
          </div>
          <span className="text-sm font-medium">Organization</span>
        </div>
        <div className="h-px w-12 bg-border" />
        <div className={`flex items-center gap-2 ${step >= 2 ? "text-primary" : "text-muted-foreground"}`}>
          <div className={`h-8 w-8 rounded-full flex items-center justify-center text-sm font-bold ${
            step === 2 ? "bg-primary text-primary-foreground" : "bg-muted"
          }`}>
            2
          </div>
          <span className="text-sm font-medium">Deploy</span>
        </div>
      </div>

      {/* Step 1: Create Organization */}
      {step === 1 && (
        <Card>
          <CardHeader className="text-center">
            <Building2 className="mx-auto h-12 w-12 text-primary mb-2" />
            <CardTitle className="text-2xl">Create your organization</CardTitle>
            <CardDescription>
              Organizations help you manage projects and collaborate with your team
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="orgName">Organization Name</Label>
              <Input
                id="orgName"
                value={orgName}
                onChange={(e) => {
                  setOrgName(e.target.value)
                  setOrgSlug(e.target.value.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""))
                }}
                placeholder="My Team"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="orgSlug">URL Slug</Label>
              <Input
                id="orgSlug"
                value={orgSlug}
                onChange={(e) => setOrgSlug(e.target.value)}
                placeholder="my-team"
              />
              <p className="text-xs text-muted-foreground">
                guildserver.dev/{orgSlug || "your-org"}
              </p>
            </div>

            <Button
              className="w-full"
              size="lg"
              onClick={handleCreateOrg}
              disabled={createOrg.isLoading || createProject.isLoading}
            >
              {(createOrg.isLoading || createProject.isLoading) ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <ArrowRight className="mr-2 h-4 w-4" />
              )}
              Continue
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Step 2: Deploy First App */}
      {step === 2 && (
        <Card>
          <CardHeader className="text-center">
            <Rocket className="mx-auto h-12 w-12 text-primary mb-2" />
            <CardTitle className="text-2xl">Deploy your first app</CardTitle>
            <CardDescription>
              Choose a Docker image or connect a Git repository
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="appName">Application Name</Label>
              <Input
                id="appName"
                value={appName}
                onChange={(e) => setAppName(e.target.value)}
                placeholder="my-first-app"
                autoFocus
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Button
                variant={sourceType === "docker" ? "default" : "outline"}
                className="h-auto flex-col gap-2 p-4"
                onClick={() => setSourceType("docker")}
              >
                <Container className="h-6 w-6" />
                <span>Docker Image</span>
              </Button>
              <Button
                variant={sourceType === "git" ? "default" : "outline"}
                className="h-auto flex-col gap-2 p-4"
                onClick={() => setSourceType("git")}
              >
                <GitBranch className="h-6 w-6" />
                <span>Git Repository</span>
              </Button>
            </div>

            {sourceType === "docker" && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Image</Label>
                  <Input value={dockerImage} onChange={(e) => setDockerImage(e.target.value)} placeholder="nginx" />
                </div>
                <div className="space-y-2">
                  <Label>Tag</Label>
                  <Input value={dockerTag} onChange={(e) => setDockerTag(e.target.value)} placeholder="alpine" />
                </div>
              </div>
            )}

            {sourceType === "git" && (
              <div className="space-y-2">
                <Label>Repository URL</Label>
                <Input value={repository} onChange={(e) => setRepository(e.target.value)} placeholder="https://github.com/user/repo" />
              </div>
            )}

            <div className="flex gap-3">
              <Button variant="outline" onClick={handleSkip}>
                Skip for now
              </Button>
              <Button
                className="flex-1"
                size="lg"
                onClick={handleDeployFirst}
                disabled={createApp.isLoading || deployApp.isLoading}
              >
                {(createApp.isLoading || deployApp.isLoading) ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Rocket className="mr-2 h-4 w-4" />
                )}
                Deploy
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
