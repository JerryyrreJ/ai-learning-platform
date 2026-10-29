import { requireAccount, apiError, HttpError } from "@/lib/supabase/server";

export type AccountPayload = {
  id: string;
  email: string | null;
  emailVerified: boolean;
  role: string;
  isTeacher: boolean;
  onboardingCompleted: boolean;
  intendedWorkspace: "learn" | "teach" | null;
};

async function loadAccount() {
  const { db, user, isTeacher } = await requireAccount();
  const { data: profile, error } = await db
    .from("profiles")
    .select("role, onboarding_completed_at, intended_workspace")
    .eq("id", user.id)
    .single();
  if (error || !profile) throw new HttpError(403, "Your profile is unavailable.");

  const intended =
    profile.intended_workspace === "learn" || profile.intended_workspace === "teach"
      ? profile.intended_workspace
      : null;

  const payload: AccountPayload = {
    id: user.id,
    email: user.email ?? null,
    emailVerified: !!user.email_confirmed_at,
    role: profile.role,
    isTeacher,
    onboardingCompleted: !!profile.onboarding_completed_at,
    intendedWorkspace: intended,
  };
  return payload;
}

export async function GET() {
  try {
    return Response.json(await loadAccount());
  } catch (e) {
    return apiError(e);
  }
}

/** Complete first-time intention onboarding without changing roles by itself. */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as {
      intention?: unknown;
      displayName?: unknown;
    } | null;
    const intention = body?.intention;
    if (intention !== "learn" && intention !== "teach") {
      throw new HttpError(400, "Choose whether you are here to learn or to teach.");
    }

    const { db, user } = await requireAccount();
    const displayName =
      typeof body?.displayName === "string" ? body.displayName.trim().slice(0, 40) : "";

    const updates: Record<string, unknown> = {
      intended_workspace: intention,
      onboarding_completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    if (displayName) updates.display_name = displayName;

    const { error } = await db.from("profiles").update(updates).eq("id", user.id);
    if (error) throw error;

    if (intention === "teach") {
      const { error: activateError } = await db.rpc("activate_instructor");
      if (activateError) {
        const message = activateError.message ?? "";
        if (/confirm your email/i.test(message)) {
          throw new HttpError(403, "Confirm your email before activating Teaching Studio.");
        }
        throw activateError;
      }
    }

    return Response.json(await loadAccount());
  } catch (e) {
    return apiError(e);
  }
}
