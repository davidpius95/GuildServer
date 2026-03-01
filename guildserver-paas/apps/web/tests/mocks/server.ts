import { setupServer } from 'msw/node'
import { rest } from 'msw'

// Mock API responses
const handlers = [
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
              id: 'org-1',
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