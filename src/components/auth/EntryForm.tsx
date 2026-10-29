"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  authClient,
  callbackUrl,
  finishSignIn,
  nextPath,
  signInWithPasskey,
} from "@/lib/auth/browser";
import { authError } from "@/lib/auth/policy";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import {
  AuthCard,
  inputClass,
  Notice,
  PasswordField,
  primaryClass,
  secondaryClass,
} from "./AuthUI";

export function EntryForm({ mode }: { mode: "login" | "signup" | "reset" }) {
  const [target, setTarget] = useState("/");
  useEffect(() => {
    setTarget(nextPath());
  }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  async function run(work: () => Promise<void>) {
    setError("");
    setMessage("");
    setBusy(true);
    try {
      await work();
    } catch (e) {
      setError(authError(e));
    } finally {
      setBusy(false);
    }
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email")).trim();
    const password = String(form.get("password") ?? "");
    await run(async () => {
      const auth = authClient().auth;
      if (mode === "reset") {
        const { error } = await auth.resetPasswordForEmail(email, {
          redirectTo: callbackUrl("/auth/reset-password"),
        });
        if (error) throw error;
        setMessage(
          "If an account exists for this email, you'll receive a password reset link. Open it in this browser.",
        );
      } else if (mode === "signup") {
        if (password !== form.get("confirmPassword"))
          throw new Error("Passwords do not match.");
        const { data, error } = await auth.signUp({
          email,
          password,
          options: { emailRedirectTo: callbackUrl() },
        });
        if (error) throw error;
        if (data.session) await finishSignIn();
        else
          setMessage(
            "Check your email to confirm your account, then continue in this browser. If you already have an account, sign in or reset your password.",
          );
      } else {
        const { error } = await auth.signInWithPassword({ email, password });
        if (error) throw error;
        await finishSignIn();
      }
    });
  }
  function entryHref(path: string) {
    return `${path}?next=${encodeURIComponent(target)}`;
  }
  return (
    <AuthCard
      title={
        mode === "login"
          ? "Welcome back"
          : mode === "signup"
            ? "Create your account"
            : "Reset your password"
      }
    >
      {!isSupabaseConfigured && (
        <p className="mb-4 text-sm text-white/60">
          Accounts aren&apos;t enabled on this deployment yet.
        </p>
      )}
      <form method="post" onSubmit={submit} className="space-y-4">
        <label className="block text-sm text-white/80">
          Email
          <input
            name="email"
            type="email"
            autoComplete="email"
            required
            className={inputClass}
            placeholder="you@example.com"
          />
        </label>
        {mode !== "reset" && <PasswordField newPassword={mode === "signup"} />}
        {mode === "signup" && (
          <>
            <p className="text-xs text-white/50">Use at least 12 characters.</p>
            <PasswordField
              label="Confirm password"
              name="confirmPassword"
              newPassword
            />
          </>
        )}
        <button
          disabled={busy || !isSupabaseConfigured}
          className={`${primaryClass} w-full`}
          type="submit"
        >
          {busy
            ? "Please wait…"
            : mode === "login"
              ? "Sign in"
              : mode === "signup"
                ? "Sign up"
                : "Send reset link"}
        </button>
      </form>
      {mode === "login" && (
        <Link
          className="mt-4 block text-center text-sm text-cyan-200"
          href={entryHref("/forgot-password")}
        >
          Forgot password?
        </Link>
      )}
      {mode !== "reset" && (
        <>
          <div className="my-6 flex items-center gap-3 text-xs text-white/40">
            <span className="h-px flex-1 bg-white/15" />
            or continue with
            <span className="h-px flex-1 bg-white/15" />
          </div>
          <div className={mode === "login" ? "grid grid-cols-2 gap-3" : "grid"}>
            <button
              className={secondaryClass}
              disabled={busy || !isSupabaseConfigured}
              onClick={() =>
                void run(async () => {
                  const { error } = await authClient().auth.signInWithOAuth({
                    provider: "github",
                    options: { redirectTo: callbackUrl() },
                  });
                  if (error) throw error;
                })
              }
            >
              GitHub
            </button>
            {mode === "login" && (
              <button
                className={secondaryClass}
                disabled={busy || !isSupabaseConfigured}
                onClick={() =>
                  void run(async () => {
                    await signInWithPasskey();
                    await finishSignIn();
                  })
                }
              >
                Passkey
              </button>
            )}
          </div>
        </>
      )}
      <Notice error={error} message={message} />
      <p className="mt-6 text-center text-sm text-white/60">
        {mode === "login" ? (
          <>
            New to DevPath?{" "}
            <Link className="text-cyan-200" href={entryHref("/signup")}>
              Sign up
            </Link>
          </>
        ) : (
          <Link className="text-cyan-200" href={entryHref("/login")}>
            Back to sign in
          </Link>
        )}
      </p>
    </AuthCard>
  );
}
