"use client"

import { useState, useEffect } from "react"
import { parseUnits } from "viem"
import { useWeb3 } from "@/components/providers/web3-provider"
import { trpc } from "@/components/trpc-provider"
import { Button } from "@/components/ui/button"
import { Loader2, Wallet, CheckCircle2, AlertCircle, Copy } from "lucide-react"

const ERC20_TRANSFER_ABI = [
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const

type Props = {
  organizationId: string
  planSlug: "pro" | "enterprise"
  billingInterval: "monthly" | "yearly"
  chainId: number
  tokenSymbol: string
  onDone: () => void
}

/**
 * Crypto checkout flow: connect wallet (Web3Modal button) → create a payment intent server-side
 * → send the exact token amount to GuildServer's collection wallet → submit the tx hash for
 * verification → poll until the backend confirms enough block confirmations.
 */
export function CryptoCheckoutPanel({ organizationId, planSlug, billingInterval, chainId, tokenSymbol, onDone }: Props) {
  const { isConnected, chainId: connectedChainId, connecting, connect, getWalletClient } = useWeb3()

  const [paymentId, setPaymentId] = useState<string | null>(null)
  const [txHash, setTxHash] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  const createIntent = trpc.billing.createCryptoSubscriptionPayment.useMutation()
  const confirmTx = trpc.billing.confirmCryptoPayment.useMutation()
  const statusQuery = trpc.billing.getCryptoPaymentStatus.useQuery(
    { paymentId: paymentId! },
    { enabled: !!paymentId && !!txHash, refetchInterval: 5000 }
  )

  useEffect(() => {
    if (statusQuery.data?.status === "confirmed") onDone()
  }, [statusQuery.data?.status, onDone])

  const handleCreateIntent = async () => {
    setError(null)
    try {
      const payment = await createIntent.mutateAsync({
        organizationId,
        planSlug,
        billingInterval,
        chainId,
        tokenSymbol,
      })
      setPaymentId(payment.id)
    } catch (e: any) {
      setError(e.message)
    }
  }

  const handleSend = async () => {
    const walletClient = getWalletClient()
    if (!paymentId || (!statusQuery.data && !createIntent.data) || !walletClient) return
    const payment = (createIntent.data as any) || statusQuery.data
    setError(null)
    setSending(true)
    try {
      let hash: string
      if (payment.tokenContractAddress) {
        hash = await walletClient.writeContract({
          address: payment.tokenContractAddress as `0x${string}`,
          abi: ERC20_TRANSFER_ABI,
          functionName: "transfer",
          args: [payment.receivingAddress as `0x${string}`, parseUnits(payment.expectedAmount, payment.tokenDecimals)],
        })
      } else {
        hash = await walletClient.sendTransaction({
          to: payment.receivingAddress as `0x${string}`,
          value: parseUnits(payment.expectedAmount, payment.tokenDecimals),
        })
      }
      setTxHash(hash)
      await confirmTx.mutateAsync({ paymentId, txHash: hash })
    } catch (e: any) {
      setError(e.shortMessage || e.message)
    } finally {
      setSending(false)
    }
  }

  const payment = (createIntent.data as any) || statusQuery.data
  const wrongChain = isConnected && connectedChainId !== chainId

  return (
    <div className="space-y-4">
      {!isConnected ? (
        <div className="rounded-lg border border-dashed p-6 text-center">
          <Wallet className="h-8 w-8 mx-auto text-muted-foreground/40 mb-2" />
          <p className="text-sm text-muted-foreground mb-3">Connect a wallet to pay with crypto</p>
          <Button onClick={connect} disabled={connecting}>
            {connecting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Connect Wallet
          </Button>
        </div>
      ) : !paymentId ? (
        <Button className="w-full" onClick={handleCreateIntent} disabled={createIntent.isPending}>
          {createIntent.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
          Get {tokenSymbol} payment amount
        </Button>
      ) : wrongChain ? (
        <p className="text-sm text-amber-600 text-center">
          Switch your wallet network to the correct chain to continue.
        </p>
      ) : !txHash ? (
        <div className="space-y-3">
          <div className="rounded-lg bg-muted/50 p-4 space-y-2 text-sm">
            <Row label="Amount" value={`${Number(payment.expectedAmount).toFixed(6)} ${tokenSymbol}`} />
            <Row label="To" value={`${payment.receivingAddress.slice(0, 6)}...${payment.receivingAddress.slice(-4)}`} copy={payment.receivingAddress} />
            <Row label="Expires" value={new Date(payment.expiresAt).toLocaleTimeString()} />
          </div>
          <Button className="w-full" onClick={handleSend} disabled={sending}>
            {sending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Send {tokenSymbol} from wallet
          </Button>
        </div>
      ) : (
        <div className="rounded-lg border p-4 text-center space-y-2">
          {statusQuery.data?.status === "confirmed" ? (
            <>
              <CheckCircle2 className="h-8 w-8 mx-auto text-green-500" />
              <p className="text-sm font-medium">Payment confirmed!</p>
            </>
          ) : (
            <>
              <Loader2 className="h-8 w-8 mx-auto animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Waiting for confirmations ({statusQuery.data?.confirmations ?? 0}/{statusQuery.data?.requiredConfirmations ?? "?"})
              </p>
            </>
          )}
        </div>
      )}
      {error && (
        <p className="text-xs text-red-500 flex items-center gap-1">
          <AlertCircle className="h-3 w-3" /> {error}
        </p>
      )}
    </div>
  )
}

function Row({ label, value, copy }: { label: string; value: string; copy?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono flex items-center gap-1">
        {value}
        {copy && (
          <button onClick={() => navigator.clipboard.writeText(copy)} className="text-muted-foreground hover:text-foreground">
            <Copy className="h-3 w-3" />
          </button>
        )}
      </span>
    </div>
  )
}
