import { test, expect } from "@playwright/test";
import { seEssentials } from "../../src/content/courses/se-essentials";
import {
  applySimulationAction,
  simulationView,
  startSimulation,
} from "../../src/lib/learning/simulation/engine";
import { deterministicSimulationFeedback } from "../../src/lib/learning/simulation/evaluate";
import type { LearningActivity } from "../../src/lib/learning/registry";
import type { SimulationConfig } from "../../src/lib/learning/simulation/schema";

const simulationBlock = seEssentials.lessons
  .find((lesson) => lesson.id === "requirements")!
  .blocks.find((block) => block.activityType === "simulation")! as Extract<
  LearningActivity,
  { activityType: "simulation" }
>;
const simulationConfig = simulationBlock.config as SimulationConfig;

test("a static simulation works as local practice without writing records", async ({
  page,
}) => {
  let writes = 0;
  page.on("request", (request) => {
    if (
      request.url().includes("/api/simulations") &&
      request.method() !== "GET"
    ) {
      writes += 1;
    }
  });
  await page.goto("/courses/se-essentials/requirements");
  await page.getByRole("button", { name: "Begin simulation" }).click();
  await expect(
    page.getByRole("heading", { name: "Choose the first move" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /Ship a shared availability view/ })
    .click();
  await expect(page.getByText("Step 1 of 5", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Committed scope", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: /Release the shared view and measure the queue/,
    })
    .click();
  await expect(page.getByText("Goal reached", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Try again", exact: true }),
  ).toBeVisible();
  expect(writes).toBe(0);
});

test("a server-backed simulation resumes after reload and accepts only action ids", async ({
  page,
}) => {
  const bodies: Record<string, unknown>[] = [];
  let started = false;
  let state = startSimulation(simulationConfig);
  let history: ReturnType<typeof applySimulationAction>["event"][] = [];
  const response = () => ({
    session: simulationView(simulationConfig, state, history),
    ...(state.status === "completed"
      ? {
          feedback: deterministicSimulationFeedback(
            simulationConfig,
            state,
            history,
          ),
        }
      : {}),
    saved: true,
  });
  await page.route("**/api/simulations**", async (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({ json: started ? response() : { session: null } });
    }
    const body = route.request().postDataJSON() as Record<string, unknown>;
    bodies.push(body);
    if (body.action === "start") {
      started = true;
      return route.fulfill({ json: response() });
    }
    if (body.action === "restart") {
      state = startSimulation(simulationConfig);
      history = [];
      return route.fulfill({ json: response() });
    }
    if (!started || state.status === "completed") {
      return route.fulfill({ json: response() });
    }
    const next = applySimulationAction(
      simulationConfig,
      state,
      String(body.choiceId),
    );
    state = next.state;
    history = [...history, next.event];
    return route.fulfill({ json: response() });
  });

  await page.goto("/courses/se-essentials/requirements");
  await page.getByRole("button", { name: "Begin simulation" }).click();
  await page
    .getByRole("button", { name: /Ship a shared availability view/ })
    .click();
  await expect(page.getByText("Step 1 of 5", { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByText("Step 1 of 5", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Before the pilot" }),
  ).toBeVisible();

  await page
    .getByRole("button", {
      name: /Release the shared view and measure the queue/,
    })
    .click();
  await expect(page.getByText("Goal reached", { exact: true })).toBeVisible();

  expect(bodies.length).toBeGreaterThanOrEqual(3);
  for (const body of bodies) {
    expect(Object.keys(body).sort()).toEqual(
      body.choiceId
        ? ["action", "activityId", "choiceId", "courseId", "lessonId"]
        : ["action", "activityId", "courseId", "lessonId"],
    );
    expect(JSON.stringify(body)).not.toMatch(
      /outcome|variables|score|stageId|step/,
    );
  }
});

test("public demonstration courses retain their lesson pages", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: "Learn anything. By doing.",
    }),
  ).toBeVisible();
  const courseLink = page.locator('a[href^="/courses/"]').first();
  await courseLink.click();
  await page.locator('a[href^="/courses/"]').first().click();
  await expect(page.getByText("AI Tutor", { exact: true })).toBeVisible();
});
test("unauthenticated write APIs fail closed without database configuration", async ({
  request,
}) => {
  for (const path of ["courses", "builder", "activities", "enrolments"]) {
    const res = await request.post(`/api/${path}`, { data: {} });
    expect([401, 403, 503]).toContain(res.status());
  }
});
// UI integration fixtures exercise the actual React builder. Cloud AI and
// Supabase are mocked explicitly; SQL permissions are tested separately.

test("legacy studio links enter the guarded teaching workspace", async ({
  page,
}) => {
  await page.goto("/studio");
  await expect(page).not.toHaveURL(/\/studio$/);
  await expect(
    page.getByRole("heading", {
      name: "Welcome back",
    }),
  ).toBeVisible();
});

// The base branch now requires authentication before workspace onboarding.
// Authenticated preference saves are covered by tests/auth-e2e/account.spec.ts.
test("guest onboarding requires sign-in and keeps teaching intention", async ({
  page,
}) => {
  await page.goto("/onboarding?intent=teach");
  await expect(
    page.getByRole("heading", { name: "How do you want to use DevPath?" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Sign in to continue" }),
  ).toHaveAttribute("href", "/login?next=%2Fonboarding%3Fintent%3Dteach");
  await expect(page.getByLabel(/Display name/)).not.toBeVisible();
});

test("guest onboarding retains legacy preferences until sign-in", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "learner-profile",
      JSON.stringify({
        displayName: "Old learner",
        background: "cs_graduate",
        experience: "comfortable",
        goal: "career",
        language: "zh",
      }),
    );
  });
  await page.goto("/onboarding");
  await expect(
    page.getByRole("link", { name: "Sign in to continue" }),
  ).toBeVisible();
  const stored = await page.evaluate(() =>
    JSON.parse(window.localStorage.getItem("learner-profile") ?? "{}"),
  );
  expect(stored).toMatchObject({
    displayName: "Old learner",
    background: "cs_graduate",
    experience: "comfortable",
    goal: "career",
    language: "zh",
  });
});

test("course-level preferences stay scoped to one course", async ({ page }) => {
  await page.goto("/courses/se-essentials");
  await page.getByText("Make the tutor fit this course").click();
  await page.getByText("New to this subject", { exact: true }).click();
  await page.getByText("Understand new concepts", { exact: true }).click();
  await page.getByRole("button", { name: "Save for this course" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Saved for this course.",
  );
  await expect(
    page.getByText(
      "Optional. Your level here is saved for this course only. Preferences set.",
    ),
  ).toBeVisible();

  await page.goto("/courses/ai-coding-agents");
  await expect(
    page.getByText(
      "Optional. Your level here is saved for this course only. Preferences set.",
    ),
  ).not.toBeVisible();
  await page.getByText("Make the tutor fit this course").click();
  await page.getByText("Some experience", { exact: true }).click();
  await page.getByRole("button", { name: "Save for this course" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Saved for this course.",
  );

  await page.goto("/courses/se-essentials");
  await page.getByText("Make the tutor fit this course").click();
  await expect(
    page.getByRole("radio", { name: "New to this subject" }),
  ).toBeChecked();
});

test("guest private workspaces require login", async ({ page }) => {
  for (const path of ["/dashboard", "/my-courses"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login\?next=/);
    await expect(
      page.getByRole("heading", { name: "Welcome back" }),
    ).toBeVisible();
  }
});
