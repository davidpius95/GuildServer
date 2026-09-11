import { screen, fireEvent, waitFor } from '@testing-library/react'
import { rest } from 'msw'
import StacksPage from '../../../src/app/dashboard/stacks/page'
import { renderWithProviders } from '../../helpers/render'
import { server, TEST_PROJECT_ID } from '../../mocks/server'

const BASE = 'http://localhost:4000/trpc'

const stacks = [
  { id: 'stack-1', name: 'analytics', description: 'Plausible with Postgres and ClickHouse', status: 'running', templateId: 'custom', containerCount: 3, runningCount: 2, updatedAt: '2026-09-11T10:00:00.000Z' },
]

describe('StacksPage', () => {
  it('lists stacks with status and how many containers are running', async () => {
    server.use(rest.get(`${BASE}/service.list`, (_req, res, ctx) => res(ctx.json({ result: { data: stacks } }))))
    renderWithProviders(<StacksPage />)

    expect(screen.getByText('Stacks')).toBeInTheDocument()
    expect(await screen.findByText('analytics')).toBeInTheDocument()
    expect(screen.getByText('running')).toBeInTheDocument()
    expect(screen.getByText('2/3 running')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /analytics/ })).toHaveAttribute('href', '/dashboard/stacks/stack-1')
  })

  it('creates a stack from a Compose file in the chosen project', async () => {
    let body: any
    server.use(
      rest.get(`${BASE}/service.list`, (_req, res, ctx) => res(ctx.json({ result: { data: [] } }))),
      rest.post(`${BASE}/service.create`, async (req, res, ctx) => {
        body = await req.json()
        return res(ctx.json({ result: { data: { id: 'stack-2' } } }))
      }),
    )
    renderWithProviders(<StacksPage />)

    const newStack = await screen.findByRole('button', { name: /New stack/ })
    await waitFor(() => expect(newStack).not.toBeDisabled())
    fireEvent.click(newStack)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'queue' } })
    const compose = 'services:\n  redis:\n    image: redis:7\n'
    fireEvent.change(screen.getByLabelText('Compose file'), { target: { value: compose } })
    fireEvent.click(screen.getByRole('button', { name: 'Create stack' }))

    await waitFor(() => expect(body).toEqual({ name: 'queue', projectId: TEST_PROJECT_ID, composeFile: compose }))
  })

  it('shows the Compose problems the server reports', async () => {
    server.use(
      rest.get(`${BASE}/service.list`, (_req, res, ctx) => res(ctx.json({ result: { data: [] } }))),
      rest.post(`${BASE}/service.create`, (_req, res, ctx) =>
        res(
          ctx.status(400),
          ctx.json({ error: { message: 'services.web: image or build is required', code: -32600, data: { code: 'BAD_REQUEST', httpStatus: 400 } } }),
        ),
      ),
    )
    renderWithProviders(<StacksPage />)

    const newStack = await screen.findByRole('button', { name: /New stack/ })
    await waitFor(() => expect(newStack).not.toBeDisabled())
    fireEvent.click(newStack)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'broken' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create stack' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('services.web: image or build is required')
  })
})
