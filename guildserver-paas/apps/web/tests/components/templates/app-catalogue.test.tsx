import { screen, fireEvent } from '@testing-library/react'
import TemplatesPage from '@/app/dashboard/templates/page'
import { renderWithProviders } from '../../helpers/render'

describe('App catalog', () => {
  it('searches purpose labels and clears an empty result', () => {
    renderWithProviders(<TemplatesPage />)
    fireEvent.change(screen.getByLabelText('Search templates'), { target: { value: '  Starter kits  ' } })
    expect(screen.getByRole('button', { name: 'Configure Next.js', exact: true })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Configure PostgreSQL', exact: true })).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Search templates'), { target: { value: 'no-template-matches-this' } })
    expect(screen.getByText('No templates found')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reset search and filters' }))
    expect(screen.getByRole('button', { name: 'Configure PostgreSQL', exact: true })).toBeInTheDocument()
  })

  it('opens configuration without deploying and supports Escape', () => {
    renderWithProviders(<TemplatesPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Configure PostgreSQL', exact: true }))
    expect(screen.getByRole('dialog', { name: 'Configure PostgreSQL' })).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape', code: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('exposes selected quick filters and removes recommendations while filtering', () => {
    renderWithProviders(<TemplatesPage />)
    fireEvent.click(screen.getByRole('button', { name: /Ops Explore/ }))
    expect(screen.getByRole('button', { name: /Ops Selected/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('heading', { name: 'Recommended' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Configure PostgreSQL', exact: true })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Configure Next.js', exact: true })).not.toBeInTheDocument()
  })
})
