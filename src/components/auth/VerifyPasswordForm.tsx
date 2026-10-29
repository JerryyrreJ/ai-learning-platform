"use client";
import { useState } from "react";
import { accountRequest } from "@/lib/auth/browser";
import { authError } from "@/lib/auth/policy";
import { Notice, PasswordField, secondaryClass } from "./AuthUI";
export function VerifyPasswordForm({
  onVerified,
}: {
  onVerified: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <form
      method="post"
      className="space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        setBusy(true);
        setError("");
        try {
          await accountRequest({
            action: "verifyPassword",
            password: data.get("password"),
          });
          await onVerified();
        } catch (e) {
          setError(authError(e));
        } finally {
          setBusy(false);
        }
      }}
    >
      <PasswordField label="Existing password" />
      <button className={secondaryClass} disabled={busy}>
        {busy ? "Verifying…" : "Verify existing password"}
      </button>
      <Notice error={error} />
    </form>
  );
}
