import '@testing-library/jest-dom'
// jest-environment-jsdom does not implement `fetch` — it emulates a browser
// DOM, not browser network APIs. tRPC's httpLink needs a fetch
// implementation to make requests, and msw v1's request interceptor works
// by patching XMLHttpRequest/http.ClientRequest, so a fetch polyfill built
// on XHR (rather than Node's native fetch) is what msw v1 can actually see
// and mock.
import 'whatwg-fetch'
import { cleanup } from '@testing-library/react'
import { server } from './mocks/server'

// The real tRPC client picks the API origin up from these env vars. Point
// them at the same origin the msw handlers in tests/mocks/server.ts listen
// on, so components that render <TRPCProvider> (or the test render helper
// in tests/helpers/render.tsx) hit mocked responses instead of a real
// network call.
process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/trpc'
process.env.NEXT_PUBLIC_API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000'

// Mock Next.js router
jest.mock('next/navigation', () => ({
  useRouter() {
    return {
      push: jest.fn(),
      replace: jest.fn(),
      prefetch: jest.fn(),
      back: jest.fn(),
      forward: jest.fn(),
      refresh: jest.fn(),
    }
  },
  usePathname() {
    return '/dashboard'
  },
  useSearchParams() {
    return new URLSearchParams()
  },
}))

// Mock localStorage. Default `getItem` returns a fake auth token so hooks
// like useAuth/useOrganization/useCurrentUser (which gate their tRPC
// queries on being authenticated) behave the same as a logged-in session
// by default. jest.clearAllMocks() (below) clears call history but not
// this implementation, so it stays in effect across tests; override with
// `(localStorage.getItem as jest.Mock).mockReturnValueOnce(null)` in a
// test that needs to exercise the logged-out path.
const localStorageMock = {
  getItem: jest.fn((key: string) => (key === 'guildserver-token' ? 'test-token' : null)),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
}
// A plain `global.localStorage = localStorageMock` assignment silently
// no-ops here: jsdom defines `window.localStorage` as a getter-only
// accessor property, so redefining it needs defineProperty rather than a
// direct assignment.
Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
  writable: true,
  configurable: true,
})

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: jest.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(), // Deprecated
    removeListener: jest.fn(), // Deprecated
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })),
})

// Mock ResizeObserver
global.ResizeObserver = jest.fn().mockImplementation(() => ({
  observe: jest.fn(),
  unobserve: jest.fn(),
  disconnect: jest.fn(),
}))

// Mock IntersectionObserver
global.IntersectionObserver = jest.fn().mockImplementation(() => ({
  observe: jest.fn(),
  unobserve: jest.fn(),
  disconnect: jest.fn(),
}))

// Establish API mocking before all tests
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))

// Clean up after each test case (e.g. clearing jsdom)
afterEach(() => {
  cleanup()
  server.resetHandlers()
  jest.clearAllMocks()
})

// Clean up after the tests are finished
afterAll(() => server.close())