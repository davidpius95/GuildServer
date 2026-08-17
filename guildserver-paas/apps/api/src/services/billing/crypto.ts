import { createPublicClient, http, formatUnits } from "viem";
import { mainnet, polygon, bsc, arbitrum, base } from "viem/chains";
import { db, paymentTransactions, cryptoPayments } from "@guildserver/database";
import { eq } from "drizzle-orm";
import { logger } from "../../utils/logger";

const CHAINS = { 1: mainnet, 137: polygon, 56: bsc, 42161: arbitrum, 8453: base } as const;
type SupportedChainId = keyof typeof CHAINS;

// Tokens GuildServer accepts, per chain. Extend as needed via env or here.
const SUPPORTED_TOKENS: Record<SupportedChainId, Record<string, { address: string | null; decimals: number }>> = {
  1: {
    USDC: { address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6 },
    USDT: { address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6 },
    ETH: { address: null, decimals: 18 },
  },
  137: {
    USDC: { address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", decimals: 6 },
    MATIC: { address: null, decimals: 18 },
  },
  56: {
    USDT: { address: "0x55d398326f99059fF775485246999027B3197955", decimals: 18 },
    BNB: { address: null, decimals: 18 },
  },
  42161: {
    USDC: { address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6 },
    ETH: { address: null, decimals: 18 },
  },
  8453: {
    USDC: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
    ETH: { address: null, decimals: 18 },
  },
};

function isSupportedChain(chainId: number): chainId is SupportedChainId {
  return chainId in CHAINS;
}

function rpcUrlFor(chainId: SupportedChainId): string {
  const envKey = `CRYPTO_RPC_URL_${chainId}`;
  const url = process.env[envKey];
  if (!url) throw new Error(`No RPC URL configured for chain ${chainId}. Set ${envKey} in your environment.`);
  return url;
}

function clientFor(chainId: SupportedChainId) {
  return createPublicClient({ chain: CHAINS[chainId], transport: http(rpcUrlFor(chainId)) });
}

export function isCryptoConfigured(): boolean {
  return !!process.env.CRYPTO_COLLECTION_WALLET_ADDRESS;
}

/** USD -> token amount, via a simple price feed. Falls back to 1:1 for stablecoins. */
async function usdToTokenAmount(usdCents: number, tokenSymbol: string): Promise<number> {
  const stablecoins = ["USDC", "USDT", "DAI", "BUSD"];
  if (stablecoins.includes(tokenSymbol)) {
    return usdCents / 100;
  }

  const coingeckoIds: Record<string, string> = { ETH: "ethereum", MATIC: "matic-network", BNB: "binancecoin" };
  const id = coingeckoIds[tokenSymbol];
  if (!id) throw new Error(`No price feed mapping for token ${tokenSymbol}`);

  const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`);
  const body = await res.json();
  const usdPrice = body[id]?.usd;
  if (!usdPrice) throw new Error(`Failed to fetch USD price for ${tokenSymbol}`);

  return usdCents / 100 / usdPrice;
}

/**
 * Create a crypto payment intent: the amount/address the customer must send from their
 * WalletConnect-linked wallet. The frontend polls getCryptoPaymentStatus() or submits the
 * resulting txHash to confirmCryptoPaymentTxHash() once the wallet broadcasts it.
 */
export async function createCryptoPaymentIntent(args: {
  organizationId: string;
  purpose: "subscription" | "wallet_topup" | "instance" | "invoice_payment";
  amountCents: number;
  chainId: number;
  tokenSymbol: string;
  metadata?: Record<string, any>;
}): Promise<typeof cryptoPayments.$inferSelect> {
  if (!isSupportedChain(args.chainId)) {
    throw new Error(`Unsupported chain ${args.chainId}`);
  }
  const receivingAddress = process.env.CRYPTO_COLLECTION_WALLET_ADDRESS;
  if (!receivingAddress) {
    throw new Error("CRYPTO_COLLECTION_WALLET_ADDRESS is not configured.");
  }

  const token = SUPPORTED_TOKENS[args.chainId]?.[args.tokenSymbol.toUpperCase()];
  if (!token) {
    throw new Error(`Token ${args.tokenSymbol} not supported on chain ${args.chainId}`);
  }

  const expectedAmount = await usdToTokenAmount(args.amountCents, args.tokenSymbol.toUpperCase());

  const [txn] = await db
    .insert(paymentTransactions)
    .values({
      organizationId: args.organizationId,
      provider: "crypto",
      status: "pending",
      purpose: args.purpose,
      amountCents: args.amountCents,
      currency: "usd",
      metadata: args.metadata || {},
    })
    .returning();

  const [payment] = await db
    .insert(cryptoPayments)
    .values({
      organizationId: args.organizationId,
      paymentTransactionId: txn.id,
      status: "awaiting_payment",
      chainId: args.chainId,
      tokenSymbol: args.tokenSymbol.toUpperCase(),
      tokenContractAddress: token.address,
      tokenDecimals: token.decimals,
      receivingAddress,
      expectedAmount: expectedAmount.toString(),
      usdEquivalentCents: args.amountCents,
      requiredConfirmations: args.chainId === 1 ? 12 : 30,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 min
    })
    .returning();

  logger.info(`Created crypto payment intent ${payment.id} for org ${args.organizationId} (${expectedAmount} ${args.tokenSymbol})`);
  return payment;
}

/**
 * Called by the frontend right after the wallet broadcasts the transaction.
 * We look the tx up on-chain, confirm recipient/amount/token match, and start tracking confirmations.
 * Final confirmation happens via pollCryptoPaymentConfirmations (cron/queue) once enough blocks pass.
 */
export async function confirmCryptoPaymentTxHash(paymentId: string, txHash: string): Promise<typeof cryptoPayments.$inferSelect> {
  const payment = await db.query.cryptoPayments.findFirst({ where: eq(cryptoPayments.id, paymentId) });
  if (!payment) throw new Error("Crypto payment not found");
  if (payment.status !== "awaiting_payment") return payment;
  if (new Date() > payment.expiresAt) {
    await db.update(cryptoPayments).set({ status: "expired", updatedAt: new Date() }).where(eq(cryptoPayments.id, paymentId));
    throw new Error("Payment intent expired — please start a new payment");
  }

  const chainId = payment.chainId as SupportedChainId;
  const client = clientFor(chainId);

  const tx = await client.getTransaction({ hash: txHash as `0x${string}` });
  if (!tx) throw new Error("Transaction not found on-chain yet — try again shortly");

  const payerAddress = tx.from;
  let sentAmountRaw: bigint;

  if (payment.tokenContractAddress) {
    // ERC-20 transfer: decode via receipt logs
    const receipt = await client.getTransactionReceipt({ hash: txHash as `0x${string}` });
    const transferLog = receipt.logs.find(
      (l) => l.address.toLowerCase() === payment.tokenContractAddress!.toLowerCase()
    );
    if (!transferLog) throw new Error("No matching token transfer found in transaction");
    sentAmountRaw = BigInt(transferLog.data);
  } else {
    // Native token transfer
    if (tx.to?.toLowerCase() !== payment.receivingAddress.toLowerCase()) {
      throw new Error("Transaction recipient does not match the expected payment address");
    }
    sentAmountRaw = tx.value;
  }

  const sentAmount = Number(formatUnits(sentAmountRaw, payment.tokenDecimals));
  const expected = Number(payment.expectedAmount);
  const status = sentAmount >= expected * 0.995 ? "confirming" : "underpaid"; // 0.5% price-slippage tolerance

  const [updated] = await db
    .update(cryptoPayments)
    .set({ status, txHash, payerAddress, updatedAt: new Date() })
    .where(eq(cryptoPayments.id, paymentId))
    .returning();

  logger.info(`Crypto payment ${paymentId} tx submitted: ${txHash} (${status})`);
  return updated;
}

/**
 * Poll pending crypto payments for confirmation depth. Intended to run on a short interval
 * (cron/queue) — see queues/crypto-payments.ts.
 */
export async function pollCryptoPaymentConfirmations(): Promise<void> {
  const pending = await db.query.cryptoPayments.findMany({
    where: eq(cryptoPayments.status, "confirming"),
  });

  for (const payment of pending) {
    if (!payment.txHash) continue;
    try {
      const client = clientFor(payment.chainId as SupportedChainId);
      const receipt = await client.getTransactionReceipt({ hash: payment.txHash as `0x${string}` });
      const currentBlock = await client.getBlockNumber();
      const confirmations = Number(currentBlock - receipt.blockNumber);

      if (confirmations >= (payment.requiredConfirmations || 12)) {
        await db
          .update(cryptoPayments)
          .set({ status: "confirmed", confirmations, confirmedAt: new Date(), updatedAt: new Date() })
          .where(eq(cryptoPayments.id, payment.id));

        if (payment.paymentTransactionId) {
          await db
            .update(paymentTransactions)
            .set({ status: "succeeded", paidAt: new Date(), updatedAt: new Date() })
            .where(eq(paymentTransactions.id, payment.paymentTransactionId));
        }
        logger.info(`Crypto payment ${payment.id} confirmed (${confirmations} confirmations)`);
      } else {
        await db.update(cryptoPayments).set({ confirmations, updatedAt: new Date() }).where(eq(cryptoPayments.id, payment.id));
      }
    } catch (err: any) {
      logger.warn(`Error polling crypto payment ${payment.id}: ${err.message}`);
    }
  }

  // Expire stale awaiting_payment intents
  const stale = await db.query.cryptoPayments.findMany({ where: eq(cryptoPayments.status, "awaiting_payment") });
  for (const payment of stale) {
    if (new Date() > payment.expiresAt) {
      await db.update(cryptoPayments).set({ status: "expired", updatedAt: new Date() }).where(eq(cryptoPayments.id, payment.id));
    }
  }
}

export function getSupportedCryptoOptions() {
  return Object.entries(SUPPORTED_TOKENS).map(([chainId, tokens]) => ({
    chainId: Number(chainId),
    chainName: CHAINS[Number(chainId) as SupportedChainId].name,
    tokens: Object.keys(tokens),
  }));
}
