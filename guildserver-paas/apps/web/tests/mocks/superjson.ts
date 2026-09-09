// `superjson` ships as ESM-only, and next/jest does not transform node_modules
// by default. Rather than fight the transform pipeline, we swap in a minimal
// CommonJS-compatible stand-in for tests. It only needs to round-trip plain
// JSON-shaped values (strings, numbers, booleans, arrays, plain objects) —
// everything our components and mocked tRPC responses actually send — so a
// thin JSON-based serializer is sufficient here; it does not attempt to
// replicate superjson's Date/Map/Set/BigInt support.
const superjson = {
  serialize(value: unknown) {
    return { json: value }
  },
  deserialize(payload: any) {
    return payload?.json
  },
  stringify(value: unknown) {
    return JSON.stringify(value)
  },
  parse(value: string) {
    return JSON.parse(value)
  },
  registerClass() {},
  registerSymbol() {},
  registerCustom() {},
  allowErrorProps() {},
}

export default superjson
export { superjson }
