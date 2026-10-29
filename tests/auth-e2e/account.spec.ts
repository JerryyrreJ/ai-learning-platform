import { test, expect, type Page } from "@playwright/test";
const fixture = "http://127.0.0.1:54329";
async function signIn(page: Page, mode = "existing", next = "/account") {
  await page.request.post(`${fixture}/__test/reset`, { data: { mode } });
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  if (
    [
      "passkey",
      "expired",
      "random",
      "magic",
      "admin",
      "github",
      "random-mfa",
    ].includes(mode)
  ) {
    await page.getByRole("button", { name: "GitHub", exact: true }).click();
    return;
  }
  await page.getByLabel("Email", { exact: true }).fill(`${mode}@example.test`);
  await page.getByLabel("Password", { exact: true }).fill("correct-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

test("password sign-in errors, password visibility, and next context", async ({
  page,
}) => {
  await page.request.post(`${fixture}/__test/reset`, {
    data: { mode: "existing" },
  });
  await page.goto("/login?next=/account");
  const github = page.getByRole("button", { name: "GitHub", exact: true });
  const passkey = page.getByRole("button", { name: "Passkey", exact: true });
  expect((await github.boundingBox())?.width).toBe(
    (await passkey.boundingBox())?.width,
  );
  await page.getByLabel("Email", { exact: true }).fill("existing@example.test");
  await page.getByLabel("Password", { exact: true }).fill("wrong-password");
  await page
    .getByRole("button", { name: "Show password", exact: true })
    .click();
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute(
    "type",
    "text",
  );
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator("p[role=alert]")).toContainText(
    "Invalid login credentials",
  );
  await page.getByLabel("Password", { exact: true }).fill("correct-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/account$/);
});

test("signup confirms by email and reset requests target the reset callback", async ({
  page,
}) => {
  await page.request.post(`${fixture}/__test/reset`, {
    data: { mode: "password" },
  });
  await page.goto("/signup?next=/teach");
  await page.getByLabel("Email", { exact: true }).fill("password@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("a-long-new-password");
  await page
    .getByLabel("Confirm password", { exact: true })
    .fill("a-long-new-password");
  await page.getByRole("button", { name: "Sign up", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Check your email");
  await page.goto("/forgot-password");
  await page.getByLabel("Email", { exact: true }).fill("password@example.test");
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("status")).toContainText("If an account exists");
  const state = await (
    await page.request.get(`${fixture}/__test/state`)
  ).json();
  expect(
    state.calls.find((c: { path: string }) => c.path === "/auth/v1/recover"),
  ).toBeTruthy();
});

test("GitHub's existing identity adds a password after a cancelled passkey", async ({
  page,
}) => {
  await page.request.post(`${fixture}/__test/reset`, {
    data: { mode: "github" },
  });
  await page.goto("/login?next=/account");
  await page.getByRole("button", { name: "GitHub", exact: true }).click();
  await expect(page).toHaveURL(/\/auth\/setup/);
  await page.evaluate(() => {
    navigator.credentials.create = async () => {
      throw new DOMException("Cancelled", "NotAllowedError");
    };
  });
  await page.getByRole("button", { name: "Create a Passkey" }).click();
  await expect(page.locator("p[role=alert]")).toContainText(
    /cancelled|password instead/i,
  );
  await page.getByRole("button", { name: "Use a password instead" }).click();
  await page
    .getByLabel("New password", { exact: true })
    .fill("a-long-new-password");
  await page
    .getByLabel("Confirm new password", { exact: true })
    .fill("a-long-new-password");
  await page
    .getByRole("button", { name: "Save password", exact: true })
    .click();
  await expect(page).toHaveURL(/\/onboarding/);
  const state = await (
    await page.request.get(`${fixture}/__test/state`)
  ).json();
  expect(state.password).toBe(true);
  expect(state.reviewed).toBe(true);
});

test("verified password users enter onboarding without resetting their password", async ({
  page,
}) => {
  await signIn(page, "password", "/courses");
  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByRole("button", { name: /I'm here to learn/ }).click();
  await expect(
    page.getByRole("heading", { name: "Make learning yours." }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Save preferences", exact: true })
    .click();
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("profile, email, password mutations use authenticated APIs", async ({
  page,
}) => {
  await signIn(page);
  await page.getByLabel("Display Name", { exact: true }).fill("Jerry");
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(page.getByRole("status")).toContainText("Display name saved");
  await page.getByLabel("New email", { exact: true }).fill("new@example.test");
  await page.getByRole("button", { name: "Change email" }).click();
  await expect(
    page.getByText("Pending confirmation: new@example.test"),
  ).toBeVisible();
  await page
    .getByLabel("New password", { exact: true })
    .fill("a-long-new-password");
  await page
    .getByLabel("Confirm new password", { exact: true })
    .fill("a-long-new-password");
  await page
    .getByRole("button", { name: "Save password", exact: true })
    .click();
  await expect(
    page.getByText("Password saved.", { exact: true }),
  ).toBeVisible();
  const state = await (
    await page.request.get(`${fixture}/__test/state`)
  ).json();
  expect(state.display_name).toBe("Jerry");
  expect(state.email).toBe("existing@example.test");
  await page.screenshot({
    path: "test-results/account-settings.png",
    fullPage: true,
  });
});

test("last passkey deletion and stale authentication are blocked on the server", async ({
  page,
}) => {
  await signIn(page, "passkey");
  await expect(
    page.getByRole("button", { name: "Delete", exact: true }),
  ).toBeDisabled();
  let response = await page.request.post("/api/account", {
    headers: { Origin: "http://localhost:3101" },
    data: {
      action: "deletePasskey",
      id: "10000000-0000-4000-8000-000000000001",
    },
  });
  expect(response.status()).toBe(409);
  await signIn(page, "expired");
  await page.getByLabel("New email", { exact: true }).fill("new@example.test");
  await page.getByRole("button", { name: "Change email" }).click();
  await expect(page.locator("p[role=alert]")).toContainText(
    "REAUTHENTICATION_REQUIRED",
  );
  response = await page.request.post("/api/account", {
    headers: { Origin: "https://evil.test" },
    data: { action: "profile", displayName: "Attack" },
  });
  expect(response.status()).toBe(403);
});

test("MFA blocks API and pages at aal1 and verifies TOTP before continuing", async ({
  page,
}) => {
  await signIn(page, "mfa");
  await expect(page).toHaveURL(/\/auth\/mfa/);
  const response = await page.request.get("/api/account");
  expect(response.status()).toBe(403);
  await page.getByLabel("Verification code", { exact: true }).fill("000000");
  await page.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(page.locator("p[role=alert]")).toContainText("Invalid TOTP");
  await page.getByLabel("Verification code", { exact: true }).fill("123456");
  await page.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(page).toHaveURL(/\/account$/);
});

test("TOTP enrollment is unverified until a correct code and can be removed", async ({
  page,
}) => {
  await signIn(page);
  await page.getByRole("button", { name: "Enable 2FA", exact: true }).click();
  await expect(page.getByAltText("Authenticator setup QR code")).toBeVisible();
  await expect(
    page.getByText("Manual setup key:", { exact: false }),
  ).toContainText("TESTSECRET");
  let state = await (await page.request.get(`${fixture}/__test/state`)).json();
  expect(state.factors[0].status).toBe("unverified");
  await page.getByLabel("Verification code", { exact: true }).fill("123456");
  await page.getByRole("button", { name: "Verify and enable" }).click();
  await expect(
    page.getByRole("heading", { name: "Authenticator app (TOTP) · Enabled" }),
  ).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Remove authenticator", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Authenticator app (TOTP) · Not enabled",
    }),
  ).toBeVisible();
  state = await (await page.request.get(`${fixture}/__test/state`)).json();
  expect(state.factors).toHaveLength(0);
});

test("native SDK registration works with a virtual authenticator and lists/renames/deletes", async ({
  page,
  context,
}) => {
  await signIn(page);
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  await page.getByRole("button", { name: "Add Passkey", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Passkeys · 1 registered" }),
  ).toBeVisible();
  await page.getByLabel("Passkey name", { exact: true }).fill("Work YubiKey");
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Passkey renamed");
  await page.getByLabel("Account menu", { exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.goto("/login?next=/account");
  await page.getByRole("button", { name: "Passkey", exact: true }).click();
  await expect(page).toHaveURL(/\/account$/);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Passkeys · 0 registered" }),
  ).toBeVisible();
});

test("passkey missing and unsupported errors leave password sign-in available", async ({
  page,
}) => {
  await page.request.post(`${fixture}/__test/reset`, {
    data: { mode: "existing" },
  });
  await page.goto("/login?next=/account");
  await page.getByRole("button", { name: "Passkey", exact: true }).click();
  await expect(page.locator("p[role=alert]")).toContainText("not registered");
  await page.evaluate(() => {
    Object.defineProperty(window, "PublicKeyCredential", {
      value: undefined,
      configurable: true,
    });
  });
  await page.getByRole("button", { name: "Passkey", exact: true }).click();
  await expect(page.locator("p[role=alert]")).toContainText(
    "Use a password instead",
  );
  await page.getByLabel("Email", { exact: true }).fill("existing@example.test");
  await page.getByLabel("Password", { exact: true }).fill("correct-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/account$/);
});

test("recovery callback reaches password update before onboarding and rejects external next", async ({
  page,
}) => {
  await signIn(page, "password", "/auth/reset-password");
  await expect(page).toHaveURL(/\/auth\/reset-password$/);
  await page
    .getByLabel("New password", { exact: true })
    .fill("a-recovered-new-password");
  await page
    .getByLabel("Confirm new password", { exact: true })
    .fill("a-recovered-new-password");
  await page
    .getByRole("button", { name: "Save password", exact: true })
    .click();
  await expect(
    page.getByText("Password saved.", { exact: true }),
  ).toBeVisible();
  const response = await page.request.get(
    "/api/account/destination?next=https://evil.test",
  );
  const { destination } = await response.json();
  expect(destination).toMatch(/^\/onboarding\?next=%2F$/);
});

test("authenticated onboarding saves preferences and reloads them from the same profile", async ({
  page,
}) => {
  await signIn(page, "existing", "/onboarding");
  await expect(
    page.getByRole("heading", { name: "Make learning yours." }),
  ).toBeVisible();
  await page.getByLabel(/Display name/).fill("Mei");
  await page.getByText("简体中文", { exact: true }).click();
  await page
    .getByText("Practise and apply what I learn", { exact: true })
    .click();
  await page.getByText("Step-by-step guidance", { exact: true }).click();
  await page
    .getByRole("button", { name: "Save preferences", exact: true })
    .click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto("/onboarding");
  await expect(page.getByLabel(/Display name/)).toHaveValue("Mei");
  await expect(
    page.getByRole("radio", { name: "简体中文", exact: true }),
  ).toBeChecked();
  await expect(
    page.getByRole("radio", { name: "Step-by-step guidance", exact: true }),
  ).toBeChecked();
});

test("authenticated legacy profile preferences migrate without losing background or experience", async ({
  page,
}) => {
  await signIn(page, "legacy", "/onboarding");
  await expect(page.getByLabel(/Display name/)).toHaveValue("Old learner");
  await expect(
    page.getByRole("radio", { name: "繁體中文", exact: true }),
  ).toBeChecked();
  await expect(
    page.getByRole("radio", {
      name: "Build practical or professional skills",
      exact: true,
    }),
  ).toBeChecked();
  await page
    .getByRole("button", { name: "Save preferences", exact: true })
    .click();
  await expect(page).toHaveURL(/\/dashboard$/);
  const state = await (
    await page.request.get(`${fixture}/__test/state`)
  ).json();
  expect(state.preferences.background).toBe("cs_graduate");
  expect(state.preferences.experience).toBe("comfortable");
  expect(state.preferences.language).toBe("zh-Hant");
});

for (const mode of ["random", "magic", "admin"])
  test(`${mode} hash does not bypass credential setup or business authorization`, async ({
    page,
  }) => {
    await signIn(page, mode, "/dashboard");
    await expect(page).toHaveURL(/\/auth\/setup/);
    await expect(
      page.getByRole("button", { name: "Continue", exact: true }),
    ).not.toBeVisible();
    const account = await (await page.request.get("/api/account")).json();
    expect(account.hasPassword).toBe(false);
    for (const path of ["/dashboard", "/teach"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/auth\/setup/);
    }
    for (const path of ["/api/me", "/api/me/attempts"])
      expect((await page.request.get(path)).status()).toBe(403);
    expect(
      (
        await page.request.post("/api/account", {
          headers: { Origin: "http://localhost:3101" },
          data: { action: "completeSetup" },
        })
      ).status(),
    ).toBe(409);
    await page.getByRole("button", { name: "Use a password instead" }).click();
    await expect(
      page.getByLabel("Current password (if required)", { exact: true }),
    ).not.toBeVisible();
    await page
      .getByLabel("New password", { exact: true })
      .fill("my-owned-new-password");
    await page
      .getByLabel("Confirm new password", { exact: true })
      .fill("my-owned-new-password");
    await page
      .getByRole("button", { name: "Save password", exact: true })
      .click();
    await expect(page).toHaveURL(/\/onboarding/);
    expect(
      (await (await page.request.get("/api/account")).json()).hasPassword,
    ).toBe(true);
  });

test("signup email confirmation requires real password ownership, not email/signup AMR alone", async ({
  page,
}) => {
  await page.request.post(`${fixture}/__test/reset`, {
    data: { mode: "signup" },
  });
  await page.goto(
    "/auth/confirm?token_hash=signup-test&type=signup&next=/dashboard",
  );
  await page
    .getByRole("button", { name: "Sign in to DevPath", exact: true })
    .click();
  await expect(page).toHaveURL(/\/auth\/setup/);
  expect(
    (await (await page.request.get("/api/account")).json()).hasPassword,
  ).toBe(false);
  await page.getByRole("button", { name: "Use a password instead" }).click();
  await page
    .getByText("Already know your password? Verify it instead", { exact: true })
    .click();
  await page
    .getByLabel("Existing password", { exact: true })
    .fill("wrong-password");
  await page
    .getByRole("button", { name: "Verify existing password", exact: true })
    .click();
  await expect(page.locator("p[role=alert]")).toContainText(
    "could not be verified",
  );
  await page
    .getByLabel("Existing password", { exact: true })
    .fill("correct-password");
  await page
    .getByRole("button", { name: "Verify existing password", exact: true })
    .click();
  await expect(page).toHaveURL(/\/onboarding/);
});

test("untrusted TOTP account must pass MFA before creating any credential", async ({
  page,
}) => {
  await signIn(page, "random-mfa", "/dashboard");
  await expect(page).toHaveURL(/\/auth\/mfa/);
  await page.goto("/auth/setup");
  await expect(page).toHaveURL(/\/auth\/mfa/);
  expect(
    (
      await page.request.post("/api/account", {
        headers: { Origin: "http://localhost:3101" },
        data: { action: "verifyPassword", password: "correct-password" },
      })
    ).status(),
  ).toBe(403);
  await page.getByLabel("Verification code", { exact: true }).fill("123456");
  await page.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(page).toHaveURL(/\/auth\/setup/);
  expect(
    (await (await page.request.get("/api/account")).json()).hasPassword,
  ).toBe(false);
});
