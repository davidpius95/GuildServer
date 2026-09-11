import { screen, fireEvent, waitFor } from '@testing-library/react'
import { rest } from 'msw'
import { LogDrainsCard } from '../../../src/components/settings/log-drains-card'
import { renderWithProviders } from '../../helpers/render'
import { server, TEST_ORG_ID } from '../../mocks/server'

const BASE = 'http://localhost:4000/trpc'

const drains = [
  {
    id: 'd1', name: 'To Fluent Bit', resource: { type: 'application', id: 'app-1' }, host: 'logs.example.com', headerNames: ['Authorization'],
    format: 'json', enabled: true, lastDeliveryAt: '2026-09-10T10:00:00.000Z', lastDeliveryOk: true, lastError: null, recordsSent: 12500, recordsDropped: 3,
  },
]

function mockLists(list = drains) {
  server.use(
    rest.get(`${BASE}/logDrain.list`, (_req, res, ctx) => res(ctx.json({ result: { data: list } }))),
    rest.get(`${BASE}/service.list`, (_req, res, ctx) => res(ctx.json({ result: { data: [{ id: 'svc-1', name: 'analytics stack' }] } }))),
  )
}

describe('LogDrainsCard', () => {
  it('shows each drain with its source, destination host and delivery counts', async () => {
    mockLists()
    renderWithProviders(<LogDrainsCard />)

    expect(await screen.findByText('To Fluent Bit')).toBeInTheDocument()
    expect(await screen.findByText(/api-gateway \(application\) → logs\.example\.com · headers: Authorization/)).toBeInTheDocument()
    expect(screen.getByText(/12,500 sent · 3 dropped/)).toBeInTheDocument()
  })

  it('creates a drain for a Compose stack with a header', async () => {
    let body: any
    mockLists([])
    server.use(
      rest.post(`${BASE}/logDrain.create`, async (req, res, ctx) => {
        body = await req.json()
        return res(ctx.json({ result: { data: { id: 'd2' } } }))
      }),
    )
    renderWithProviders(<LogDrainsCard />)

    fireEvent.click(await screen.findByRole('button', { name: /Add drain/ }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Stack logs' } })
    fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'service' } })
    await screen.findByRole('option', { name: 'analytics stack' })
    fireEvent.change(screen.getByLabelText('Stack'), { target: { value: 'svc-1' } })
    fireEvent.change(screen.getByLabelText('Endpoint URL'), { target: { value: 'https://logs.example.com/ingest' } })
    fireEvent.change(screen.getByLabelText('Format'), { target: { value: 'ndjson' } })
    fireEvent.click(screen.getByRole('button', { name: /Add header/ }))
    fireEvent.change(screen.getByLabelText('Header 1 name'), { target: { value: 'Authorization' } })
    fireEvent.change(screen.getByLabelText('Header 1 value'), { target: { value: 'Bearer secret' } })

    fireEvent.click(screen.getAllByRole('button', { name: /Add drain/ }).at(-1)!)

    await waitFor(() => expect(body).toBeDefined())
    expect(body).toEqual({
      organizationId: TEST_ORG_ID,
      name: 'Stack logs',
      resource: { type: 'service', id: 'svc-1' },
      target: { url: 'https://logs.example.com/ingest', headers: { Authorization: 'Bearer secret' }, format: 'ndjson' },
    })
  })
})
