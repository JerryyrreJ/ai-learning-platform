"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { Factor, PasskeyListItem } from "@supabase/supabase-js";
import {
  AuthCard,
  inputClass,
  Notice,
  primaryClass,
  secondaryClass,
} from "@/components/auth/AuthUI";
import { PasswordForm } from "@/components/auth/PasswordForm";
import {
  accountRequest,
  authClient,
  registerPasskey,
  callbackUrl,
} from "@/lib/auth/browser";
import { useLearner } from "@/lib/learner-store";
import { authError } from "@/lib/auth/policy";

type Account = {
  displayName: string;
  email: string;
  pendingEmail?: string;
  emailVerified: boolean;
  hasPassword: boolean;
  passkeysEnabled: boolean;
  canDeletePasskey: boolean;
  passkeys: PasskeyListItem[];
  factors: Factor[];
};
type Enrollment = {
  id: string;
  totp: { qr_code: string; secret: string; uri: string };
};

export default function AccountPage() {
  const { refreshProfile } = useLearner();
  const [loading, setLoading] = useState(true);
  const [account, setAccount] = useState<Account | null>(null);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function load() {
    setLoading(true);
    try {
      setAccount(await accountRequest());
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load().catch((e) => setError(authError(e)));
  }, []);
  async function run(work: () => Promise<void>, success?: string) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await work();
      await load();
      if (success) setMessage(success);
    } catch (e) {
      setError(authError(e));
    } finally {
      setBusy(false);
    }
  }
  const enabled =
    account?.factors.filter(
      (f) => f.factor_type === "totp" && f.status === "verified",
    ) ?? [];
  return (
    <AuthCard title="Account Settings">
      <Notice error={error} message={message} />
      <div className="mb-6 rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/65">
        Sensitive changes require a sign-in within the last five minutes and
        your authenticator code when 2FA is enabled.
        <Link href="/login?next=/account" className="mt-2 block text-cyan-200">
          Sign in again
        </Link>
        <button
          disabled={busy || !account}
          className="mt-2 text-cyan-200"
          onClick={() =>
            void run(async () => {
              const { error } = await authClient().auth.signInWithOtp({
                email: account!.email,
                options: {
                  shouldCreateUser: false,
                  emailRedirectTo: callbackUrl("/account"),
                },
              });
              if (error) throw error;
            }, "Check your current email for a recovery sign-in link. Open it in this browser.")
          }
        >
          Send a recovery sign-in link
        </button>
      </div>
      {!account && loading ? (
        <p role="status">Loading account…</p>
      ) : !account ? (
        <button className={secondaryClass} onClick={() => void run(load)}>
          Retry loading account
        </button>
      ) : (
        <>
          <section
            aria-labelledby="profile-title"
            className="space-y-5 border-t border-white/15 py-6"
          >
            <h2 id="profile-title" className="text-xl font-semibold">
              Profile
            </h2>
            <form
              method="post"
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                const values = new FormData(event.currentTarget);
                void run(async () => {
                  await accountRequest({
                    action: "profile",
                    displayName: values.get("displayName"),
                  });
                  await refreshProfile();
                }, "Display name saved.");
              }}
            >
              <label className="block text-sm">
                Display Name
                <input
                  className={inputClass}
                  name="displayName"
                  defaultValue={account.displayName}
                  required
                  maxLength={40}
                />
              </label>
              <button className={secondaryClass} disabled={busy}>
                Save name
              </button>
            </form>
            <p className="break-all text-sm text-white/70">
              Current email: {account.email} ·{" "}
              {account.emailVerified ? "Confirmed" : "Unconfirmed"}
            </p>
            {account.pendingEmail && (
              <p className="text-sm text-amber-200">
                Pending confirmation: {account.pendingEmail}
              </p>
            )}
            <form
              method="post"
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                const values = new FormData(event.currentTarget);
                void run(async () => {
                  await accountRequest({
                    action: "email",
                    email: values.get("email"),
                  });
                }, "Check both your current and new inboxes for confirmation instructions. Your current email remains active until confirmation.");
              }}
            >
              <label className="block text-sm">
                New email
                <input
                  className={inputClass}
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                />
              </label>
              <button className={secondaryClass} disabled={busy}>
                Change email
              </button>
            </form>
            <Link href="/onboarding" className="block text-sm text-cyan-200">
              Learning preferences & workspace
            </Link>
          </section>
          <section
            aria-labelledby="security-title"
            className="space-y-6 border-t border-white/15 pt-6"
          >
            <h2 id="security-title" className="text-xl font-semibold">
              Security
            </h2>
            <div>
              <h3 className="mb-3 font-medium">
                Password · {account.hasPassword ? "Set" : "Not verified — set or verify your password"}
              </h3>
              <PasswordForm hasPassword={account.hasPassword} onSaved={load} />
            </div>
            <div className="space-y-3 border-t border-white/15 pt-5">
              <h3 className="font-medium">
                Passkeys · {account.passkeys.length} registered
              </h3>
              {!account.passkeysEnabled && (
                <p className="text-sm text-amber-200">
                  Passkeys are unavailable on this deployment. You can use a
                  password.
                </p>
              )}
              {!account.canDeletePasskey && (
                <p className="text-xs text-white/60">
                  Set a password before removing passkeys to keep a recovery
                  credential available.
                </p>
              )}
              {account.passkeys.map((key) => (
                <div
                  className="rounded-xl border border-white/15 p-3"
                  key={key.id}
                >
                  <p className="text-xs text-white/50">
                    Added {new Date(key.created_at).toLocaleDateString()}
                    {key.last_used_at
                      ? ` · Last used ${new Date(key.last_used_at).toLocaleDateString()}`
                      : ""}
                  </p>
                  <form
                    method="post"
                    className="mt-2 space-y-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const values = new FormData(event.currentTarget);
                      void run(async () => {
                        await accountRequest({
                          action: "renamePasskey",
                          id: key.id,
                          name: values.get("name"),
                        });
                      }, "Passkey renamed.");
                    }}
                  >
                    <label className="block text-xs">
                      Passkey name
                      <input
                        className={inputClass}
                        name="name"
                        defaultValue={key.friendly_name || "Passkey"}
                        maxLength={120}
                        required
                      />
                    </label>
                    <div className="flex gap-2">
                      <button disabled={busy} className={secondaryClass}>
                        Rename
                      </button>
                      <button
                        disabled={busy || !account.canDeletePasskey}
                        className={secondaryClass}
                        type="button"
                        onClick={() => {
                          if (
                            window.confirm(
                              "Remove this passkey? Your password will remain available.",
                            )
                          )
                            void run(async () => {
                              await accountRequest({
                                action: "deletePasskey",
                                id: key.id,
                              });
                            }, "Passkey removed.");
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </form>
                </div>
              ))}
              <button
                disabled={
                  busy || !account.emailVerified || !account.passkeysEnabled
                }
                className={secondaryClass}
                onClick={() => void run(registerPasskey, "Passkey added.")}
              >
                Add Passkey
              </button>
            </div>
            <div className="space-y-3 border-t border-white/15 pt-5">
              <h3 className="font-medium">
                Authenticator app (TOTP) ·{" "}
                {enabled.length ? "Enabled" : "Not enabled"}
              </h3>
              <p className="text-xs text-white/60">
                Keep access to your authenticator. Add and verify a replacement
                before removing the old one. If all authenticators are lost,
                contact an administrator for identity-verified recovery.
              </p>
              {enabled.map((factor) => (
                <div
                  key={factor.id}
                  className="flex flex-wrap items-center gap-3"
                >
                  <span className="text-sm">
                    {factor.friendly_name || "Authenticator app"}
                  </span>
                  <button
                    disabled={busy}
                    className={secondaryClass}
                    onClick={() => {
                      if (
                        window.confirm(
                          "Remove this authenticator? Removing the last one disables two-factor authentication.",
                        )
                      )
                        void run(async () => {
                          await accountRequest({
                            action: "unenroll",
                            id: factor.id,
                          });
                          const { error } =
                            await authClient().auth.refreshSession();
                          if (error) throw error;
                        }, "Authenticator removed.");
                    }}
                  >
                    Remove authenticator
                  </button>
                </div>
              ))}
              {!enrollment && (
                <button
                  disabled={busy}
                  className={secondaryClass}
                  onClick={() =>
                    void run(async () => {
                      setEnrollment(
                        await accountRequest({ action: "enrollTotp" }),
                      );
                    })
                  }
                >
                  {enabled.length
                    ? "Add replacement authenticator"
                    : "Enable 2FA"}
                </button>
              )}
              {enrollment && (
                <div className="space-y-4 rounded-xl border border-white/15 p-4">
                  <p className="text-sm">
                    Scan the QR code, then enter your app&apos;s code. 2FA is
                    enabled only after verification.
                  </p>
                  {/* Supabase SVG is isolated as an image, never inserted as HTML. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    alt="Authenticator setup QR code"
                    width={200}
                    height={200}
                    className="rounded bg-white p-2"
                    src={
                      enrollment.totp.qr_code.startsWith("data:")
                        ? enrollment.totp.qr_code
                        : `data:image/svg+xml;utf8,${encodeURIComponent(enrollment.totp.qr_code)}`
                    }
                  />
                  <p className="break-all text-xs">
                    Manual setup key: <code>{enrollment.totp.secret}</code>
                  </p>
                  <form
                    method="post"
                    className="space-y-3"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const values = new FormData(event.currentTarget);
                      void run(async () => {
                        const { error } =
                          await authClient().auth.mfa.challengeAndVerify({
                            factorId: enrollment.id,
                            code: String(values.get("code")),
                          });
                        if (error) throw error;
                        setEnrollment(null);
                      }, "Two-factor authentication enabled.");
                    }}
                  >
                    <label className="block text-sm">
                      Verification code
                      <input
                        className={inputClass}
                        name="code"
                        required
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        pattern="[0-9]{6}"
                        maxLength={6}
                      />
                    </label>
                    <button disabled={busy} className={primaryClass}>
                      Verify and enable
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      className={`${secondaryClass} ml-2`}
                      onClick={() =>
                        void run(async () => {
                          await accountRequest({
                            action: "unenroll",
                            id: enrollment.id,
                          });
                          setEnrollment(null);
                        })
                      }
                    >
                      Cancel
                    </button>
                  </form>
                </div>
              )}
              {account.factors
                .filter(
                  (f) =>
                    f.factor_type === "totp" &&
                    f.status === "unverified" &&
                    f.id !== enrollment?.id,
                )
                .map((factor) => (
                  <button
                    key={factor.id}
                    disabled={busy}
                    className={`${secondaryClass} block`}
                    onClick={() =>
                      void run(async () => {
                        await accountRequest({
                          action: "unenroll",
                          id: factor.id,
                        });
                      }, "Unfinished setup removed.")
                    }
                  >
                    Remove unfinished authenticator setup
                  </button>
                ))}
            </div>
          </section>
        </>
      )}
    </AuthCard>
  );
}
