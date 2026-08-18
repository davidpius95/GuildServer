/**
 * Turns errors into something a user can act on.
 *
 * Raw provider and server errors were being rendered straight into the UI — the
 * repository picker showed a full GitHub 401 JSON blob, complete with
 * documentation_url. That leaks internals, looks broken, and tells the user
 * nothing about what to do next.
 *
 * Everything user-facing should go through getFriendlyMessage(). Full detail is
 * still logged to the console for debugging.
 */

export interface FriendlyError {
  /** Short headline, e.g. "Connection expired". */
  title: string
  /** One sentence the user can act on. */
  message: string
  /** Suggested recovery, when there is a sensible one. */
  action?: "retry" | "reconnect" | "signin" | "contact"
}

/** Server messages already written for humans — pass these through unchanged. */
function looksHumanReadable(msg: string): boolean {
  if (!msg) return false
  // Reject anything carrying machine detail: JSON, stack frames, URLs, codes.
  if (/[{}]|https?:\/\/|\bat \w+ \(|Error:|\bstack\b/i.test(msg)) return false
  if (msg.length > 160) return false
  // Require it to read like a sentence rather than an identifier.
  return /^[A-Z].*/.test(msg.trim())
}

function extract(error: unknown): { message: string; code?: string; status?: number } {
  if (!error) return { message: "" }
  const e = error as any
  return {
    message: String(e?.message ?? e ?? ""),
    code: e?.data?.code ?? e?.shape?.data?.code ?? e?.code,
    status: e?.data?.httpStatus ?? e?.status,
  }
}

export function getFriendlyError(error: unknown): FriendlyError {
  const { message, code, status } = extract(error)

  // Keep the raw detail reachable without showing it.
  if (typeof console !== "undefined" && error) {
    console.debug("[error]", { code, status, message, error })
  }

  const lower = message.toLowerCase()

  // Offline / unreachable — most common and most confusing when raw.
  if (
    lower.includes("failed to fetch") &&
    (lower.includes("networkerror") || lower.includes("load failed") || !code)
  ) {
    if (!lower.includes("github") && !lower.includes("gitlab") && !lower.includes("bitbucket")) {
      return {
        title: "Can't reach the server",
        message: "Check your connection and try again.",
        action: "retry",
      }
    }
  }

  // A disconnected or revoked third-party grant.
  if (
    /bad credentials|invalid_token|token expired|connection (has )?expired|no longer valid|not connected/i.test(message) ||
    ((status === 401 || code === "UNAUTHORIZED") && /github|gitlab|bitbucket|google/i.test(message))
  ) {
    const provider = /github/i.test(message)
      ? "GitHub"
      : /gitlab/i.test(message)
        ? "GitLab"
        : /bitbucket/i.test(message)
          ? "Bitbucket"
          : /google/i.test(message)
            ? "Google"
            : "provider"
    return {
      title: `${provider} connection expired`,
      message: `Reconnect your ${provider} account to continue.`,
      action: "reconnect",
    }
  }

  switch (code) {
    case "UNAUTHORIZED":
      return {
        title: "Signed out",
        message: "Your session has ended. Sign in again to continue.",
        action: "signin",
      }
    case "FORBIDDEN":
      return {
        title: "Not allowed",
        message: "You don't have permission to do that.",
      }
    case "NOT_FOUND":
      return { title: "Not found", message: "That item no longer exists." }
    case "TIMEOUT":
      return { title: "Timed out", message: "That took too long. Try again.", action: "retry" }
    case "TOO_MANY_REQUESTS":
      return {
        title: "Slow down",
        message: "Too many requests. Wait a moment and try again.",
        action: "retry",
      }
    case "PRECONDITION_FAILED":
    case "BAD_REQUEST":
    case "CONFLICT":
      // These carry deliberate, human-written server messages.
      if (looksHumanReadable(message)) return { title: "Can't continue", message }
      return { title: "Can't continue", message: "That action isn't available right now." }
    case "NOT_IMPLEMENTED":
      return { title: "Coming soon", message: "This feature isn't available yet." }
  }

  if (status && status >= 500) {
    return {
      title: "Something went wrong",
      message: "We hit an error on our end. Try again in a moment.",
      action: "retry",
    }
  }

  if (looksHumanReadable(message)) {
    return { title: "Something went wrong", message }
  }

  return {
    title: "Something went wrong",
    message: "Please try again. If it keeps happening, contact support.",
    action: "retry",
  }
}

/** Single-line message for toasts. */
export function getFriendlyMessage(error: unknown): string {
  return getFriendlyError(error).message
}
