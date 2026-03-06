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
        staleTime: 3 * 60 * 1000, // 3 minutes — reduces redundant refetches
        cacheTime: 10 * 60 * 1000, // Keep in cache 10 min after component unmount
        refetchOnWindowFocus: false, // Don't refetch on every tab switch
        refetchOnReconnect: true, // Refetch when network reconnects
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
            // Don't retry server errors more than once
            if (code === 'INTERNAL_SERVER_ERROR') return failureCount < 1
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