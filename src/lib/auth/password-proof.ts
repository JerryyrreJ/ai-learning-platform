import { createClient, type User } from "@supabase/supabase-js";
import { recordDb } from "@/lib/supabase/server";
import { HttpError } from "@/lib/http-error";

/** Only Supabase verifies the password. The short-lived proof session never
 * replaces the user's SSR/MFA session and is revoked locally afterwards. */
export async function confirmPasswordOwnership(user: User, password: string) {
  if (!user.email || !user.email_confirmed_at)
    throw new HttpError(403, "Confirm your email before verifying a password.");
  const admin = recordDb();
  // Snapshot BEFORE verification; a concurrent password change cannot make an
  // old password proof attest a different hash. This fingerprint stays server-only.
  const { data: version, error: versionError } = await admin.rpc(
    "password_credential_version",
    { p_user_id: user.id },
  );
  if (versionError || !version)
    throw new HttpError(503, "Password verification storage is unavailable.");
  const proof = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  );
  const { data, error } = await proof.auth.signInWithPassword({
    email: user.email,
    password,
  });
  try {
    if (error || data.user?.id !== user.id || !data.session)
      throw new HttpError(
        400,
        "The password could not be verified. Try again or set a new password.",
      );
    const { data: confirmed, error: confirmError } = await admin.rpc(
      "confirm_password_credential",
      { p_user_id: user.id, p_version: version },
    );
    if (confirmError || confirmed !== true)
      throw new HttpError(
        409,
        "Your password changed during verification. Please verify again.",
      );
  } finally {
    if (data.session) await proof.auth.signOut({ scope: "local" });
  }
}
