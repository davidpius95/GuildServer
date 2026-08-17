"use client"

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react"
import { createWalletClient, custom, type WalletClient } from "viem"
import { mainnet, polygon, bsc, arbitrum, base } from "viem/chains"

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID

const CHAINS = [mainnet, polygon, bsc, arbitrum, base]
const CHAIN_IDS = CHAINS.map((c) => c.id)

type Web3State = {
  isConfigured: boolean
  isConnected: boolean
  address: `0x${string}` | null
  chainId: number | null
  connecting: boolean
  connect: () => Promise<void>
  disconnect: () => Promise<void>
  getWalletClient: () => WalletClient | null
}

const Web3Context = createContext<Web3State | null>(null)

/**
 * Minimal WalletConnect integration built directly on @walletconnect/ethereum-provider
 * (which ships its own QR/deep-link modal) + viem — deliberately NOT using wagmi, since
 * wagmi v2 requires @tanstack/react-query v5 and the rest of this app (tRPC's TRPCProvider)
 * is on react-query v4. This avoids a much larger, unrelated version upgrade just to add
 * crypto payments. No-op if NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID isn't set.
 */
export function Web3Provider({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState<`0x${string}` | null>(null)
  const [chainId, setChainId] = useState<number | null>(null)
  const [connecting, setConnecting] = useState(false)
  const providerRef = useRef<any>(null)

  const getProvider = useCallback(async () => {
    if (!projectId) throw new Error("Crypto payments are not configured")
    if (providerRef.current) return providerRef.current

    const { EthereumProvider } = await import("@walletconnect/ethereum-provider")
    const provider = await EthereumProvider.init({
      projectId,
      chains: [mainnet.id],
      optionalChains: CHAIN_IDS as any,
      showQrModal: true,
      metadata: {
        name: "GuildServer",
        description: "GuildServer — Enterprise Platform as a Service",
        url: typeof window !== "undefined" ? window.location.origin : "https://guild-technologies.com",
        icons: ["/logo.png"],
      },
    })

    provider.on("accountsChanged", (accounts: string[]) => {
      setAddress((accounts[0] as `0x${string}`) || null)
    })
    provider.on("chainChanged", (newChainId: string) => {
      setChainId(Number(newChainId))
    })
    provider.on("disconnect", () => {
      setAddress(null)
      setChainId(null)
    })

    providerRef.current = provider
    return provider
  }, [])

  const connect = useCallback(async () => {
    setConnecting(true)
    try {
      const provider = await getProvider()
      await provider.connect()
      const accounts: string[] = provider.accounts || []
      setAddress((accounts[0] as `0x${string}`) || null)
      setChainId(provider.chainId || null)
    } finally {
      setConnecting(false)
    }
  }, [getProvider])

  const disconnect = useCallback(async () => {
    if (providerRef.current) await providerRef.current.disconnect()
    setAddress(null)
    setChainId(null)
  }, [])

  const getWalletClient = useCallback((): WalletClient | null => {
    if (!providerRef.current || !address || !chainId) return null
    const chain = CHAINS.find((c) => c.id === chainId) || mainnet
    return createWalletClient({
      account: address,
      chain,
      transport: custom(providerRef.current),
    })
  }, [address, chainId])

  const value = useMemo<Web3State>(
    () => ({
      isConfigured: !!projectId,
      isConnected: !!address,
      address,
      chainId,
      connecting,
      connect,
      disconnect,
      getWalletClient,
    }),
    [address, chainId, connecting, connect, disconnect, getWalletClient]
  )

  return <Web3Context.Provider value={value}>{children}</Web3Context.Provider>
}

export function useWeb3(): Web3State {
  const ctx = useContext(Web3Context)
  if (!ctx) throw new Error("useWeb3 must be used within Web3Provider")
  return ctx
}

export function isWeb3Configured(): boolean {
  return !!projectId
}
