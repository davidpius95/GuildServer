import { screen, fireEvent, waitFor } from '@testing-library/react'
import { rest } from 'msw'
import { NotificationChannelsCard } from '../../../src/components/settings/notification-channels-card'
import { renderWithProviders } from '../../helpers/render'
import { server, TEST_ORG_ID } from '../../mocks/server'

const BASE = 'http://localhost:4000/trpc'
const EVENTS = ['deployment_success', 'deployment_failed', 'backup_failed', 'payment_failed']

const channels = [
  { id: 'c1', name: 'Deploy alerts', type: 'slack', events: ['deployment_failed'], enabled: true, target: 'hooks.slack.com', lastDeliveryAt: '2026-09-10T10:00:00.000Z', lastDeliveryOk: true, lastError: null },
  { id: 'c2', name: 'Ops hook', type: 'webhook', events: ['backup_failed'], enabled: true, target: 'hooks.example.com', lastDeliveryAt: '2026-09-10T11:00:00.000Z', lastDeliveryOk: false, lastError: 'hooks.example.com answered HTTP 500' },
]

function mockLists(list = channels) {
  server.use(
    rest.get(`${BASE}/notificationChannel.list`, (_req, res, ctx) => res(ctx.json({ result: { data: list } }))),
    rest.get(`${BASE}/notificationChannel.events`, (_req, res, ctx) => res(ctx.json({ result: { data: EVENTS } }))),
  )
}

describe('NotificationChannelsCard', () => {
  it('lists channels with where they point, their events, and delivery health', async () => {
    mockLists()
    renderWithProviders(<NotificationChannelsCard />)

    expect(await screen.findByText('Deploy alerts')).toBeInTheDocument()
    expect(screen.getByText(/hooks\.slack\.com · Deployment failed/)).toBeInTheDocument()
    expect(screen.getByText('Delivered')).toBeInTheDocument()
    expect(screen.getByText('Failing')).toBeInTheDocument()
    expect(screen.getByText('hooks.example.com answered HTTP 500')).toBeInTheDocument()
  })

  it('adds a signed webhook channel for the chosen events', async () => {
    let body: any
    mockLists([])
    server.use(
      rest.post(`${BASE}/notificationChannel.create`, async (req, res, ctx) => {
        body = await req.json()
        return res(ctx.json({ result: { data: { id: 'c3' } } }))
      }),
    )
    renderWithProviders(<NotificationChannelsCard />)

    fireEvent.click(await screen.findByRole('button', { name: /Add channel/ }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ops hook' } })
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'webhook' } })
    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://hooks.example.com/gs' } })
    fireEvent.change(screen.getByLabelText(/Signing secret/), { target: { value: 'whsec_0123456789abcdef' } })
    fireEvent.click(await screen.findByLabelText('Payment failed'))

    const submit = screen.getAllByRole('button', { name: /Add channel/ }).at(-1)!
    fireEvent.click(submit)

    await waitFor(() => expect(body).toBeDefined())
    expect(body).toEqual({
      organizationId: TEST_ORG_ID,
      name: 'Ops hook',
      events: ['deployment_failed', 'backup_failed', 'payment_failed'],
      target: { type: 'webhook', url: 'https://hooks.example.com/gs', signingSecret: 'whsec_0123456789abcdef' },
    })
  })

  it('sends a test notification for a channel', async () => {
    let tested: any
    mockLists()
    server.use(
      rest.post(`${BASE}/notificationChannel.test`, async (req, res, ctx) => {
        tested = await req.json()
        return res(ctx.json({ result: { data: { ok: true } } }))
      }),
    )
    renderWithProviders(<NotificationChannelsCard />)

    await screen.findByText('Deploy alerts')
    fireEvent.click(screen.getAllByRole('button', { name: /Test/ })[0])
    await waitFor(() => expect(tested).toEqual({ id: 'c1' }))
  })
})
