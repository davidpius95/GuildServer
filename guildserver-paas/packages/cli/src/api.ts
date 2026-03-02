import { getToken, getApiUrl, loadConfig } from "./config";

/**
 * Make a tRPC-style API call to the GuildServer API.
 * tRPC v10 HTTP protocol:
 *   - Queries: GET /trpc/procedure?input={"json":{...}}
 *   - Mutations: POST /trpc/procedure with body {"json":{...}}
 *   - Response: { result: { data: { json: ... } } }
 */
export async function trpcCall(
  procedure: string,
  input?: any,
  method: "query" | "mutation" = "query"
): Promise<any> {
  const token = getToken();
  const apiUrl = getApiUrl();
  const url = `${apiUrl}/trpc/${procedure}`;

  try {
    if (method === "query") {
      const params = input
        ? `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`
        : "";
      const response = await fetch(`${url}${params}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`API error (${response.status}): ${extractErrorMessage(body)}`);
      }

      const data = await response.json();
      return data.result?.data?.json;
    } else {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ json: input }),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`API error (${response.status}): ${extractErrorMessage(body)}`);
      }

      const data = await response.json();
      return data.result?.data?.json;
    }
  } catch (error: any) {
    if (error.cause?.code === "ECONNREFUSED") {
      throw new Error(
        `Cannot connect to GuildServer API at ${apiUrl}. Is the server running?`
      );
    }
    throw error;
  }
}

/**
 * Extract a readable error message from tRPC error response
 */
function extractErrorMessage(body: string): string {
  try {
    const parsed = JSON.parse(body);
    const msg = parsed?.error?.json?.message;
    if (msg) {
      // Try to parse Zod error messages
      try {
        const zodErrors = JSON.parse(msg);
        if (Array.isArray(zodErrors)) {
          return zodErrors
            .map((e: any) => `${e.path?.join(".") || "input"}: ${e.message}`)
            .join(", ");
        }
      } catch {}
      return msg;
    }
    return body.substring(0, 200);
  } catch {
    return body.substring(0, 200);
  }
}

/**
 * Make a direct REST API call
 */
export async function apiCall(
  path: string,
  options: {
    method?: string;
    body?: any;
    noAuth?: boolean;
  } = {}
): Promise<any> {
  const apiUrl = getApiUrl();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (!options.noAuth) {
    headers.Authorization = `Bearer ${getToken()}`;
  }

  const response = await fetch(`${apiUrl}${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`API error (${response.status}): ${body}`);
  }

  return response.json();
}

/**
 * Login to the GuildServer API and get a JWT token
 */
export async function loginApi(
  email: string,
  password: string,
  apiUrl: string
): Promise<{ token: string; user: any }> {
  const response = await fetch(`${apiUrl}/trpc/auth.login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ json: { email, password } }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Login failed: ${extractErrorMessage(body)}`);
  }

  const data = await response.json();
  return data.result?.data?.json;
}

/**
 * Register a new account on the GuildServer API
 */
export async function registerApi(
  name: string,
  email: string,
  password: string,
  apiUrl: string
): Promise<{ token: string; user: any }> {
  const response = await fetch(`${apiUrl}/trpc/auth.register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ json: { name, email, password } }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Registration failed: ${extractErrorMessage(body)}`);
  }

  const data = await response.json();
  return data.result?.data?.json;
}
