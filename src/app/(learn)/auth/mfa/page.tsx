"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  AuthCard,
  inputClass,
  Notice,
  primaryClass,
} from "@/components/auth/AuthUI";
import { authClient, finishSignIn } from "@/lib/auth/browser";
import { authError } from "@/lib/auth/policy";

export default function MfaPage() {
  const [factors, setFactors] = useState<
    { id: string; friendly_name?: string }[]
  >([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void Promise.resolve()
      .then(() => authClient().auth.mfa.listFactors())
      .then(({ data, error }) => {
        if (error) setError(authError(error));
        else if (!data.totp.length)
          setError(
            "No verified authenticator is available. Contact your administrator for recovery.",
          );
        else setFactors(data.totp);
      })
      .catch((e) => setError(authError(e)));
  }, []);
  return (
    <AuthCard title="Two-factor verification">
      <p className="mb-5 text-sm text-white/65">
        Enter the six-digit code from your authenticator app.
      </p>
      <form
        method="post"
        className="space-y-4"
        onSubmit={async (event) => {
          event.preventDefault();
          const values = new FormData(event.currentTarget);
          setBusy(true);
          setError("");
          try {
            const { error } = await authClient().auth.mfa.challengeAndVerify({
              factorId: String(values.get("factor")),
              code: String(values.get("code")),
            });
            if (error) throw error;
            await finishSignIn();
          } catch (e) {
            setError(authError(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="block text-sm">
          Authenticator
          <select className={inputClass} name="factor">
            {factors.map((f) => (
              <option className="bg-zinc-900" value={f.id} key={f.id}>
                {f.friendly_name || "Authenticator app"}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          Verification code
          <input
            className={inputClass}
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            required
          />
        </label>
        <button
          disabled={busy || !factors.length}
          className={`${primaryClass} w-full`}
        >
          {busy ? "Verifying…" : "Verify"}
        </button>
      </form>
      <Notice error={error} />
      <Link className="mt-5 block text-sm text-cyan-200" href="/login">
        Back to sign in
      </Link>
    </AuthCard>
  );
}
