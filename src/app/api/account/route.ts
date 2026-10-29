import { confirmPasswordOwnership } from "@/lib/auth/password-proof";
import { z } from "zod";
import {
  apiError,
  HttpError,
  requireAuthenticatedAccount,
} from "@/lib/supabase/server";
import {
  credentialState,
  listPasskeys,
  requireRecentAuthentication,
} from "@/lib/auth/security";
import { canDeletePasskey, sameOriginMutation } from "@/lib/auth/policy";

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("profile"),
    displayName: z.string().trim().min(1).max(40),
  }),
  z.object({ action: z.literal("email"), email: z.email() }),
  z.object({
    action: z.literal("verifyPassword"),
    password: z.string().min(1).max(128),
  }),
  z.object({
    action: z.literal("password"),
    password: z.string().min(12).max(128),
    currentPassword: z.string().optional(),
    nonce: z.string().optional(),
  }),
  z.object({
    action: z.literal("renamePasskey"),
    id: z.uuid(),
    name: z.string().trim().min(1).max(120),
  }),
  z.object({ action: z.literal("deletePasskey"), id: z.uuid() }),
  z.object({ action: z.literal("unenroll"), id: z.uuid() }),
  z.object({ action: z.literal("completeSetup") }),
  z.object({ action: z.literal("authorizeCredential") }),
  z.object({ action: z.literal("enrollTotp") }),
]);

export async function GET() {
  try {
    const { db, user } = await requireAuthenticatedAccount();
    const [state, keys, profile] = await Promise.all([
      credentialState(db),
      listPasskeys(db),
      db.from("profiles").select("display_name").eq("id", user.id).single(),
    ]);
    if (profile.error) throw new HttpError(503, "Your profile is unavailable.");
    return Response.json(
      {
        email: user.email,
        pendingEmail: user.new_email,
        emailVerified: !!user.email_confirmed_at,
        displayName: profile.data.display_name ?? "",
        hasPassword: state.has_password,
        credentialReady: state.credential_ready,
        setupReviewed: state.setup_reviewed,
        ...keys,
        factors: user.factors ?? [],
        canDeletePasskey: canDeletePasskey(state.has_password),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(request: Request) {
  try {
    // JSON + same-origin check also protects cookie-authenticated mutations from CSRF.
    if (!sameOriginMutation(request))
      throw new HttpError(403, "Use this application's account settings.");
    const parsed = actionSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success)
      throw new HttpError(
        400,
        "Check the form values and try again. Passwords need 12–128 characters.",
      );
    const input = parsed.data;
    const { db, user } = await requireAuthenticatedAccount();
    if (input.action !== "profile" && input.action !== "completeSetup")
      await requireRecentAuthentication(db, user);
    let error;
    switch (input.action) {
      case "authorizeCredential":
        break;
      case "enrollTotp": {
        const result = await db.auth.mfa.enroll({
          factorType: "totp",
          friendlyName: `DevPath ${new Date().toISOString()}`,
        });
        if (result.error) throw new HttpError(400, result.error.message);
        return Response.json(result.data, {
          headers: { "Cache-Control": "private, no-store" },
        });
      }
      case "profile":
        ({ error } = await db
          .from("profiles")
          .update({
            display_name: input.displayName,
            updated_at: new Date().toISOString(),
          })
          .eq("id", user.id)
          .select("id")
          .single());
        break;
      case "verifyPassword":
        await confirmPasswordOwnership(user, input.password);
        break;
      case "password":
        ({ error } = await db.auth.updateUser({
          password: input.password,
          ...(input.currentPassword
            ? { current_password: input.currentPassword }
            : {}),
          ...(input.nonce ? { nonce: input.nonce } : {}),
        }));
        if (!error) await confirmPasswordOwnership(user, input.password);
        break;
      case "email":
        ({ error } = await db.auth.updateUser(
          { email: input.email },
          {
            emailRedirectTo: `${request.headers.get("origin")}/auth/callback?next=/account`,
          },
        ));
        break;
      case "renamePasskey":
        ({ error } = await db.auth.passkey.update({
          passkeyId: input.id,
          friendlyName: input.name,
        }));
        break;
      case "deletePasskey": {
        const state = await credentialState(db);
        if (!canDeletePasskey(state.has_password))
          throw new HttpError(
            409,
            "Set a password before deleting passkeys so you always have a recovery credential.",
          );
        ({ error } = await db.auth.passkey.delete({ passkeyId: input.id }));
        break;
      }
      case "unenroll": {
        // getUser is a live lookup, not the potentially stale factors in storage.
        const factor = user.factors?.find((f) => f.id === input.id);
        if (!factor || factor.factor_type !== "totp")
          throw new HttpError(404, "Authenticator not found.");
        ({ error } = await db.auth.mfa.unenroll({ factorId: input.id }));
        break;
      }
      case "completeSetup": {
        const state = await credentialState(db);
        if (!state.credential_ready)
          throw new HttpError(409, "Create a passkey or set a password first.");
        ({ error } = await db
          .from("profiles")
          .update({ security_setup_reviewed_at: new Date().toISOString() })
          .eq("id", user.id)
          .select("id")
          .single());
        break;
      }
    }
    if (error) throw new HttpError(400, error.message);
    return Response.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
