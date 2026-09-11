/**
 * Remove credentials from everything the REST API returns.
 *
 * Some tRPC procedures return whole rows — database.listByOrg and
 * database.getById include the database password — because the dashboard
 * shows connection details to a signed-in owner. A long-lived token, likely
 * stored in a CI system, is not that audience. Redaction is applied to every
 * response rather than per endpoint, so a future procedure that starts
 * returning a secret is covered without anyone remembering to add it here.
 */

/**
 * Keys whose value is a secret: the key IS a secret word, or ENDS in one at a
 * word boundary — camelCase ("dbPassword", "accessToken", "clientSecret") or
 * snake/kebab case ("registry_password", "DB_PASSWORD").
 *
 * Matching the word anywhere redacted "tokenId" and "tokenPrefix", hiding
 * identifiers callers need. Matching a suffix case-insensitively went wrong
 * the other way ("bypass", "compass"), because the camelCase boundary is only
 * visible in the letter case. Hence three rules.
 */
const SECRET_WORDS = "pass|passwd|password|secret|token|api[_-]?key|private[_-]?key|credentials?|token[_-]?hash";
const WHOLE_KEY = new RegExp(`^(?:${SECRET_WORDS})$`, "i");
const CAMEL_SUFFIX = /[a-z0-9](?:Pass|Passwd|Password|Secret|Token|ApiKey|PrivateKey|Credentials?|TokenHash)$/;
const DELIMITED_SUFFIX = new RegExp(`[_-](?:${SECRET_WORDS})$`, "i");

function isSecretKey(key: string): boolean {
  return WHOLE_KEY.test(key) || CAMEL_SUFFIX.test(key) || DELIMITED_SUFFIX.test(key);
}
/** scheme://user:password@host  ->  scheme://user:[redacted]@host */
const URL_CREDENTIALS = /\b([a-z][a-z0-9+.-]*:\/\/[^\s/:@]+):[^\s@/]+@/gi;

export const REDACTED = "[redacted]";

export function redact<T>(value: T, depth = 0): T {
  if (depth > 32) return value;
  if (typeof value === "string") {
    return value.replace(URL_CREDENTIALS, `$1:${REDACTED}@`) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redact(item, depth + 1)) as unknown as T;
  }
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      if (isSecretKey(key) && typeof inner === "string" && inner.length > 0) {
        out[key] = REDACTED;
      } else {
        out[key] = redact(inner, depth + 1);
      }
    }
    return out as T;
  }
  return value;
}
