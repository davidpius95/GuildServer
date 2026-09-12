import { TEMPLATES } from '@/app/dashboard/templates/templates-data'

describe('Template Data Integrity', () => {
  it('contains valid, unique template definitions', () => {
    expect(TEMPLATES.length).toBeGreaterThan(0)

    const ids = new Set<string>()
    for (const template of TEMPLATES) {
      // Must have unique ID
      expect(ids.has(template.id)).toBe(false)
      ids.add(template.id)

      // Must have basic metadata
      expect(template.id).toBeTruthy()
      expect(template.name).toBeTruthy()
      expect(template.description).toBeTruthy()
      expect(template.category).toBeTruthy()
      expect(['docker', 'git']).toContain(template.sourceKind)

      // Container port must be a valid network port
      expect(template.containerPort).toBeGreaterThan(0)
      expect(template.containerPort).toBeLessThanOrEqual(65535)
      expect(Number.isInteger(template.containerPort)).toBe(true)
    }
  })

  it('validates all Docker templates have required fields and image tags', () => {
    const dockerTemplates = TEMPLATES.filter((t) => t.sourceKind === 'docker')
    expect(dockerTemplates.length).toBeGreaterThan(0)

    for (const template of dockerTemplates) {
      expect(template.dockerImage).toBeTruthy()
      expect(template.dockerImage).toMatch(/^[a-zA-Z0-9_.\-\/]+:[a-zA-Z0-9_.\-]+$/)
    }
  })

  it('validates all Git templates have required repository and build configuration', () => {
    const gitTemplates = TEMPLATES.filter((t) => t.sourceKind === 'git')
    expect(gitTemplates.length).toBeGreaterThan(0)

    for (const template of gitTemplates) {
      expect(template.repository).toBeTruthy()
      expect(template.repository).toMatch(/^https:\/\/[a-zA-Z0-9_.\-\/]+$/)
      expect(template.branch).toBeTruthy()
      expect(['nixpacks', 'dockerfile', 'static', 'buildpack']).toContain(template.buildType)
    }
  })

  it('verifies AI Agent templates have correct ports and binding variables', () => {
    const aiTemplates = TEMPLATES.filter((t) => t.category === 'AI Agents')
    expect(aiTemplates.length).toBeGreaterThan(0)

    for (const template of aiTemplates) {
      // Must specify container port
      expect(template.containerPort).toBeDefined()

      // Hermes Agent must listen on 9119 with dashboard env vars
      if (template.id.includes('hermes')) {
        expect(template.containerPort).toBe(9119)
        expect(template.envVars?.HERMES_DASHBOARD).toBe('1')
        expect(template.envVars?.HERMES_DASHBOARD_HOST).toBe('0.0.0.0')
        expect(template.envVars?.HERMES_DASHBOARD_PORT).toBe('9119')
        expect(template.envVars?.HERMES_DASHBOARD_BASIC_AUTH_USERNAME).toBeTruthy()
        expect(template.envVars?.HERMES_DASHBOARD_BASIC_AUTH_PASSWORD).toBeTruthy()
      }

      // Langflow must bind to 0.0.0.0 on 7860
      if (template.id === 'langflow') {
        expect(template.containerPort).toBe(7860)
        expect(template.envVars?.LANGFLOW_HOST).toBe('0.0.0.0')
      }

      // LiteLLM must have master key and port
      if (template.id === 'litellm') {
        expect(template.containerPort).toBe(4000)
        expect(template.envVars?.LITELLM_MASTER_KEY).toBeTruthy()
      }

      // LibreChat must bind to 0.0.0.0 on 3080
      if (template.id === 'librechat') {
        expect(template.containerPort).toBe(3080)
        expect(template.envVars?.HOST).toBe('0.0.0.0')
      }

      // n8n must bind to 0.0.0.0 on 5678
      if (template.id === 'n8n-ai') {
        expect(template.containerPort).toBe(5678)
        expect(template.envVars?.N8N_HOST).toBe('0.0.0.0')
      }

      // Kotaemon must bind Gradio to 0.0.0.0 on 7860
      if (template.id === 'kotaemon') {
        expect(template.containerPort).toBe(7860)
        expect(template.envVars?.GRADIO_SERVER_NAME).toBe('0.0.0.0')
      }
    }
  })
})
