#!/usr/bin/env tsx
/**
 * Merge the per-shard ledgers of a sharded scripts/verify-templates.ts run
 * into scripts/verified-templates.json.
 *
 *   pnpm tsx scripts/merge-template-ledgers.ts ledgers/*.json [--out <file>]
 *
 * Every shard must have been produced against the same upstream pin: results
 * from different pins describe different templates and must not be combined.
 */
import { readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";

export interface Ledger {
  upstreamCommit: string;
  verifiedAt: string | null;
  passed: string[];
  failed: Record<string, string>;
}

export function mergeLedgers(ledgers: Ledger[]): Ledger {
  if (ledgers.length === 0) throw new Error("No ledgers to merge");
  const pins = new Set(ledgers.map((ledger) => ledger.upstreamCommit));
  if (pins.size !== 1) throw new Error(`Ledgers come from different upstream pins: ${[...pins].join(", ")}`);

  const passed = new Set<string>();
  const failed: Record<string, string> = {};
  for (const ledger of ledgers) {
    ledger.passed.forEach((id) => passed.add(id));
    Object.assign(failed, ledger.failed);
  }
  // A template that passed anywhere is not failed.
  for (const id of passed) delete failed[id];

  const stamps = ledgers.map((ledger) => ledger.verifiedAt).filter((stamp): stamp is string => Boolean(stamp)).sort();
  return {
    upstreamCommit: ledgers[0].upstreamCommit,
    verifiedAt: stamps.length > 0 ? stamps[stamps.length - 1] : null,
    passed: [...passed].sort(),
    failed: Object.fromEntries(Object.entries(failed).sort(([a], [b]) => a.localeCompare(b))),
  };
}

function main(): void {
  const args = process.argv.slice(2);
  const outIndex = args.indexOf("--out");
  const out = outIndex >= 0 ? resolve(args[outIndex + 1]) : join(__dirname, "verified-templates.json");
  const files = args.filter((arg, index) => arg !== "--out" && index !== outIndex + 1);
  const merged = mergeLedgers(files.map((file) => JSON.parse(readFileSync(file, "utf8")) as Ledger));
  writeFileSync(out, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  console.log(`Merged ${files.length} ledger(s): ${merged.passed.length} passed, ${Object.keys(merged.failed).length} failed → ${out}`);
}

if (require.main === module) main();
