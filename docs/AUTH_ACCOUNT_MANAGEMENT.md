# Authentication and account management

Branch: `feat/auth-account-management`. Base: `79a063b` on
`feat/unified-learning-experience`. No production settings or user data were changed.

## Behavior and integration

- `/login`: email/password with password visibility, reset entry, equally weighted
  GitHub and Passkey buttons, signup link. Magic Link remains available only as
  a recovery action inside account settings and through the existing confirmation routes.
- `/signup`: Supabase email/password signup and GitHub OAuth. Email confirmation
  is required by the checked-in local configuration; hosted projects must enable it.
- `/forgot-password` → `/auth/callback?next=/auth/reset-password` supports the PKCE
  recovery flow. The existing POST token-hash confirmation route explicitly sends
  `type=recovery` to the reset page as well. Existing magic-link confirmation is retained.
- All first-factor methods share the destination endpoint: MFA challenge, then
  account security setup, then existing Learn/Teach onboarding, then safe `next`.
  Credential setup does not recreate users, assign roles, or replace learning preferences.
- Account setup recommends Passkey first, with immediate password fallback.
  Password accounts see an optional passkey recommendation and can continue.
  A database timestamp remembers that the recommendation was reviewed. An actual
  password or registered passkey is independently checked before completion.
- `/account` has Profile and Security sections. Names use `profiles.display_name`.
  Email and password changes use `auth.updateUser`; the pending email is shown
  without prematurely replacing the current address. Existing preference entry remains.
- Native Supabase Passkey registration/sign-in/list/rename/delete are used.
  No WebAuthn verification server, credential database or private-key storage is added.
  Cancellation, unsupported browsers, missing credentials and disabled project support
  display errors and leave password fallback available.
- TOTP enrollment shows Supabase's QR code and manual secret, then calls
  `challengeAndVerify`. Unverified factors do not count as enabled. Multiple
  authenticators allow replacement-first reconfiguration. Abandoned enrollments can
  be removed. QR secrets live only in component memory, not application storage/logs.
- Signed AMR timestamps (five minutes), not token refresh `iat`, gate sensitive app
  mutations and credential enrollment (Passkey preflight and server-side TOTP enrollment). MFA is enforced by middleware, `requireAccount`, restrictive RLS, and
  the existing definer RPCs that otherwise bypass RLS. User metadata and localStorage
  are never used to establish password presence, MFA assurance, or teacher authority.

## Database migration

Review/apply `supabase/migrations/20261029120001_auth_account_management.sql`
first in a separate staging/local project. It was generated using the Supabase CLI,
then ordered after the base branch's future-dated `20261029120000` migration.

The migration adds a profile recommendation timestamp, an invoker RPC backed by
narrow private helpers, restrictive MFA policies on the ten existing application
tables, and MFA checks inside invitation claiming, instructor activation and quota
RPCs. Existing ownership/role policies are retained. No migration is applied to a
connected project by this implementation.

`account_security_state()` accepts no user id. It reads only the current user's
password existence and recommendation timestamp. Its private helper reads
`auth.users.encrypted_password` to return a boolean; it never returns the hash or
writes `auth.users`. An email identity does not imply a password exists. Helper
execution grants and empty search paths are explicit; anonymous callers cannot
invoke the security-state RPC. New tables/RPCs added later must include equivalent
MFA enforcement.

## Deletion and platform boundaries

The app deliberately requires a password before **any** passkey deletion, even if
several passkeys or GitHub are present. There is no password removal or OAuth unlink
operation. This conservative policy avoids a check/count/delete race between two
requests deleting the last two keys. Both the UI and server enforce it.

Supabase's native authenticated Auth endpoints remain publicly reachable with the
publishable key and a user token. App-level recent-authentication and deletion
policies are not a project-wide Auth API firewall: a caller using those native
endpoints directly is governed by Supabase's own policies. In particular, the
upstream passkey delete handler does not currently enforce the application's
last-credential rule. This implementation does not install unsupported triggers in
the managed Auth credential tables or claim to enforce an upstream invariant.
Confirmed email recovery remains available. If an absolute project-wide prohibition
on native last-passkey deletion is required, upstream Auth support/a supported Auth
policy is a release prerequisite; do not describe the app guard as that guarantee.

TOTP loss has no automatic bypass. Before enabling for real users, establish an
administrator process that verifies identity before native factor recovery. No
recovery codes or MFA WebAuthn feature is claimed by this release.

## Manual Supabase configuration (not performed)

1. Apply/review the migration in staging. Run Supabase security/performance advisors
   there. The local PGlite checks below do not substitute for hosted advisors.
2. Keep the same Supabase project, existing GitHub provider, user identities,
   publishable/anon key and server-only service role environment variable.
   No secret receives a `NEXT_PUBLIC_` prefix.
3. Enable Email signup/password login and **Confirm email**. Use a minimum password
   length of at least 12. Enable **Secure password change** (nonce reauthentication)
   and **Secure email change** (confirmation at both addresses). Configure SMTP and
   verify signup, recovery, reauthentication and email-change delivery/rate limits.
   If enforcing current-password changes, test recovery and OAuth-to-password setup
   with that setting as well; the UI supports current password and email nonce.
4. Enable **Authentication → Passkeys** on the hosted project. Set RP display name
   to DevPath. Choose the stable bare RP ID yourself, with no scheme, port or path.
   Do not change it after enrollment: existing passkeys become unusable.
   Add exact HTTPS application origins (maximum five); each hostname must match or
   be below the RP ID. Independent preview domains may require a separate staging
   project. No production domain was guessed or configured.
5. Enable TOTP enrollment and verification under MFA. Both are needed. Do not enable
   MFA WebAuthn to implement first-factor Passkey login.
6. Set Site URL and Auth redirect allowlist for the actual application callback,
   including supported `next` queries. Retain all existing necessary redirects.
   Restrict production entries to your actual domain/callback paths; review Supabase
   glob matching when adding development URLs. GitHub's OAuth app continues to use
   the Supabase provider callback URL, not the app account page.
7. Keep confirmation templates compatible with the existing POST confirmation route
   or Supabase's normal ConfirmationURL → PKCE callback. The recovery token-hash
   route recognizes `type=recovery`. Test both old links and new email flows.

`supabase/config.toml` enables these features **only for local development**:
RP `localhost`, origins `http://localhost:3000` and `http://localhost:3100`, TOTP,
email confirmation, secure password change, and minimum password length 12.
Use `localhost` for local WebAuthn, not `127.0.0.1` with the localhost RP ID.
Deploying application code does not apply this TOML to an existing hosted project.

## Verification commands

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
npm run test:auth-e2e
```

Authentication E2E starts an isolated Next production build in `.next-auth-e2e`
and a loopback-only Supabase **protocol fixture** with test-only values. It does
not require production credentials or modify a Supabase project. Install Playwright
Chromium first (`npx playwright install chromium`), or set
`PLAYWRIGHT_CHROMIUM_EXECUTABLE` to a compatible local Chromium binary. No fixture
URL/key is saved to `.env` or application deployment configuration.

PGlite runs the entire migration chain and tests caller-only password-state access,
MFA RLS and definer RPC enforcement, and retained ownership/role boundaries.
The browser fixture does not implement cryptographic WebAuthn verification or
SMTP/OAuth services. Virtual-authenticator tests exercise native browser ceremonies
and SDK integration against mocked Auth responses, not real Supabase verification.

## Required real-project acceptance

Use staging with separate student, GitHub-only, legacy magic-link and teacher
accounts. Record user ids, course ownership, enrollment, attempts and progress
before testing; verify they remain unchanged afterwards.

1. Signup with a password, confirm in the same browser, skip optional passkey,
   choose Learn/Teach, and preserve a deep course/activity `next`. Re-login and
   verify setup does not repeat. Test duplicate signup and invalid/expired links.
2. Sign in through real GitHub and an old magic link. Add a password to the same
   user id. Separately add a passkey with no password and complete onboarding.
   Cancel/reject the prompt and repeat with an unsupported browser; choose password.
3. Test Apple Passwords, 1Password, Windows Hello and a YubiKey, including multiple
   keys and another device. Re-login with each. Test wrong RP/origin, no matching
   credential, disabled support and expired challenge. None is claimed validated here.
4. Rename the profile, check the avatar/name updates immediately and after reload, request an email change,
   confirm both emails, and sign in with the new address. Change password with
   recent authentication, an old session, current-password requirements and nonce.
5. Request a real password reset, open the callback and token-hash variants,
   verify MFA still applies when enabled, set a new password and re-login.
6. Enroll TOTP: wrong code must not enable it; correct code must. Log out and test
   password, GitHub and Passkey logins. Before TOTP verification, direct app APIs,
   PostgREST reads/writes and definer RPCs must reject/provide no protected data.
   Challenge, add a replacement, verify it, then remove the old factor. Test refresh
   and revoked sessions, stale tabs, cancellation and abandoned enrollment cleanup.
7. Without a password, attempt passkey deletion through both app UI and API: block.
   Set a password and delete keys concurrently: password login/recovery must survive.
   Separately assess the native Auth endpoint limitation above before release.
8. Re-test student/instructor/admin role boundaries, private courses, teacher
   activation, grading/progress writes and existing public catalogue/guest practice.

## References checked

- https://supabase.com/changelog (including current breaking-change entries)
- https://supabase.com/docs/guides/auth/passkeys
- https://supabase.com/docs/guides/auth/passwords
- https://supabase.com/docs/guides/auth/password-security
- https://supabase.com/docs/guides/auth/auth-mfa
- https://supabase.com/docs/guides/auth/auth-mfa/totp
- https://supabase.com/docs/guides/auth/redirect-urls
- https://github.com/supabase/auth/blob/master/internal/api/passkey_manage.go

The current guide calls Passkeys Experimental and describes the explicit
`auth.experimental.passkey` opt-in and minimum SDK 2.105.0. The pinned, installed
`supabase-js` 2.118.0 / `auth-js` types say that flag is now ignored because Passkeys
are enabled by default. It is still set explicitly for compatibility; SDK types,
not invented declarations, are used. Both Supabase SDK dependencies are pinned.

## Changed areas

| Area | Files |
| --- | --- |
| Auth and account pages | `src/app/(learn)/login/page.tsx`, `signup/page.tsx`, `forgot-password/page.tsx`, `account/page.tsx`, `auth/setup/page.tsx`, `auth/mfa/page.tsx`, `auth/reset-password/page.tsx`, `auth/callback/page.tsx`, `auth/confirm/verify/route.ts` |
| Shared form controls | `src/components/auth/AuthUI.tsx`, `EntryForm.tsx`, `PasswordForm.tsx` |
| Account server operations | `src/app/api/account/route.ts`, `src/app/api/account/destination/route.ts` |
| Session and authorization | `src/middleware.ts`, `src/lib/auth/browser.ts`, `policy.ts`, `security.ts`, `src/lib/http-error.ts`, `src/lib/supabase/client.ts`, `server.ts` |
| Navigation and profile state | `src/components/NavBar.tsx`, `src/components/home/PublicSurface.tsx`, `src/lib/learner-store.tsx` |
| Local Auth and SQL | `supabase/config.toml`, `supabase/migrations/20261029120001_auth_account_management.sql` |
| Tests | `tests/auth-security.test.ts`, `tests/auth-e2e/account.spec.ts`, `tests/fixtures/auth-server.mjs`, `playwright.auth.config.ts`, `tests/e2e/platform.spec.ts`, `tests/e2e/restoration.spec.ts` |
| Tooling and setup docs | `README.md`, `package.json`, `package-lock.json`, `next.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `.gitignore` |

The existing E2E expectations still referred to an older landing page and anonymous
onboarding. They now assert the base branch's actual landing/guest behavior;
authenticated preference-save and legacy-profile migration coverage lives in the
new Auth fixture suite instead of bypassing the current authentication requirement.

## Results for this implementation (2026-10-29)

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed |
| `npm test` | 88 passed; includes the complete migration-chain/RLS test |
| `npm run build` | Passed with normal/unconfigured local environment |
| `npm run test:e2e` | 16 passed against the normal production build |
| `npm run test:auth-e2e` | 13 passed against the isolated production fixture build |
| `git diff --check` | Passed |

Playwright used an external local Chromium executable because the environment's
standard browser download returned a truncated archive. That browser package is
not added to application dependencies. The Auth fixture build itself succeeded;
the final test-only locator correction was rerun with
`DEVPATH_AUTH_E2E_SKIP_BUILD=1` to reuse that unchanged application build. Normally
the Auth suite builds its isolated production bundle automatically.

Real Supabase email delivery, live GitHub authorization, WebAuthn signature
verification, Apple Passwords/1Password/Windows Hello/YubiKey compatibility and
hosted security advisors were **not** validated. Complete the staging acceptance
above before release. No production migration, Auth configuration or deployment
was performed, and no PR was created.
