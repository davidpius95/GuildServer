"use client"

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { httpBatchLink, TRPCClientError } from '@trpc/client'
import { createTRPCReact } from '@trpc/react-query'
import { useState } from 'react'
import superjson from 'superjson'

import type { AppRouter } from '../../../api/src/index'

export const trpc = createTRPCReact<AppRouter>()

export function TRPCProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 2 * 60 * 1000, // 2 minutes default
        refetchOnWindowFocus: true,
        retry: (failureCount, error) => {
          if (error instanceof TRPCClientError) {
            const code = error.data?.code
            if (code === 'UNAUTHORIZED' || code === 'FORBIDDEN') {
              if (typeof window !== 'undefined') {
                localStorage.removeItem('guildserver-token')
                window.location.href = '/auth/login'
              }
              return false
            }
          }
          return failureCount < 2
        },
      },
      mutations: {
        retry: 0,
      },
    },
  }))
  
  const [trpcClient] = useState(() =>
    trpc.createClient({
      transformer: superjson,
      links: [
        httpBatchLink({
          url: process.env.NEXT_PUBLIC_API_URL || '/trpc',
          headers() {
            const token = typeof window !== 'undefined'
              ? localStorage.getItem('guildserver-token')
              : null
            return token ? { authorization: `Bearer ${token}` } : {}
          },
        }),
      ],
    }),
  )

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </trpc.Provider>
  )
}