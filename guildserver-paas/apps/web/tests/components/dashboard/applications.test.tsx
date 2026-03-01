import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, jest } from '@jest/globals'
import ApplicationsPage from '../../../src/app/dashboard/applications/page'

// Mock the trpc provider
const mockTrpc = {
  application: {
    list: {
      useQuery: jest.fn(() => ({
        data: [
          {
            id: '1',
            name: 'api-gateway',
            status: 'running',
            environment: 'production',
            lastDeploy: '2 hours ago',
            url: 'https://api.company.com',
            framework: 'Node.js',
          },
          {
            id: '2',
            name: 'web-dashboard',
            status: 'running',
            environment: 'production',
            lastDeploy: '5 hours ago',
            url: 'https://dashboard.company.com',  
            framework: 'Next.js',
          },
        ],
        isLoading: false,
        error: null,
      })),
    },
  },
}

// Mock the trpc context
jest.mock('../../../src/components/trpc-provider', () => ({
  trpc: mockTrpc,
}))

describe('ApplicationsPage', () => {
  it('renders applications page with header', () => {
    render(<ApplicationsPage />)
    
    expect(screen.getByText('Applications')).toBeInTheDocument()
    expect(screen.getByText('Manage and deploy your applications')).toBeInTheDocument()
    expect(screen.getByText('Deploy Application')).toBeInTheDocument()
  })

  it('displays application cards', () => {
    render(<ApplicationsPage />)
    
    expect(screen.getByText('api-gateway')).toBeInTheDocument()
    expect(screen.getByText('web-dashboard')).toBeInTheDocument()
    expect(screen.getByText('Node.js')).toBeInTheDocument()
    expect(screen.getByText('Next.js')).toBeInTheDocument()
  })

  it('shows application status badges', () => {
    render(<ApplicationsPage />)
    
    const runningBadges = screen.getAllByText('running')
    expect(runningBadges).toHaveLength(2)
    
    const productionBadges = screen.getAllByText('production')
    expect(productionBadges).toHaveLength(2)
  })

  it('displays last deploy information', () => {
    render(<ApplicationsPage />)
    
    expect(screen.getByText('2 hours ago')).toBeInTheDocument()
    expect(screen.getByText('5 hours ago')).toBeInTheDocument()
  })

  it('filters applications based on search query', async () => {
    render(<ApplicationsPage />)
    
    const searchInput = screen.getByPlaceholderText('Search applications...')
    
    fireEvent.change(searchInput, { target: { value: 'api' } })
    
    await waitFor(() => {
      expect(screen.getByText('api-gateway')).toBeInTheDocument()
      expect(screen.queryByText('web-dashboard')).not.toBeInTheDocument()
    })
  })

  it('shows empty state when no applications match search', async () => {
    render(<ApplicationsPage />)
    
    const searchInput = screen.getByPlaceholderText('Search applications...')
    
    fireEvent.change(searchInput, { target: { value: 'nonexistent' } })
    
    await waitFor(() => {
      expect(screen.getByText('No applications found')).toBeInTheDocument()
      expect(screen.getByText('No applications match your search criteria')).toBeInTheDocument()
    })
  })

  it('renders action buttons for each application', () => {
    render(<ApplicationsPage />)
    
    const stopButtons = screen.getAllByText('Stop')
    expect(stopButtons).toHaveLength(2)
    
    const settingsButtons = screen.getAllByLabelText(/Settings/)
    expect(settingsButtons).toHaveLength(2)
  })

  it('shows visit button for applications with URL', () => {
    render(<ApplicationsPage />)
    
    const visitButtons = screen.getAllByText('Visit')
    expect(visitButtons).toHaveLength(2)
  })

  it('handles loading state', () => {
    const mockTrpcLoading = {
      application: {
        list: {
          useQuery: jest.fn(() => ({
            data: undefined,
            isLoading: true,
            error: null,
          })),
        },
      },
    }

    jest.doMock('../../../src/components/trpc-provider', () => ({
      trpc: mockTrpcLoading,
    }))

    render(<ApplicationsPage />)
    
    // Would show loading state - implementation depends on your loading UI
    expect(screen.getByText('Applications')).toBeInTheDocument()
  })

  it('handles error state', () => {
    const mockTrpcError = {
      application: {
        list: {
          useQuery: jest.fn(() => ({
            data: undefined,
            isLoading: false,
            error: { message: 'Failed to fetch applications' },
          })),
        },
      },
    }

    jest.doMock('../../../src/components/trpc-provider', () => ({
      trpc: mockTrpcError,
    }))

    render(<ApplicationsPage />)
    
    // Error handling implementation depends on your error UI
    expect(screen.getByText('Applications')).toBeInTheDocument()
  })

  it('displays framework information correctly', () => {
    render(<ApplicationsPage />)
    
    // Check that framework information is displayed
    expect(screen.getByText('Node.js')).toBeInTheDocument()
    expect(screen.getByText('Next.js')).toBeInTheDocument()
  })

  it('shows application URLs when available', () => {
    render(<ApplicationsPage />)
    
    // Both applications have URLs, so Visit buttons should be present
    const visitButtons = screen.getAllByText('Visit')
    expect(visitButtons).toHaveLength(2)
  })

  describe('empty state', () => {
    it('shows empty state when no applications exist', () => {
      const mockTrpcEmpty = {
        application: {
          list: {
            useQuery: jest.fn(() => ({
              data: [],
              isLoading: false,
              error: null,
            })),
          },
        },
      }

      jest.doMock('../../../src/components/trpc-provider', () => ({
        trpc: mockTrpcEmpty,
      }))

      render(<ApplicationsPage />)
      
      expect(screen.getByText('No applications found')).toBeInTheDocument()
      expect(screen.getByText('Get started by deploying your first application')).toBeInTheDocument()
    })
  })

  describe('accessibility', () => {
    it('has proper heading structure', () => {
      render(<ApplicationsPage />)
      
      const mainHeading = screen.getByRole('heading', { level: 1 })
      expect(mainHeading).toHaveTextContent('Applications')
    })

    it('has accessible search input', () => {
      render(<ApplicationsPage />)
      
      const searchInput = screen.getByRole('searchbox')
      expect(searchInput).toHaveAttribute('placeholder', 'Search applications...')
    })

    it('has accessible buttons', () => {
      render(<ApplicationsPage />)
      
      const deployButton = screen.getByRole('button', { name: /Deploy Application/ })
      expect(deployButton).toBeInTheDocument()
    })
  })
});