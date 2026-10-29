import { safeNextPath } from "./redirect";

/** Never use token refresh time (iat) as evidence of reauthentication. */
export function recentlyAuthenticated(amr: unknown, now = Date.now() / 1000) {
  return (
    Array.isArray(amr) &&
    amr.some(
      (entry) =>
        entry &&
        typeof entry === "object" &&
        [
          "password",
          "oauth",
          "otp",
          "magiclink",
          "email/signup",
          "recovery",
          "passkey",
          "webauthn",
          "totp",
          "mfa/totp",
        ].includes(entry.method) &&
        typeof entry.timestamp === "number" &&
        entry.timestamp <= now + 30 &&
        entry.timestamp >= now - 300,
    )
  );
}

export function requiresMfa(
  user: { factors?: { status: string }[] },
  aal: unknown,
) {
  return (
    user.factors?.some((factor) => factor.status === "verified") === true &&
    aal !== "aal2"
  );
}

/** Conservative deletion rule: a password is non-removable in this app. This
 * avoids races between simultaneous deletes of two remaining passkeys. */
export function canDeletePasskey(hasPassword: boolean) {
  return hasPassword;
}

export function accountDestination(
  next: unknown,
  state: {
    mfaRequired?: boolean;
    hasPassword: boolean;
    passkeyCount: number;
    setupReviewed: boolean;
    onboardingCompleted: boolean;
  },
) {
  const safe = safeNextPath(next);
  // Do not return to a completed intermediate auth step.
  const target = [
    "/auth/setup",
    "/auth/mfa",
    "/auth/callback",
    "/login",
    "/signup",
  ].includes(safe.split("?")[0])
    ? "/"
    : safe;
  const suffix = `?next=${encodeURIComponent(target)}`;
  if (state.mfaRequired) return `/auth/mfa${suffix}`;
  if ((!state.hasPassword && state.passkeyCount === 0) || !state.setupReviewed)
    return `/auth/setup${suffix}`;
  return state.onboardingCompleted ? target : `/onboarding${suffix}`;
}

export function authError(error: unknown) {
  const e = error as { code?: string; name?: string; message?: string };
  if (
    e?.name === "NotAllowedError" ||
    /cancel|not allowed|timed out/i.test(e?.message ?? "")
  )
    return "Passkey request cancelled or timed out. Try again, or use a password instead.";
  if (e?.code === "passkey_disabled")
    return "Passkeys are not enabled on this deployment. Use a password instead.";
  if (e?.code === "webauthn_credential_not_found")
    return "This passkey is not registered. Choose another passkey or sign in with your password.";
  if (e?.name === "NotSupportedError")
    return "This browser does not support passkeys. Use a password instead.";
  if (e?.code === "email_not_confirmed")
    return "Confirm your email before continuing.";
  return e?.message || "Something went wrong. Please try again.";
}

/** Next may use its internal bind address for request.url behind a proxy. The
 * browser Origin must match the routed Host, not that internal address. */
export function sameOriginMutation(request: Request) {
  try {
    const origin = new URL(request.headers.get("origin") ?? "");
    return (
      ["https:", "http:"].includes(origin.protocol) &&
      origin.host === request.headers.get("host") &&
      request.headers.get("sec-fetch-site") !== "cross-site" &&
      request.headers.get("content-type")?.split(";")[0].trim() ===
        "application/json"
    );
  } catch {
    return false;
  }
}
