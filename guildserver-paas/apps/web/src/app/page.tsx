import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ArrowRight, Zap, Shield, Globe, Database, Workflow, BarChart3 } from "lucide-react"
import Link from "next/link"

export default function HomePage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted/50">
      {/* Header */}
      <header className="page-header sticky top-0 z-50">
        <div className="main-container flex h-16 items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-sm">G</span>
            </div>
            <span className="text-xl font-bold">GuildServer</span>
          </div>
          <nav className="flex items-center space-x-6">
            <Link href="/auth/login" className="text-muted-foreground hover:text-foreground">
              Sign In
            </Link>
            <Button asChild>
              <Link href="/auth/register">Get Started</Link>
            </Button>
          </nav>
        </div>
      </header>

      {/* Hero Section */}
      <section className="py-20 px-4">
        <div className="main-container text-center">
          <Badge variant="secondary" className="mb-4">
            Enterprise Platform as a Service
          </Badge>
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-6">
            Deploy with
            <span className="text-primary"> Enterprise</span>
            <br />
            Confidence
          </h1>
          <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
            GuildServer provides enterprise-grade platform services with advanced security,
            compliance, and scalability features for modern applications.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button size="lg" asChild>
              <Link href="/auth/register">
                Start Free Trial
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link href="#features">
                Learn More
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-20 px-4">
        <div className="main-container">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold mb-4">Enterprise Features</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Built for enterprises that need security, compliance, and scale.
            </p>
          </div>
          
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            <Card>
              <CardHeader>
                <Zap className="h-8 w-8 text-primary mb-2" />
                <CardTitle>Lightning Fast Deployments</CardTitle>
                <CardDescription>
                  Deploy applications in seconds with our optimized container orchestration
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li>• Zero-downtime deployments</li>
                  <li>• Auto-scaling capabilities</li>
                  <li>• Global CDN integration</li>
                </ul>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <Shield className="h-8 w-8 text-primary mb-2" />
                <CardTitle>Enterprise Security</CardTitle>
                <CardDescription>
                  Bank-grade security with compliance frameworks and audit trails
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li>• SOC2, HIPAA, PCI compliance</li>
                  <li>• End-to-end encryption</li>
                  <li>• Role-based access control</li>
                </ul>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <Globe className="h-8 w-8 text-primary mb-2" />
                <CardTitle>Multi-Cloud Support</CardTitle>
                <CardDescription>
                  Deploy across multiple cloud providers with unified management
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li>• AWS, GCP, Azure support</li>
                  <li>• Kubernetes orchestration</li>
                  <li>• Hybrid cloud deployment</li>
                </ul>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <Database className="h-8 w-8 text-primary mb-2" />
                <CardTitle>Managed Databases</CardTitle>
                <CardDescription>
                  Enterprise database solutions with automated backups and scaling
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li>• PostgreSQL, MySQL, Redis</li>
                  <li>• Automated backups</li>
                  <li>• High availability clusters</li>
                </ul>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <Workflow className="h-8 w-8 text-primary mb-2" />
                <CardTitle>Advanced Workflows</CardTitle>
                <CardDescription>
                  Visual workflow designer with approval gates and automation
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li>• Drag-and-drop designer</li>
                  <li>• Approval workflows</li>
                  <li>• Integration pipelines</li>
                </ul>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <BarChart3 className="h-8 w-8 text-primary mb-2" />
                <CardTitle>Real-time Monitoring</CardTitle>
                <CardDescription>
                  Comprehensive observability with metrics, logs, and alerts
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li>• Application performance monitoring</li>
                  <li>• Custom dashboards</li>
                  <li>• Intelligent alerting</li>
                </ul>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 px-4 bg-muted/50">
        <div className="main-container text-center">
          <h2 className="text-3xl font-bold mb-4">Ready to Get Started?</h2>
          <p className="text-muted-foreground mb-8 max-w-2xl mx-auto">
            Join thousands of enterprises that trust GuildServer for their mission-critical applications.
          </p>
          <Button size="lg" asChild>
            <Link href="/auth/register">
              Start Your Free Trial
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t py-12 px-4">
        <div className="main-container">
          <div className="flex flex-col md:flex-row justify-between items-center">
            <div className="flex items-center space-x-2 mb-4 md:mb-0">
              <div className="h-6 w-6 rounded bg-primary flex items-center justify-center">
                <span className="text-primary-foreground font-bold text-xs">G</span>
              </div>
              <span className="font-semibold">GuildServer</span>
            </div>
            <p className="text-sm text-muted-foreground">
              © 2024 GuildServer. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  )
}