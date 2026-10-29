"use client";
import Link from "next/link";
import { useState } from "react";
import { accountRequest, authClient } from "@/lib/auth/browser";
import { authError } from "@/lib/auth/policy";
import {
  inputClass,
  Notice,
  PasswordField,
  primaryClass,
  secondaryClass,
} from "./AuthUI";

export function PasswordForm({
  hasPassword = false,
  onSaved,
}: {
  hasPassword?: boolean;
  onSaved?: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  return (
    <form
      method="post"
      className="space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const values = new FormData(form);
        setBusy(true);
        setError("");
        setMessage("");
        try {
          if (values.get("password") !== values.get("confirmPassword"))
            throw new Error("Passwords do not match.");
          await accountRequest({
            action: "password",
            password: values.get("password"),
            currentPassword: values.get("currentPassword") || undefined,
            nonce: values.get("nonce") || undefined,
          });
          form.reset();
          setMessage("Password saved.");
          await onSaved?.();
        } catch (e) {
          setError(authError(e));
        } finally {
          setBusy(false);
        }
      }}
    >
      {hasPassword && (
        <PasswordField
          label="Current password (if required)"
          name="currentPassword"
          required={false}
        />
      )}
      <PasswordField label="New password" newPassword />
      <p className="text-xs text-white/60">Use 12–128 characters.</p>
      <PasswordField
        label="Confirm new password"
        name="confirmPassword"
        newPassword
      />
      <details className="text-sm text-white/70">
        <summary className="cursor-pointer">
          Password change asks for an email code?
        </summary>
        <button
          type="button"
          className={`${secondaryClass} my-3`}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              const { error } = await authClient().auth.reauthenticate();
              if (error) throw error;
              setMessage("Check your email for the password change code.");
            } catch (e) {
              setError(authError(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          Send password change code
        </button>
        <label className="block">
          Email code
          <input
            className={inputClass}
            name="nonce"
            autoComplete="one-time-code"
          />
        </label>
      </details>
      <button className={primaryClass} disabled={busy}>
        {" "}
        {busy ? "Saving…" : "Save password"}
      </button>
      <Notice error={error} message={message} />
      <Link href="/forgot-password" className="block text-sm text-cyan-200">
        Reset an unknown password by email
      </Link>
    </form>
  );
}
