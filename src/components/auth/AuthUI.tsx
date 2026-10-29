"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { glass } from "@/components/home/glass";

export const inputClass =
  "mt-1 w-full rounded-xl border border-white/20 bg-black/25 px-4 py-3 text-white outline-none focus:border-cyan-300 focus:ring-2 focus:ring-cyan-300/20";
export const primaryClass =
  "rounded-full bg-white px-5 py-3 font-medium text-black hover:bg-white/85 disabled:opacity-50";
export const secondaryClass =
  "rounded-full border border-white/25 bg-white/5 px-5 py-3 text-sm font-medium text-white hover:bg-white/10 disabled:opacity-50";
export function AuthCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);
  return (
    <div className="mx-auto max-w-lg px-4 py-14">
      <div className={`${glass} p-7 sm:p-9`}>
        <Link href="/" className="mb-7 flex items-center gap-2 font-semibold">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-cyan-400 via-indigo-500 to-fuchsia-500 text-xs">
            DP
          </span>{" "}
          DevPath
        </Link>
        <h1 className="mb-5 text-3xl font-semibold tracking-tight">{title}</h1>
        <fieldset
          disabled={!hydrated}
          aria-busy={!hydrated}
          className="min-w-0"
        >
          {children}
        </fieldset>
      </div>
    </div>
  );
}
export function PasswordField({
  label = "Password",
  name = "password",
  newPassword = false,
  required = true,
}: {
  label?: string;
  name?: string;
  newPassword?: boolean;
  required?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <label className="block text-sm text-white/80">
      {label}
      <span className="relative block">
        <input
          className={`${inputClass} pr-20`}
          name={name}
          aria-label={label}
          type={visible ? "text" : "password"}
          autoComplete={newPassword ? "new-password" : "current-password"}
          required={required}
          minLength={newPassword ? 12 : undefined}
          maxLength={128}
        />
        <button
          type="button"
          aria-label={`${visible ? "Hide" : "Show"} ${label.toLowerCase()}`}
          onClick={() => setVisible(!visible)}
          className="absolute inset-y-0 right-4 text-xs text-cyan-200"
        >
          {visible ? "Hide" : "Show"}
        </button>
      </span>
    </label>
  );
}
export function Notice({
  error,
  message,
}: {
  error?: string;
  message?: string;
}) {
  return (
    <>
      {error && (
        <p role="alert" className="my-4 text-sm text-rose-200">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="my-4 text-sm text-emerald-200">
          {message}
        </p>
      )}
    </>
  );
}
