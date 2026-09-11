import { screen, fireEvent, waitFor } from '@testing-library/react'
import { rest } from 'msw'
import { ServiceCatalogue } from '../../../src/components/templates/service-catalogue'
import { renderWithProviders } from '../../helpers/render'
import { server, TEST_PROJECT_ID } from '../../mocks/server'

const BASE = 'http://localhost:4000/trpc'

const templates = [
  {
    id: 'ghost',
    name: 'Ghost',
    description: 'Publishing platform',
    category: 'cms',
    tags: ['blog'],
    documentationUrl: 'https://ghost.org/docs',
    notices: ['Set up an admin account on first visit.'],
    services: [{ name: 'ghost', image: 'ghost:5' }, { name: 'mysql', image: 'mysql:8' }],
    userVariables: [
      { key: 'ADMIN_EMAIL', required: true, defaultValue: null },
      { key: 'SITE_TITLE', required: false, defaultValue: 'My blog' },
    ],
    publicServices: ['ghost'],
  },
  {
    id: 'uptime-kuma',
    name: 'Uptime Kuma',
    description: 'Monitoring',
    category: 'monitoring',
    tags: ['status'],
    documentationUrl: null,
    notices: [],
    services: [{ name: 'uptime-kuma', image: 'louislam/uptime-kuma:1' }],
    userVariables: [],
    publicServices: ['uptime-kuma'],
  },
]

function listHandler() {
  return rest.get(`${BASE}/serviceTemplate.list`, (_req, res, ctx) =>
    res(ctx.json({ result: { data: { templates, categories: ['cms', 'monitoring'], total: 2, source: {} } } })),
  )
}

describe('ServiceCatalogue', () => {
  it('lists verified services and filters them by search', async () => {
    server.use(listHandler())
    renderWithProviders(<ServiceCatalogue />)

    expect(await screen.findByText('Ghost')).toBeInTheDocument()
    expect(screen.getByText('Uptime Kuma')).toBeInTheDocument()
    expect(screen.getByText(/2 self-hosted services/)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Search services'), { target: { value: 'monitor' } })
    expect(screen.queryByText('Ghost')).not.toBeInTheDocument()
    expect(screen.getByText('Uptime Kuma')).toBeInTheDocument()
  })

  it('requires the template settings before deploying, then deploys into the current project', async () => {
    let body: any
    server.use(
      listHandler(),
      rest.post(`${BASE}/serviceTemplate.deploy`, async (req, res, ctx) => {
        body = await req.json()
        return res(ctx.json({ result: { data: { stackId: 'stack-9', deploymentId: 'dep-1', urls: [], warnings: [] } } }))
      }),
    )
    renderWithProviders(<ServiceCatalogue />)

    const deployGhost = await screen.findByRole('button', { name: 'Deploy Ghost' })
    await waitFor(() => expect(deployGhost).toBeEnabled())
    fireEvent.click(deployGhost)

    expect(screen.getByText('Set up an admin account on first visit.')).toBeInTheDocument()
    const submit = screen.getByRole('button', { name: 'Deploy stack' })
    expect(submit).toBeDisabled()

    fireEvent.change(screen.getByLabelText(/ADMIN_EMAIL/), { target: { value: 'owner@example.com' } })
    fireEvent.change(screen.getByLabelText('Stack name'), { target: { value: 'my blog' } })
    expect(submit).toBeEnabled()
    fireEvent.click(submit)

    await waitFor(() =>
      expect(body).toEqual({
        templateId: 'ghost',
        projectId: TEST_PROJECT_ID,
        name: 'my blog',
        values: { ADMIN_EMAIL: 'owner@example.com', SITE_TITLE: 'My blog' },
      }),
    )
  })

  it('rejects a stack name the API would refuse', async () => {
    server.use(listHandler())
    renderWithProviders(<ServiceCatalogue />)

    const deployKuma = await screen.findByRole('button', { name: 'Deploy Uptime Kuma' })
    await waitFor(() => expect(deployKuma).toBeEnabled())
    fireEvent.click(deployKuma)
    fireEvent.change(screen.getByLabelText('Stack name'), { target: { value: '-bad/name' } })

    expect(screen.getByText(/Use up to 63 letters/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Deploy stack' })).toBeDisabled()
  })
})
