import { screen, fireEvent, waitFor } from '@testing-library/react'
import { rest } from 'msw'
import { ApiTokensCard } from '../../../src/components/settings/api-tokens-card'
import { renderWithProviders } from '../../helpers/render'
import { server, TEST_ORG_ID } from '../../mocks/server'

const BASE = 'http://localhost:4000/trpc'
const NEW_TOKEN = 'gs_pat_' + 'x'.repeat(43)

const tokens = [
  { id: 't1', name: 'ci deploys', tokenPrefix: 'gs_pat_abcd', scopes: ['read', 'deploy'], expiresAt: null, lastUsedAt: null, revokedAt: null, createdAt: '2026-09-01T10:00:00.000Z' },
  { id: 't2', name: 'old script', tokenPrefix: 'gs_pat_wxyz', scopes: ['read'], expiresAt: null, lastUsedAt: null, revokedAt: '2026-09-05T10:00:00.000Z', createdAt: '2026-08-01T10:00:00.000Z' },
]

describe('ApiTokensCard', () => {
  it('lists tokens with their scopes and status, offering revoke only for live tokens', async () => {
    server.use(rest.get(`${BASE}/apiToken.list`, (_req, res, ctx) => res(ctx.json({ result: { data: tokens } }))))
    renderWithProviders(<ApiTokensCard />)

    expect(await screen.findByText('ci deploys')).toBeInTheDocument()
    expect(screen.getByText('gs_pat_abcd…')).toBeInTheDocument()
    expect(screen.getByText('deploy')).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.getByText('Revoked')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Revoke' })).toHaveLength(1)
  })

  it('creates a token with the chosen scopes and shows it exactly once', async () => {
    let body: any
    server.use(
      rest.get(`${BASE}/apiToken.list`, (_req, res, ctx) => res(ctx.json({ result: { data: [] } }))),
      rest.post(`${BASE}/apiToken.create`, async (req, res, ctx) => {
        body = await req.json()
        return res(ctx.json({ result: { data: { token: NEW_TOKEN, id: 't3', name: 'deploy bot', tokenPrefix: 'gs_pat_xxxx', scopes: ['read', 'deploy'] } } }))
      }),
    )
    renderWithProviders(<ApiTokensCard />)

    const newToken = await screen.findByRole('button', { name: /New token/ })
    // Enabled once the organization has loaded.
    await waitFor(() => expect(newToken).not.toBeDisabled())
    fireEvent.click(newToken)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'deploy bot' } })
    fireEvent.click(screen.getByLabelText(/^Deploy/))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create token' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: 'Create token' }))

    expect(await screen.findByDisplayValue(NEW_TOKEN)).toBeInTheDocument()
    expect(screen.getByText(/won.t be shown again/)).toBeInTheDocument()
    expect(body).toMatchObject({ organizationId: TEST_ORG_ID, name: 'deploy bot', scopes: ['read', 'deploy'] })
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now())

    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(screen.queryByDisplayValue(NEW_TOKEN)).not.toBeInTheDocument())
  })
})
