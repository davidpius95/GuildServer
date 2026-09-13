import { screen, fireEvent, waitFor } from '@testing-library/react'
import { rest } from 'msw'
import { GithubConnectionCard } from '../../../src/components/settings/github-connection-card'
import { renderWithProviders } from '../../helpers/render'
import { server, TEST_ORG_ID } from '../../mocks/server'

const BASE = 'http://localhost:4000/trpc'

/** getConnectionStatus, which has no default handler in the shared server. */
function status(data: Record<string, unknown>) {
  return rest.get(`${BASE}/github.getConnectionStatus`, (_req, res, ctx) =>
    res(ctx.json({ result: { data } })),
  )
}

const connected = {
  connected: true,
  health: 'connected',
  needsReconnect: false,
  hasRepoScope: true,
  scope: 'user:email repo',
  connectedAt: '2026-09-01T10:00:00.000Z',
  appConfigured: true,
  installations: [],
}

describe('GithubConnectionCard', () => {
  it('offers to connect when GitHub has never been linked', async () => {
    server.use(status({ connected: false, health: null, needsReconnect: false, hasRepoScope: false, scope: null, connectedAt: null, appConfigured: false, installations: [] }))
    renderWithProviders(<GithubConnectionCard />)

    expect(await screen.findByRole('button', { name: /Connect GitHub/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Disconnect' })).not.toBeInTheDocument()
  })

  it('says a revoked connection needs reconnecting, rather than showing it as healthy', async () => {
    server.use(status({ ...connected, needsReconnect: true, health: 'reconnect_required' }))
    renderWithProviders(<GithubConnectionCard />)

    expect(await screen.findByText('Reconnect required')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Reconnect/ })).toBeInTheDocument()
    expect(screen.queryByText('Connected')).not.toBeInTheDocument()
  })

  it('offers repo access when the login cannot read repositories', async () => {
    server.use(status({ ...connected, hasRepoScope: false, scope: 'user:email' }))
    renderWithProviders(<GithubConnectionCard />)

    expect(await screen.findByRole('button', { name: /Grant Repo Access/ })).toBeInTheDocument()
  })

  it('invites the user to install the App, and explains why it matters', async () => {
    server.use(status(connected))
    renderWithProviders(<GithubConnectionCard />)

    expect(await screen.findByRole('button', { name: /Install on GitHub/ })).toBeInTheDocument()
    expect(screen.getByText(/keep deploys working when a teammate leaves/i)).toBeInTheDocument()
  })

  it('names the accounts the App covers once it is installed', async () => {
    server.use(status({ ...connected, installations: [{ accountLogin: 'acme-inc', repositorySelection: 'all', suspended: false }] }))
    renderWithProviders(<GithubConnectionCard />)

    expect(await screen.findByText(/App installed on acme-inc/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Manage App access/ })).toBeInTheDocument()
  })

  it('hides the install entirely where no GitHub App is configured on the server', async () => {
    server.use(status({ ...connected, appConfigured: false }))
    renderWithProviders(<GithubConnectionCard />)

    expect(await screen.findByText('Connected')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Install on GitHub/ })).not.toBeInTheDocument()
    expect(screen.queryByText(/App installed on/)).not.toBeInTheDocument()
  })

  it('starts an install for the current organization', async () => {
    let sent: any
    server.use(
      status(connected),
      rest.post(`${BASE}/github.createInstallIntent`, async (req, res, ctx) => {
        sent = await req.json()
        return res(ctx.json({ result: { data: { url: 'https://github.com/apps/guildserverauth/installations/new?state=abc' } } }))
      }),
    )
    renderWithProviders(<GithubConnectionCard />)

    fireEvent.click(await screen.findByRole('button', { name: /Install on GitHub/ }))

    await waitFor(() => expect(sent).toBeTruthy())
    expect(sent.organizationId ?? sent.json?.organizationId).toBe(TEST_ORG_ID)
  })

  it('disconnects and tells the page to refresh what it shows', async () => {
    const onChanged = jest.fn()
    server.use(
      status(connected),
      rest.post(`${BASE}/github.disconnect`, (_req, res, ctx) => res(ctx.json({ result: { data: { success: true } } }))),
    )
    renderWithProviders(<GithubConnectionCard onChanged={onChanged} />)

    fireEvent.click(await screen.findByRole('button', { name: /Disconnect/ }))

    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })
})
