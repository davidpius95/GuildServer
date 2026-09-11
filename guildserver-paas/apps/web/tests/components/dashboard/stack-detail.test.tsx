import { screen, fireEvent, waitFor } from '@testing-library/react'
import { rest } from 'msw'
import StackDetailPage from '../../../src/app/dashboard/stacks/[id]/page'
import { renderWithProviders } from '../../helpers/render'
import { server } from '../../mocks/server'

const mockPush = jest.fn()
jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'stack-1' }),
  useRouter: () => ({ push: mockPush, replace: jest.fn(), prefetch: jest.fn(), back: jest.fn() }),
  usePathname: () => '/dashboard/stacks/stack-1',
  useSearchParams: () => new URLSearchParams(),
}))

const BASE = 'http://localhost:4000/trpc'

const containers = [
  { composeServiceName: 'db', image: 'postgres:16', status: 'running', health: 'healthy', hostPort: null, containerPort: 5432 },
  { composeServiceName: 'web', image: 'plausible/analytics:v2', status: 'running', health: null, hostPort: 30010, containerPort: 8000 },
]

const stack = {
  id: 'stack-1', name: 'analytics', description: 'Web analytics', status: 'running', templateId: 'custom',
  composeFile: 'services:\n  web:\n    image: plausible/analytics:v2\n', environment: { BASE_URL: 'https://stats.example.com' }, domains: {},
  containers, volumes: [], deployments: [{ id: 'dep-1', title: 'Deploy analytics', status: 'completed', createdAt: '2026-09-11T10:00:00.000Z', completedAt: '2026-09-11T10:02:00.000Z' }],
}

function mockStack() {
  server.use(
    rest.get(`${BASE}/service.getById`, (_req, res, ctx) => res(ctx.json({ result: { data: stack } }))),
    rest.get(`${BASE}/service.status`, (_req, res, ctx) => res(ctx.json({ result: { data: { id: 'stack-1', status: 'running', containers, missing: [] } } }))),
    rest.get(`${BASE}/service.logs`, (_req, res, ctx) => res(ctx.json({ result: { data: { logs: ['web-1 | listening on :8000'] } } }))),
  )
}

describe('StackDetailPage', () => {
  beforeEach(() => mockPush.mockReset())

  it('shows the stack and each service container', async () => {
    mockStack()
    renderWithProviders(<StackDetailPage />)

    expect(await screen.findByRole('heading', { name: 'analytics' })).toBeInTheDocument()
    expect(await screen.findByText('postgres:16')).toBeInTheDocument()
    expect(screen.getByText(/plausible\/analytics:v2 · port 30010 → 8000/)).toBeInTheDocument()
    expect(screen.getByText('healthy')).toBeInTheDocument()
  })

  it('queues a deployment', async () => {
    let body: any
    mockStack()
    server.use(
      rest.post(`${BASE}/service.deploy`, async (req, res, ctx) => {
        body = await req.json()
        return res(ctx.json({ result: { data: { id: 'dep-2' } } }))
      }),
    )
    renderWithProviders(<StackDetailPage />)

    fireEvent.click(await screen.findByRole('button', { name: /Deploy/ }))
    await waitFor(() => expect(body).toEqual({ id: 'stack-1' }))
  })

  it('keeps volumes unless deleting them is explicitly chosen', async () => {
    const bodies: any[] = []
    mockStack()
    server.use(
      rest.post(`${BASE}/service.delete`, async (req, res, ctx) => {
        bodies.push(await req.json())
        return res(ctx.json({ result: { data: { success: true } } }))
      }),
    )
    renderWithProviders(<StackDetailPage />)

    fireEvent.click(await screen.findByRole('button', { name: /^Delete$/ }))
    expect(screen.getByLabelText(/Also delete its volumes/)).not.toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Delete stack' }))

    await waitFor(() => expect(bodies).toEqual([{ id: 'stack-1', removeVolumes: false }]))
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/dashboard/stacks'))
  })

  it("opens a service's logs from its row", async () => {
    let logInput: any
    mockStack()
    server.use(
      rest.get(`${BASE}/service.logs`, (req, res, ctx) => {
        logInput = JSON.parse(req.url.searchParams.get('input') ?? '{}')
        return res(ctx.json({ result: { data: { logs: ['web-1 | listening on :8000'] } } }))
      }),
    )
    renderWithProviders(<StackDetailPage />)

    await screen.findByText('postgres:16')
    // Rows are sorted by service name: db, then web.
    fireEvent.click(screen.getAllByRole('button', { name: /^Logs$/ })[1])
    expect(await screen.findByText('web-1 | listening on :8000')).toBeInTheDocument()
    expect(logInput).toMatchObject({ id: 'stack-1', composeServiceName: 'web', tail: 300 })
  })
})
