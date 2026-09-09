import { setupServer } from 'msw/node'
import { rest } from 'msw'

// Fixed ids reused across handlers/tests so relations (org -> project ->
// application) line up. Kept here rather than inlined so component tests
// can import and reference the same organization without duplicating
// magic strings.
export const TEST_ORG_ID = '11111111-1111-1111-1111-111111111111'
export const TEST_PROJECT_ID = '22222222-2222-2222-2222-222222222222'

// Mock API responses
const handlers = [
  rest.get('http://localhost:4000/trpc/auth.me', (req, res, ctx) => {
    return res(
      ctx.json({
        result: {
          data: {
            id: 'user-1',
            name: 'Test User',
            email: 'test@example.com',
            role: 'admin',
          },
        },
      })
    )
  }),

  rest.get('http://localhost:4000/trpc/project.list', (req, res, ctx) => {
    return res(
      ctx.json({
        result: {
          data: [
            {
              id: TEST_PROJECT_ID,
              name: 'Test Project',
              organizationId: TEST_ORG_ID,
            },
          ],
        },
      })
    )
  }),

  rest.get('http://localhost:4000/trpc/application.listByOrg', (req, res, ctx) => {
    return res(
      ctx.json({
        result: {
          data: [
            {
              id: 'app-1',
              appName: 'api-gateway',
              status: 'running',
              sourceType: 'docker',
              dockerImage: 'nginx',
              dockerTag: 'alpine',
              deploymentTarget: 'docker-local',
              domains: [],
              updatedAt: '2026-08-12T07:00:00.000Z',
            },
            {
              id: 'app-2',
              appName: 'web-dashboard',
              status: 'running',
              sourceType: 'github',
              repository: 'https://github.com/test/web-dashboard',
              deploymentTarget: 'docker-local',
              domains: [
                { domain: 'dashboard.company.com', isPrimary: true, status: 'active' },
              ],
              updatedAt: '2026-08-12T09:00:00.000Z',
            },
          ],
        },
      })
    )
  }),

  rest.get('http://localhost:4000/trpc/github.getConnectedAccounts', (req, res, ctx) => {
    return res(ctx.json({ result: { data: [] } }))
  }),

  // Mock tRPC endpoints
  rest.post('http://localhost:4000/trpc/auth.login', (req, res, ctx) => {
    return res(
      ctx.json({
        result: {
          data: {
            user: {
              id: 'user-1',
              name: 'Test User',
              email: 'test@example.com',
            },
            token: 'mock-jwt-token',
          },
        },
      })
    )
  }),

  rest.post('http://localhost:4000/trpc/auth.register', (req, res, ctx) => {
    return res(
      ctx.json({
        result: {
          data: {
            user: {
              id: 'user-1',
              name: 'Test User',
              email: 'test@example.com',
            },
            token: 'mock-jwt-token',
          },
        },
      })
    )
  }),

  rest.get('http://localhost:4000/trpc/organization.list', (req, res, ctx) => {
    return res(
      ctx.json({
        result: {
          data: [
            {
              id: TEST_ORG_ID,
              name: 'Test Organization',
              slug: 'test-org',
              memberRole: 'owner',
              memberCount: 5,
              projectCount: 3,
            },
          ],
        },
      })
    )
  }),

  rest.get('http://localhost:4000/trpc/application.list', (req, res, ctx) => {
    return res(
      ctx.json({
        result: {
          data: [
            {
              id: 'app-1',
              name: 'test-app',
              appName: 'Test Application',
              status: 'running',
              environment: 'production',
              lastDeploy: '2 hours ago',
              url: 'https://test-app.com',
            },
          ],
        },
      })
    )
  }),

  // Mock monitoring endpoints
  rest.get('http://localhost:4000/trpc/monitoring.getMetrics', (req, res, ctx) => {
    return res(
      ctx.json({
        result: {
          data: {
            cpuUsage: 45,
            memoryUsage: 67,
            diskUsage: 32,
            responseTime: 150,
          },
        },
      })
    )
  }),
]

export const server = setupServer(...handlers)