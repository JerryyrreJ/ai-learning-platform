import { getSupabase } from "@/lib/supabase/client";
import { safeNextPath } from "./redirect";
import { authError } from "./policy";

export function nextPath() {
  return safeNextPath(new URLSearchParams(window.location.search).get("next"));
}
export function callbackUrl(next = nextPath()) {
  return `${window.location.origin}/auth/callback?${new URLSearchParams({ next: safeNextPath(next) })}`;
}
export function authClient() {
  const client = getSupabase();
  if (!client)
    throw new Error("Accounts aren't enabled on this deployment yet.");
  return client;
}
export async function registerPasskey() {
  if (!window.isSecureContext || !window.PublicKeyCredential)
    throw new Error(
      "Passkeys require a supported browser and HTTPS (or localhost). Use a password instead.",
    );
  await accountRequest({ action: "authorizeCredential" });
  const { error } = await authClient().auth.registerPasskey();
  if (error) throw new Error(authError(error));
}
export async function signInWithPasskey() {
  if (!window.isSecureContext || !window.PublicKeyCredential)
    throw new Error(
      "This browser cannot use passkeys. Use a password instead.",
    );
  const { error } = await authClient().auth.signInWithPasskey();
  if (error) throw new Error(authError(error));
}
export async function accountRequest(body?: object) {
  const res = await fetch(
    "/api/account",
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : { cache: "no-store" },
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Account request failed.");
  return data;
}
export async function finishSignIn(next = nextPath()) {
  const res = await fetch(
    `/api/account/destination?${new URLSearchParams({ next })}`,
    { cache: "no-store" },
  );
  const data = await res.json();
  if (!res.ok)
    throw new Error(data.error ?? "Could not finish sign in. Please retry.");
  window.location.replace(safeNextPath(data.destination));
}
