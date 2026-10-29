import type { SupabaseClient, User } from "@supabase/supabase-js";
import { HttpError } from "@/lib/http-error";
import { recentlyAuthenticated, requiresMfa } from "./policy";

export async function verifiedClaims(db: SupabaseClient) {
  const { data, error } = await db.auth.getClaims();
  if (error || !data) throw new HttpError(401, "Sign in again to continue.");
  return data.claims;
}

export async function assertMfa(db: SupabaseClient, user: User) {
  const claims = await verifiedClaims(db);
  if (requiresMfa(user, claims.aal))
    throw new HttpError(
      403,
      "MFA_REQUIRED: Verify your authenticator code to continue.",
    );
  return claims;
}

export async function requireRecentAuthentication(
  db: SupabaseClient,
  user: User,
) {
  const claims = await assertMfa(db, user);
  if (!recentlyAuthenticated(claims.amr))
    throw new HttpError(
      403,
      "REAUTHENTICATION_REQUIRED: Sign in again, then retry within five minutes.",
    );
}

export async function credentialState(db: SupabaseClient) {
  const { data, error } = await db.rpc("account_security_state");
  if (error || !data || typeof data.has_password !== "boolean")
    throw new HttpError(
      503,
      "Account security is unavailable. Apply the account management migration and retry.",
    );
  return data as { has_password: boolean; setup_reviewed: boolean };
}

export async function listPasskeys(db: SupabaseClient) {
  const { data, error } = await db.auth.passkey.list();
  if (
    error?.code === "passkey_disabled" ||
    error?.status === 404 ||
    error?.status === 501
  )
    return { passkeys: [], passkeysEnabled: false };
  if (error) throw new HttpError(503, "Could not load passkeys. Please retry.");
  return { passkeys: data ?? [], passkeysEnabled: true };
}
