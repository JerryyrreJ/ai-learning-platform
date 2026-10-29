// Protocol fixture for UI/server integration tests. Never a WebAuthn verifier,
// never used by the application or configured against a real Supabase project.
import { createServer } from "node:http";
import { createHmac, randomUUID } from "node:crypto";
const secret = "devpath-tests-only-not-a-production-secret";
const id = "00000000-0000-4000-8000-000000000001";
const keyId = "10000000-0000-4000-8000-000000000001";
const factorId = "20000000-0000-4000-8000-000000000001";
let state;
function reset(mode = "existing") {
  state = {
    mode,
    email: `${mode}@example.test`,
    password: mode !== "github" && mode !== "passkey",
    trusted: ["existing", "mfa", "expired", "legacy"].includes(mode),
    version: "fixture-hash-v1",
    actualPassword: [
      "github",
      "passkey",
      "random",
      "magic",
      "admin",
      "random-mfa",
    ].includes(mode)
      ? "unknown-random-secret"
      : "correct-password",
    reviewed:
      mode === "existing" ||
      mode === "mfa" ||
      mode === "expired" ||
      mode === "passkey" ||
      mode === "legacy",
    onboarding: ![
      "password",
      "signup",
      "random",
      "magic",
      "admin",
      "github",
      "random-mfa",
    ].includes(mode),
    display_name: mode === "legacy" ? "Old learner" : "Learner",
    preferences: {
      background: mode === "legacy" ? "cs_graduate" : null,
      experience: mode === "legacy" ? "comfortable" : null,
      language: mode === "legacy" ? "zh" : "en",
      goal: mode === "legacy" ? "career" : "understand",
      learning_style: "balanced",
    },
    keys:
      mode === "passkey"
        ? [
            {
              id: keyId,
              friendly_name: "Test device",
              created_at: new Date().toISOString(),
            },
          ]
        : [],
    factors: ["mfa", "random-mfa"].includes(mode)
      ? [
          {
            id: factorId,
            factor_type: "totp",
            status: "verified",
            friendly_name: "Phone",
          },
        ]
      : [],
    calls: [],
    pendingEmail: null,
  };
}
reset();
function user() {
  return {
    id,
    aud: "authenticated",
    role: "authenticated",
    email: state.email,
    email_confirmed_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    app_metadata: { provider: state.mode === "github" ? "github" : "email" },
    user_metadata: {},
    factors: state.factors,
    new_email: state.pendingEmail,
  };
}
function jwt(aal = "aal1", method = "password") {
  const now = Math.floor(Date.now() / 1000);
  const head = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
  ).toString("base64url");
  const body = Buffer.from(
    JSON.stringify({
      sub: id,
      role: "authenticated",
      aud: "authenticated",
      exp: now + 3600,
      iat: now,
      aal,
      amr: [{ method, timestamp: state.mode === "expired" ? now - 3600 : now }],
      session_id: randomUUID(),
    }),
  ).toString("base64url");
  return `${head}.${body}.${createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url")}`;
}
function session(aal = "aal1", method = "password") {
  return {
    access_token: jwt(aal, method),
    refresh_token: "fixture-refresh",
    token_type: "bearer",
    expires_in: 3600,
    user: user(),
  };
}
function claims(req) {
  try {
    const t = req.headers.authorization?.replace("Bearer ", "");
    const [a, b, c] = t.split(".");
    if (
      createHmac("sha256", secret).update(`${a}.${b}`).digest("base64url") !== c
    )
      return null;
    return JSON.parse(Buffer.from(b, "base64url"));
  } catch {
    return null;
  }
}
createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Expose-Headers", "X-Supabase-Api-Version");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  );
  res.setHeader("Content-Type", "application/json");
  res.setHeader("X-Supabase-Api-Version", "2024-01-01");
  if (req.method === "OPTIONS") {
    res.end();
    return;
  }
  const url = new URL(req.url, "http://127.0.0.1:54329");
  let body = {};
  try {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    body = raw ? JSON.parse(raw) : {};
  } catch {}
  function send(data, status = 200) {
    res.statusCode = status;
    res.end(JSON.stringify(data));
  }
  function fail(
    msg = "Invalid login credentials",
    status = 400,
    code = "invalid_credentials",
  ) {
    send({ msg, message: msg, code }, status);
  }
  const path = url.pathname;
  if (path === "/__test/reset") {
    reset(body.mode);
    return send({ ok: true });
  }
  if (path === "/__test/state") return send(state);
  state.calls.push({ path, method: req.method, body });
  if (path === "/auth/v1/token") {
    if (
      url.searchParams.get("grant_type") === "password" &&
      body.password !== state.actualPassword
    )
      return fail();
    return send(
      session(
        "aal1",
        url.searchParams.get("grant_type") === "pkce" ? "oauth" : "password",
      ),
    );
  }
  if (path === "/auth/v1/signup") {
    state.password = true;
    return send({ user: user(), session: null });
  }
  if (
    path === "/auth/v1/recover" ||
    path === "/auth/v1/otp" ||
    path === "/auth/v1/reauthenticate"
  )
    return send({});
  if (path === "/auth/v1/authorize") {
    res.writeHead(302, {
      Location: `${url.searchParams.get("redirect_to")}&code=fixture-oauth-code`,
    });
    return res.end();
  }
  if (path === "/auth/v1/passkeys/authentication/options") {
    if (!state.keys.length)
      return fail("No passkey found", 400, "webauthn_credential_not_found");
    return send({
      challenge_id: randomUUID(),
      options: {
        challenge: Buffer.from("fixture-authentication-challenge").toString(
          "base64url",
        ),
        rpId: "localhost",
        userVerification: "required",
        timeout: 5000,
      },
    });
  }
  if (path === "/auth/v1/passkeys/authentication/verify")
    return send(session("aal1", "passkey"));
  if (path === "/auth/v1/verify")
    return send(
      session(
        "aal1",
        body.type === "signup"
          ? "email/signup"
          : body.type === "recovery"
            ? "recovery"
            : "magiclink",
      ),
    );
  if (
    path === "/rest/v1/rpc/password_credential_version" ||
    path === "/rest/v1/rpc/confirm_password_credential"
  ) {
    if (req.headers.authorization !== "Bearer fixture-service-key")
      return fail("Forbidden", 403);
    if (path.endsWith("password_credential_version"))
      return send(state.version);
    if (body.p_version !== state.version) return send(false);
    state.trusted = true;
    return send(true);
  }
  const c = claims(req);
  if (!c) return fail("Auth session missing", 401, "session_not_found");
  if (path === "/auth/v1/user") {
    if (req.method === "PUT") {
      if (body.password) {
        state.password = true;
        state.actualPassword = body.password;
        state.version += "-changed";
        state.trusted = false;
      }
      if (body.email) state.pendingEmail = body.email;
    }
    return send(user());
  }
  if (path === "/rest/v1/rpc/account_security_state")
    return send({
      has_password: state.trusted,
      passkey_count: state.keys.length,
      credential_ready: state.trusted || state.keys.length > 0,
      setup_reviewed: state.reviewed,
    });
  if (path === "/rest/v1/profiles") {
    if (req.method === "PATCH") {
      if (body.display_name) state.display_name = body.display_name;
      for (const key of [
        "background",
        "experience",
        "language",
        "goal",
        "learning_style",
      ])
        if (key in body) state.preferences[key] = body[key];
      if (body.security_setup_reviewed_at) state.reviewed = true;
      if (body.onboarding_completed_at) state.onboarding = true;
    }
    const row = {
      id,
      display_name: state.display_name,
      ...state.preferences,
      role: "student",
      onboarding_completed_at: state.onboarding
        ? new Date().toISOString()
        : null,
      intended_workspace: "learn",
    };
    return send(req.headers.accept?.includes("vnd.pgrst.object") ? row : [row]);
  }
  if (path === "/auth/v1/passkeys" || path === "/auth/v1/passkeys/")
    return send(state.keys);
  if (path.includes("/passkeys/registration/options"))
    return send({
      challenge_id: randomUUID(),
      options: {
        challenge: Buffer.from("fixture-challenge-for-browser-only").toString(
          "base64url",
        ),
        rp: { name: "DevPath tests", id: "localhost" },
        user: {
          id: Buffer.from(id).toString("base64url"),
          name: state.email,
          displayName: state.display_name,
        },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }],
        authenticatorSelection: {
          residentKey: "required",
          userVerification: "required",
        },
        timeout: 5000,
      },
    });
  if (path.includes("/passkeys/registration/verify")) {
    const key = {
      id: keyId,
      friendly_name: "Test device",
      created_at: new Date().toISOString(),
    };
    state.keys.push(key);
    return send(key);
  }
  if (path.startsWith("/auth/v1/passkeys/")) {
    if (req.method === "DELETE")
      state.keys = state.keys.filter((k) => k.id !== keyId);
    if (req.method === "PATCH")
      state.keys[0].friendly_name = body.friendly_name;
    return send(state.keys[0] ?? null);
  }
  if (path === "/auth/v1/factors" && req.method === "POST") {
    state.factors.push({
      id: factorId,
      factor_type: "totp",
      status: "unverified",
      friendly_name: body.friendly_name,
    });
    return send({
      id: factorId,
      type: "totp",
      totp: {
        qr_code: '<svg xmlns="http://www.w3.org/2000/svg"/>',
        secret: "TESTSECRET",
        uri: "otpauth://totp/DevPath?secret=TESTSECRET",
      },
    });
  }
  if (path.endsWith("/challenge"))
    return send({
      id: "challenge",
      expires_at: Math.floor(Date.now() / 1000) + 300,
    });
  if (path.endsWith("/verify")) {
    if (body.code !== "123456")
      return fail("Invalid TOTP code", 422, "mfa_verification_failed");
    state.factors[0].status = "verified";
    return send(session("aal2", "totp"));
  }
  if (path.startsWith("/auth/v1/factors/") && req.method === "DELETE") {
    state.factors = state.factors.filter((f) => f.id !== factorId);
    return send({ id: factorId });
  }
  if (path === "/auth/v1/logout") {
    res.statusCode = 204;
    return res.end();
  }
  if (path.startsWith("/rest/v1/")) return send([]);
  fail(`Unhandled fixture route: ${path}`, 404);
}).listen(54329, "127.0.0.1", () =>
  process.stdout.write("Auth protocol fixture listening on 54329\n"),
);
