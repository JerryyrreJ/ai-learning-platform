import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/auth-e2e",
  timeout: 45000,
  expect: { timeout: 10000 },
  workers: 1,
  use: {
    baseURL: "http://localhost:3101",
    headless: true,
    launchOptions: {
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
        ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
        : {}),
      args: ["--no-sandbox"],
    },
  },
  webServer: [
    {
      command: "node tests/fixtures/auth-server.mjs",
      url: "http://127.0.0.1:54329/__test/state",
      reuseExistingServer: false,
    },
    {
      command:
        process.env.DEVPATH_AUTH_E2E_SKIP_BUILD === "1"
          ? "npm run start -- --hostname 0.0.0.0 --port 3101"
          : "npm run build && npm run start -- --hostname 0.0.0.0 --port 3101",
      timeout: 180000,
      url: "http://localhost:3101/login",
      reuseExistingServer: false,
      env: {
        DEVPATH_AUTH_E2E: "1",
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54329",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "fixture-publishable-key",
        SUPABASE_SERVICE_ROLE_KEY: "fixture-service-key",
      },
    },
  ],
});
