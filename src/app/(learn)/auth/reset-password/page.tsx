"use client";
import Link from "next/link";
import { AuthCard } from "@/components/auth/AuthUI";
import { PasswordForm } from "@/components/auth/PasswordForm";
export default function ResetPasswordPage() {
  return (
    <AuthCard title="Choose a new password">
      <PasswordForm />
      <Link href="/auth/callback" className="mt-6 block text-cyan-200">
        Continue to DevPath
      </Link>
    </AuthCard>
  );
}
