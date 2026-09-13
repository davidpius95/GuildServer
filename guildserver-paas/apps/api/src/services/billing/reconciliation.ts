import { db, paymentTransactions } from "@guildserver/database";
import { and, eq, inArray, asc } from "drizzle-orm";
import { isFlutterwaveV4Configured } from "./flutterwave-v4-client";
import { settleChargeFromProvider } from "./flutterwave-v4";
import { logger } from "../../utils/logger";

let active = false;
export async function reconcileFlutterwavePayments() {
  if (active || !isFlutterwaveV4Configured()) return;
  active = true;
  try {
    const payments = await db.select().from(paymentTransactions).where(and(eq(paymentTransactions.provider, "flutterwave"), inArray(paymentTransactions.status, ["pending", "processing"]))).orderBy(asc(paymentTransactions.updatedAt)).limit(25);
    for (const payment of payments) {
      try {
        if (!payment.flutterwaveTxRef) continue;
        const result = await settleChargeFromProvider({ reference: payment.flutterwaveTxRef });
        // Rotate every inspected attempt, including those still awaiting payment.
        await db.update(paymentTransactions).set({ updatedAt: new Date() }).where(eq(paymentTransactions.id, payment.id));
        if (result.result === "settled") logger.info("Reconciled Flutterwave payment", { paymentTransactionId: payment.id, status: result.status });
      } catch { logger.error("Flutterwave payment needs reconciliation", { paymentTransactionId: payment.id }); }
    }
  } catch { logger.error("Flutterwave reconciliation unavailable"); }
  finally { active = false; }
}
export function startPaymentReconciliation() {
  const timer = setInterval(() => { void reconcileFlutterwavePayments(); }, 60_000);
  timer.unref();
  return timer;
}
