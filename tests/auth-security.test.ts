import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import {
  accountDestination,
  authError,
  canDeletePasskey,
  recentlyAuthenticated,
  requiresMfa,
  sameOriginMutation,
} from "../src/lib/auth/policy";

const user = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
test("routing checks MFA, trusted credentials, then workspace onboarding", () => {
  const ready = {
    hasPassword: true,
    passkeyCount: 0,
    setupReviewed: true,
    onboardingCompleted: true,
  };
  assert.equal(accountDestination("/teach?course=1", ready), "/teach?course=1");
  assert.equal(accountDestination("//evil.test", ready), "/");
  assert.match(
    accountDestination("/teach", { ...ready, mfaRequired: true }),
    /^\/auth\/mfa/,
  );
  assert.match(
    accountDestination("/teach", { ...ready, hasPassword: false }),
    /^\/auth\/setup/,
  );
  assert.equal(
    accountDestination("/teach", { ...ready, setupReviewed: false }),
    "/teach",
  );
  assert.match(
    accountDestination("/teach", { ...ready, onboardingCompleted: false }),
    /^\/onboarding/,
  );
  assert.equal(
    accountDestination("/teach", {
      ...ready,
      hasPassword: false,
      passkeyCount: 1,
    }),
    "/teach",
  );
});
test("reauthentication uses signed AMR timestamps, never token refresh time", () => {
  assert.equal(
    recentlyAuthenticated([{ method: "password", timestamp: 990 }], 1000),
    true,
  );
  assert.equal(
    recentlyAuthenticated([{ method: "oauth", timestamp: 600 }], 1000),
    false,
  );
  assert.equal(
    recentlyAuthenticated([{ method: "anonymous", timestamp: 999 }], 1000),
    false,
  );
  assert.equal(
    recentlyAuthenticated([{ method: "password", timestamp: 2000 }], 1000),
    false,
  );
  assert.equal(recentlyAuthenticated(["password"], 1000), false);
  // Supabase records a just-confirmed signup link as "email/signup".
  assert.equal(
    recentlyAuthenticated([{ method: "email/signup", timestamp: 990 }], 1000),
    true,
  );
  assert.equal(
    requiresMfa({ factors: [{ status: "verified" }] }, "aal1"),
    true,
  );
  assert.equal(
    requiresMfa({ factors: [{ status: "unverified" }] }, "aal1"),
    false,
  );
  assert.equal(
    requiresMfa({ factors: [{ status: "verified" }] }, "aal2"),
    false,
  );
  assert.equal(canDeletePasskey(false), false);
  assert.equal(canDeletePasskey(true), true);
  assert.match(authError({ name: "NotAllowedError" }), /cancelled/);
  assert.match(authError({ code: "passkey_disabled" }), /password instead/);
  assert.match(
    authError({ code: "webauthn_credential_not_found" }),
    /not registered/,
  );
});

test("all migrations: authoritative password state, MFA RLS and definer RPCs retain ownership and role boundaries", async () => {
  const db = new PGlite();
  try {
    await db.exec(readFileSync("scripts/pg-auth-shim.sql", "utf8"));
    await db.exec(`alter table auth.users add column encrypted_password text;
      create table auth.webauthn_credentials(id uuid primary key,user_id uuid references auth.users(id));
      create table auth.mfa_factors (id uuid primary key, user_id uuid references auth.users(id), status text);
      create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;`);
    await db.exec("revoke all on auth.users from anon, authenticated;");
    for (const file of readdirSync("supabase/migrations")
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
    await db.exec(`insert into auth.users (id,email,email_confirmed_at,encrypted_password) values
      ('${user}','github@example.test',now(),'random-unknown-hash'), ('${other}','password@example.test',now(),'test-hash');`);
    async function as(id: string, aal: string, sql: string) {
      await db.exec(
        `set role authenticated; select set_config('request.jwt.claim.sub','${id}',false); select set_config('request.jwt.claims','{"sub":"${id}","aal":"${aal}"}',false);`,
      );
      try {
        return await db.exec(sql);
      } finally {
        await db.exec("reset role");
      }
    }
    let result = await as(
      user,
      "aal1",
      "select public.account_security_state() as state",
    );
    assert.deepEqual(result[0].rows[0].state, {
      has_password: false,
      credential_ready: false,
      passkey_count: 0,
      setup_reviewed: false,
    });
    // Other users cannot be queried; there is no caller-selected id argument.
    await assert.rejects(
      as(user, "aal1", `select public.account_security_state('${other}')`),
      /does not exist/,
    );
    await assert.rejects(
      as(user, "aal1", "select encrypted_password from auth.users"),
      /permission denied/,
    );
    await as(
      user,
      "aal1",
      "update public.profiles set security_setup_reviewed_at=now() where id=auth.uid()",
    );
    result = await as(
      user,
      "aal1",
      "select public.account_security_state() as state",
    );
    assert.deepEqual(result[0].rows[0].state, {
      has_password: false,
      credential_ready: false,
      passkey_count: 0,
      setup_reviewed: true,
    });
    result = await as(
      other,
      "aal1",
      "select public.account_security_state() as state",
    );
    assert.equal(
      (result[0].rows[0].state as { has_password: boolean }).has_password,
      false,
    );
    // Nonempty hashes and mutable profile metadata cannot establish trust.
    await assert.rejects(
      as(
        user,
        "aal1",
        `select public.confirm_password_credential('${user}','forged')`,
      ),
      /permission denied/,
    );
    await assert.rejects(
      as(user, "aal1", "select * from private.password_credentials"),
      /permission denied/,
    );
    for (const sql of [
      "select public.activate_instructor()",
      "select public.claim_course_invitations()",
      "select public.consume_ai_quota('tutor',60,3600)",
    ])
      await assert.rejects(as(user, "aal1", sql), /Credential setup/);
    const empty = await as(
      user,
      "aal1",
      "select * from public.lesson_progress",
    );
    assert.equal(empty[0].rows.length, 0);
    await assert.rejects(
      as(
        user,
        "aal1",
        "insert into public.activity_events(user_id,course_id,event_type) values(auth.uid(),'demo','open')",
      ),
      /row-level security/,
    );
    await db.exec(
      `set role service_role; select public.confirm_password_credential('${other}',public.password_credential_version('${other}')); reset role;`,
    );
    result = await as(
      other,
      "aal1",
      "select public.account_security_state() as state",
    );
    assert.equal(
      (result[0].rows[0].state as { has_password: boolean }).has_password,
      true,
    );
    const oldVersion = (
      await db.query<{ version: string }>(
        `select private.password_credential_version('${other}') as version`,
      )
    ).rows[0].version;
    // An out-of-band native Auth password reset invalidates the old proof.
    await db.exec(
      `update auth.users set encrypted_password='rotated-random' where id='${other}'`,
    );
    result = await as(
      other,
      "aal1",
      "select public.account_security_state() as state",
    );
    assert.equal(
      (result[0].rows[0].state as { has_password: boolean }).has_password,
      false,
    );
    await db.exec(
      `set role service_role; select public.confirm_password_credential('${other}',public.password_credential_version('${other}')); reset role;`,
    );
    await db.exec("set role service_role");
    const staleProof = await db.query<{ confirmed: boolean }>(
      "select public.confirm_password_credential($1,$2) as confirmed",
      [other, oldVersion],
    );
    await db.exec("reset role");
    assert.equal(staleProof.rows[0].confirmed, false);
    // Live native passkey registration independently establishes readiness.
    await db.exec(
      `insert into auth.webauthn_credentials values ('90000000-0000-4000-8000-000000000001','${user}')`,
    );
    result = await as(
      user,
      "aal1",
      "select public.account_security_state() as state",
    );
    assert.equal(
      (result[0].rows[0].state as { credential_ready: boolean })
        .credential_ready,
      true,
    );
    await as(user, "aal1", "select public.activate_instructor()");
    await db.exec(
      `insert into auth.mfa_factors values ('10000000-0000-4000-8000-000000000001','${user}','verified')`,
    );
    result = await as(user, "aal1", "select * from public.profiles");
    assert.equal(result[0].rows.length, 0);
    for (const sql of [
      "select public.activate_instructor()",
      "select public.claim_course_invitations()",
      "select public.consume_ai_quota('tutor',60,3600)",
      "select public.account_security_state()",
    ])
      await assert.rejects(
        as(user, "aal1", sql),
        /MFA required|Credential setup/,
      );
    await assert.rejects(
      as(
        user,
        "aal1",
        "insert into public.activity_events(user_id,course_id,event_type) values(auth.uid(),'demo','open')",
      ),
      /row-level security/,
    );
    result = await as(user, "aal2", "select * from public.profiles");
    assert.equal(result[0].rows.length, 1);
    assert.equal(result[0].rows[0].role, "instructor");
    await assert.rejects(
      as(
        user,
        "aal2",
        "update public.profiles set role='admin' where id=auth.uid()",
      ),
      /permission|administrator/,
    );
    result = await as(other, "aal1", "select id from public.profiles");
    assert.deepEqual(result[0].rows, [{ id: other }]);
    await db.exec(
      `delete from auth.webauthn_credentials where user_id='${user}'`,
    );
    result = await as(
      user,
      "aal2",
      "select public.account_security_state() as state",
    );
    assert.equal(
      (result[0].rows[0].state as { credential_ready: boolean })
        .credential_ready,
      false,
    );
    await assert.rejects(
      as(user, "aal2", "select public.consume_ai_quota('tutor',60,3600)"),
      /Credential setup/,
    );
    await db.exec("set role anon");
    await assert.rejects(
      db.exec("select public.account_security_state()"),
      /permission denied/,
    );
    await db.exec("reset role");
  } finally {
    await db.close();
  }
});

test("cookie mutations require JSON and the browser origin must match the routed host", () => {
  const make = (headers: Record<string, string>) =>
    new Request("http://0.0.0.0:3000/api/account", { headers });
  const valid = {
    origin: "https://devpath.example",
    host: "devpath.example",
    "content-type": "application/json",
  };
  assert.equal(sameOriginMutation(make(valid)), true);
  assert.equal(
    sameOriginMutation(make({ ...valid, origin: "https://evil.example" })),
    false,
  );
  assert.equal(
    sameOriginMutation(make({ ...valid, "sec-fetch-site": "cross-site" })),
    false,
  );
  assert.equal(
    sameOriginMutation(make({ ...valid, "content-type": "text/plain" })),
    false,
  );
  assert.equal(sameOriginMutation(make({ host: "devpath.example" })), false);
});
