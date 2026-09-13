"use client"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { trpc } from "@/components/trpc-provider"
import { useState } from "react"

export function BillingDocument({ document, kind, organizationId, onClose, onPay }: { document: any; kind: "quote" | "invoice" | "receipt"; organizationId: string; onClose: () => void; onPay: (invoice: any) => void }) {
  const utils = trpc.useUtils()
  const [error, setError] = useState("")
  const detail = trpc.billing.getInvoice.useQuery({ organizationId, invoiceId: kind === "receipt" ? document.invoiceId : document.id }, { enabled: kind !== "quote" })
  const accept = trpc.billing.acceptQuote.useMutation()
  const lines = kind === "quote" ? document.lineItems : detail.data?.lineItems
  const money = (value: number) => new Intl.NumberFormat("en-NG", { style: "currency", currency: document.currency }).format(value / 100)
  const expired = kind === "quote" && document.status !== "accepted" && document.validUntil && new Date(document.validUntil).getTime() <= Date.now()
  const total = kind === "quote" ? document.totalCents : kind === "receipt" ? document.amountCents : document.amountDueCents
  async function acceptQuote() {
    try { const invoice = await accept.mutateAsync({ organizationId, quoteId: document.id }); await utils.billing.invalidate(); onPay(invoice); onClose() }
    catch (e) { setError(e instanceof Error ? e.message : "Quote could not be accepted.") }
  }
  function download() {
    const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!))
    const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>${escape(document.number)}</title><style>body{font:16px system-ui;color:#17241f;max-width:760px;margin:64px auto;padding:24px}h1{font-size:36px}table{width:100%;border-collapse:collapse;margin:32px 0}td,th{text-align:left;border-bottom:1px solid #ddd;padding:12px}footer{margin-top:48px;font-size:12px;color:#555}</style><h2>GuildServer</h2><h1>${escape(kind.charAt(0).toUpperCase() + kind.slice(1))}</h1><p>${escape(document.number)} · ${escape(expired ? "expired" : document.status)}</p><p>Organization: ${escape(organizationId)}</p><p>Issued: ${escape(new Date(document.issuedAt || document.createdAt).toLocaleString())}</p>${document.validUntil ? `<p>Valid until: ${escape(new Date(document.validUntil).toLocaleString())}</p>` : ""}<table><thead><tr><th>Description</th><th>Quantity</th><th>Amount</th></tr></thead><tbody>${(lines || []).map((l: any) => `<tr><td>${escape(l.description)}</td><td>${escape(l.quantity)}</td><td>${escape(money(l.totalCents))}</td></tr>`).join("")}</tbody></table><h2>${kind === "receipt" ? "Amount received" : "Total"}: ${escape(money(total))}</h2>${document.paymentTransactionId ? `<p>Payment reference: ${escape(document.paymentTransactionId)}</p>` : ""}<footer>This is a GuildServer billing record. Currency: ${escape(document.currency.toUpperCase())}. This document is not a tax invoice.</footer></html>`
    const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }))
    const a = window.document.createElement("a"); a.href = url; a.download = `${document.number || kind}.html`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <Dialog open onOpenChange={onClose}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl"><DialogHeader><DialogTitle className="capitalize">{kind} {document.number}</DialogTitle><DialogDescription>{expired ? "This quote has expired. Choose a plan to request a new one." : `Status: ${document.status}. All amounts are in ${document.currency.toUpperCase()}.`}</DialogDescription></DialogHeader>
    {detail.isLoading && kind !== "quote" ? <p role="status">Loading document…</p> : <div className="divide-y rounded-xl border px-4">{lines?.map((line: any) => <div key={line.id} className="flex justify-between gap-4 py-4 text-sm"><div><p className="font-medium">{line.description}</p><p className="text-xs text-muted-foreground">{line.quantity} × {money(line.unitAmountCents)}</p>{line.taxCents > 0 && <p className="text-xs">Tax: {money(line.taxCents)}</p>}{line.discountCents > 0 && <p className="text-xs">Discount: {money(line.discountCents)}</p>}</div><p className="shrink-0 tabular-nums">{money(line.totalCents)}</p></div>)}<div className="flex justify-between py-4 font-semibold"><span>{kind === "receipt" ? "Amount received" : "Total"}</span><span>{money(total)}</span></div></div>}
    {(error || detail.error) && <p role="alert" className="text-sm text-destructive">{error || detail.error?.message}</p>}
    <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={kind !== "quote" && (!detail.data || detail.isError)} onClick={download}>Download {kind}</Button>{kind === "quote" && !expired && ["draft", "sent"].includes(document.status) && <Button disabled={accept.isPending} onClick={acceptQuote}>{accept.isPending ? "Accepting…" : "Accept quote & pay"}</Button>}{kind === "invoice" && document.status === "open" && <Button onClick={() => { onPay(document); onClose() }}>Pay invoice</Button>}</div>
  </DialogContent></Dialog>
}
