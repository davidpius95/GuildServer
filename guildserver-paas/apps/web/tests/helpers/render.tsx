import * as React from 'react'
import { render, type RenderOptions } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { httpLink } from '@trpc/client'
import { trpc } from '@/components/trpc-provider'

/**
 * A QueryClient tuned for tests: no retries (so a mocked error resolves
 * immediately instead of retrying for seconds) and no caching between
 * renders (so each test starts from a clean slate).
 */
export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        cacheTime: 0,
        staleTime: 0,
        refetchOnWindowFocus: false,
      },
      mutations: {
        retry: false,
      },
    },
  })
}

/**
 * The real app wires tRPC through `httpBatchLink` with the `superjson`
 * transformer, which coalesces same-tick queries into one batched HTTP
 * call and wraps payloads as `{ json: value }`. That's awkward to
 * hand-write msw handlers for. Tests use a plain (non-batched,
 * non-superjson) `httpLink` instead — every query/mutation becomes one
 * ordinary HTTP request carrying a plain `{ result: { data } }` envelope,
 * which is what the handlers in tests/mocks/server.ts return.
 */
function createTestTRPCClient() {
  return trpc.createClient({
    links: [
      httpLink({
        url: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/trpc',
      }),
    ],
  })
}

interface ProvidersOptions {
  queryClient?: QueryClient
}

export function AllProviders({
  children,
  queryClient = createTestQueryClient(),
}: {
  children: React.ReactNode
  queryClient?: QueryClient
}) {
  const [trpcClient] = React.useState(createTestTRPCClient)

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  )
}

type ExtendedRenderOptions = Omit<RenderOptions, 'wrapper'> & ProvidersOptions

/**
 * Renders a component wrapped in the same tRPC + React Query providers the
 * real app tree provides via <TRPCProvider>. Use together with the msw
 * handlers in tests/mocks/server.ts (or `server.use(...)` overrides) to
 * mock the network responses the component's queries expect.
 */
export function renderWithProviders(ui: React.ReactElement, options: ExtendedRenderOptions = {}) {
  const { queryClient = createTestQueryClient(), ...renderOptions } = options

  return {
    queryClient,
    ...render(ui, {
      wrapper: ({ children }) => <AllProviders queryClient={queryClient}>{children}</AllProviders>,
      ...renderOptions,
    }),
  }
}

export * from '@testing-library/react'
