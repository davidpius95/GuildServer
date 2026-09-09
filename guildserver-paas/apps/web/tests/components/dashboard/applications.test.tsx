import { screen, fireEvent, waitFor, waitForElementToBeRemoved } from '@testing-library/react'
import { describe, it, expect } from '@jest/globals'
import { rest } from 'msw'
import ApplicationsPage from '../../../src/app/dashboard/applications/page'
import { renderWithProviders } from '../../helpers/render'
import { server, TEST_ORG_ID } from '../../mocks/server'

const APPS_URL = 'http://localhost:4000/trpc/application.listByOrg'
const ORGS_URL = 'http://localhost:4000/trpc/organization.list'

describe('ApplicationsPage', () => {
  it('renders the page header and primary action', async () => {
    renderWithProviders(<ApplicationsPage />)

    expect(screen.getByText('Applications')).toBeInTheDocument()
    expect(screen.getByText('Deploy and manage your applications')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /New Application/ })).toBeInTheDocument()
  })

  it('displays applications returned by the API', async () => {
    renderWithProviders(<ApplicationsPage />)

    expect(await screen.findByText('api-gateway')).toBeInTheDocument()
    expect(screen.getByText('web-dashboard')).toBeInTheDocument()
  })

  it('shows a status badge per application', async () => {
    renderWithProviders(<ApplicationsPage />)

    await screen.findByText('api-gateway')
    const runningBadges = screen.getAllByText('running')
    expect(runningBadges).toHaveLength(2)
  })

  it('shows the primary domain link for applications that have one', async () => {
    renderWithProviders(<ApplicationsPage />)

    await screen.findByText('web-dashboard')
    const link = screen.getByRole('link', { name: /dashboard\.company\.com/ })
    expect(link).toHaveAttribute('href', 'https://dashboard.company.com')
  })

  it('filters applications by name as the user types', async () => {
    renderWithProviders(<ApplicationsPage />)

    await screen.findByText('api-gateway')

    const searchInput = screen.getByPlaceholderText('Search applications...')
    fireEvent.change(searchInput, { target: { value: 'api' } })

    await waitFor(() => {
      expect(screen.getByText('api-gateway')).toBeInTheDocument()
      expect(screen.queryByText('web-dashboard')).not.toBeInTheDocument()
    })
  })

  it('shows a "no matches" empty state when the search has no results', async () => {
    renderWithProviders(<ApplicationsPage />)

    await screen.findByText('api-gateway')

    const searchInput = screen.getByPlaceholderText('Search applications...')
    fireEvent.change(searchInput, { target: { value: 'nonexistent' } })

    await waitFor(() => {
      expect(screen.getByText('No applications found')).toBeInTheDocument()
      expect(
        screen.getByText('No applications match your search criteria. Try a different search term.')
      ).toBeInTheDocument()
    })
  })

  it('renders per-application deploy/restart/delete actions', async () => {
    renderWithProviders(<ApplicationsPage />)

    await screen.findByText('api-gateway')

    expect(screen.getAllByRole('button', { name: 'Deploy' })).toHaveLength(2)
    expect(screen.getAllByTitle('Restart')).toHaveLength(2)
    expect(screen.getAllByTitle('Delete')).toHaveLength(2)
  })

  it('shows the loading skeleton while the applications query is in flight', async () => {
    // A short (not infinite) delay: long enough that the skeleton is still
    // showing when we assert, but short enough that the request settles
    // and doesn't leave a dangling connection after the test ends.
    server.use(
      rest.get(APPS_URL, (req, res, ctx) => res(ctx.delay(50), ctx.json({ result: { data: [] } })))
    )

    renderWithProviders(<ApplicationsPage />)

    expect(await screen.findByLabelText('Loading applications')).toBeInTheDocument()
    await waitForElementToBeRemoved(() => screen.queryByLabelText('Loading applications'))
  })

  it('degrades to the empty state (without crashing) if the applications query errors', async () => {
    server.use(
      rest.get(APPS_URL, (req, res, ctx) =>
        res(ctx.status(500), ctx.json({ error: { message: 'Internal Server Error' } }))
      )
    )

    renderWithProviders(<ApplicationsPage />)

    // The page still renders its header even though the list request failed.
    expect(screen.getByText('Applications')).toBeInTheDocument()
    // There is currently no dedicated error state for a failed application
    // list — it just falls back to the "no applications" empty state. See
    // the report for a note on this gap.
    expect(await screen.findByText('No applications yet')).toBeInTheDocument()
  })

  describe('no organization yet', () => {
    it('prompts the user to create an organization before showing the app list', async () => {
      server.use(
        rest.get(ORGS_URL, (req, res, ctx) => res(ctx.json({ result: { data: [] } })))
      )

      renderWithProviders(<ApplicationsPage />)

      expect(await screen.findByText('Create an organization first')).toBeInTheDocument()
      expect(
        screen.getByText('You need an organization and project before deploying applications')
      ).toBeInTheDocument()
      expect(screen.getByRole('link', { name: /Get Started/ })).toHaveAttribute(
        'href',
        '/dashboard/onboarding'
      )
    })
  })

  describe('empty state', () => {
    it('shows an empty state when the organization has no applications', async () => {
      server.use(rest.get(APPS_URL, (req, res, ctx) => res(ctx.json({ result: { data: [] } }))))

      renderWithProviders(<ApplicationsPage />)

      expect(await screen.findByText('No applications yet')).toBeInTheDocument()
      expect(
        screen.getByText('Get started by deploying your first application from Docker or Git.')
      ).toBeInTheDocument()
    })
  })

  describe('accessibility', () => {
    it('has a single top-level heading', async () => {
      renderWithProviders(<ApplicationsPage />)

      const mainHeading = await screen.findByRole('heading', { level: 1 })
      expect(mainHeading).toHaveTextContent('Applications')
    })

    it('has a labelled, discoverable search field', async () => {
      renderWithProviders(<ApplicationsPage />)

      const searchInput = await screen.findByPlaceholderText('Search applications...')
      expect(searchInput.tagName).toBe('INPUT')
    })

    it('has an accessible primary action button', async () => {
      renderWithProviders(<ApplicationsPage />)

      const newAppButton = await screen.findByRole('button', { name: /New Application/ })
      expect(newAppButton).toBeInTheDocument()
    })
  })
})
