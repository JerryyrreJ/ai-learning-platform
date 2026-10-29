"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  AuthCard,
  Notice,
  primaryClass,
  secondaryClass,
} from "@/components/auth/AuthUI";
import { VerifyPasswordForm } from "@/components/auth/VerifyPasswordForm";
import { PasswordForm } from "@/components/auth/PasswordForm";
import {
  accountRequest,
  finishSignIn,
  nextPath,
  registerPasskey,
} from "@/lib/auth/browser";
import { authError } from "@/lib/auth/policy";

export default function SetupPage() {
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<{
    hasPassword: boolean;
    passkeys: unknown[];
    emailVerified: boolean;
  } | null>(null);
  const [target, setTarget] = useState("/");
  const [password, setPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function load() {
    setLoading(true);
    try {
      setState(await accountRequest());
    } catch (e) {
      setError(authError(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    setTarget(nextPath());
    void load();
  }, []);
  async function complete() {
    await accountRequest({ action: "completeSetup" });
    await finishSignIn();
  }
  return (
    <AuthCard title="Secure your account">
      <p className="mb-6 text-white/65">
        A passkey lets you sign in with your device or password manager. You can
        also use a password.
      </p>
      <Notice error={error} />
      {!state && loading ? (
        <p role="status">Loading account…</p>
      ) : !state ? (
        <button className={secondaryClass} onClick={load}>
          Retry loading account
        </button>
      ) : (
        <>
          {state.hasPassword && (
            <p className="mb-4 text-sm text-emerald-200">
              Your password is already set. Adding a passkey is optional.
            </p>
          )}
          {!state.emailVerified && (
            <p className="mb-4 text-sm text-amber-200">
              Confirm your email before adding a passkey. You can set a password
              now.
            </p>
          )}
          <div className="flex flex-col gap-3">
            <button
              disabled={busy || !state.emailVerified}
              className={primaryClass}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await registerPasskey();
                  await complete();
                } catch (e) {
                  setError(authError(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "Please wait…" : "Create a Passkey"}
            </button>
            <button
              disabled={busy}
              className={secondaryClass}
              onClick={() => setPassword(true)}
            >
              Use a password instead
            </button>
            {(state.hasPassword || state.passkeys.length > 0) && (
              <button
                disabled={busy}
                className={secondaryClass}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await complete();
                  } catch (e) {
                    setError(authError(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Continue
              </button>
            )}
          </div>
          {password && (
            <div className="mt-6">
              {state.hasPassword ? (
                <button
                  className={primaryClass}
                  onClick={() =>
                    void complete().catch((e) => setError(authError(e)))
                  }
                >
                  Continue with existing password
                </button>
              ) : (
                <div className="space-y-6">
                  <PasswordForm onSaved={complete} />
                  <details>
                    <summary className="mb-3 cursor-pointer text-sm text-cyan-200">
                      Already know your password? Verify it instead
                    </summary>
                    <VerifyPasswordForm onVerified={complete} />
                  </details>
                  <Link
                    className="text-sm text-cyan-200"
                    href="/forgot-password"
                  >
                    Recover or reset an unknown password by email
                  </Link>
                </div>
              )}
            </div>
          )}
        </>
      )}
      <p className="mt-6 text-sm text-white/60">
        <Link
          className="text-cyan-200"
          href={`/login?next=${encodeURIComponent(target)}`}
        >
          Sign in again
        </Link>{" "}
        if your security session has expired.
      </p>
    </AuthCard>
  );
}
