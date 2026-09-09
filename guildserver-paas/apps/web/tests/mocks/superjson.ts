/**
 * CommonJS stand-in for superjson.
 *
 * superjson 2.x publishes ESM only, and `next/jest` excludes node_modules from
 * transformation, so every component that reaches trpc-provider — which is most
 * pages — fails to parse under jest. The transport format is irrelevant to
 * component tests, so a pass-through is both sufficient and faster.
 */
const superjson = {
  serialize: (v: unknown) => ({ json: v, meta: undefined }),
  deserialize: (v: any) => (v && typeof v === "object" && "json" in v ? v.json : v),
  stringify: (v: unknown) => JSON.stringify(v),
  parse: (v: string) => JSON.parse(v),
  registerCustom: () => {},
  registerClass: () => {},
  allowErrorProps: () => {},
}

export const serialize = superjson.serialize
export const deserialize = superjson.deserialize
export const stringify = superjson.stringify
export const parse = superjson.parse
export const registerCustom = superjson.registerCustom
export const registerClass = superjson.registerClass
export const allowErrorProps = superjson.allowErrorProps
export default superjson
