import { serverDb, HttpError, apiError } from "@/lib/supabase/server";
import { credentialState, verifiedClaims } from "@/lib/auth/security";
import { accountDestination, requiresMfa } from "@/lib/auth/policy";
import { safeNextPath } from "@/lib/auth/redirect";

export async function GET(request: Request) {
  try {
    const next = safeNextPath(new URL(request.url).searchParams.get("next"));
    const db = await serverDb();
    if (!db) throw new HttpError(503, "Accounts are unavailable.");
    const { data, error } = await db.auth.getUser();
    if (error || !data.user) throw new HttpError(401, "Sign in to continue.");
    const claims = await verifiedClaims(db);
    if (requiresMfa(data.user, claims.aal))
      return Response.json({
        destination: `/auth/mfa?next=${encodeURIComponent(next)}`,
      });
    // Recovery must remain reachable before security setup or onboarding.
    if (next === "/auth/reset-password")
      return Response.json({ destination: next });
    const [state, profile] = await Promise.all([
      credentialState(db),
      db
        .from("profiles")
        .select("onboarding_completed_at")
        .eq("id", data.user.id)
        .single(),
    ]);
    if (profile.error)
      throw new HttpError(503, "Your profile is unavailable. Please retry.");
    return Response.json({
      destination: accountDestination(next, {
        hasPassword: state.has_password,
        passkeyCount: state.passkey_count,
        setupReviewed: state.setup_reviewed,
        onboardingCompleted: !!profile.data.onboarding_completed_at,
      }),
    });
  } catch (e) {
    return apiError(e);
  }
}
