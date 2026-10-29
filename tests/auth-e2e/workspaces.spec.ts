import { test, expect, type Page } from "@playwright/test";
import { exampleCourse } from "../../src/lib/learning/examples";
import { seEssentials } from "../../src/content/courses/se-essentials";
import type { LearningActivity } from "../../src/lib/learning/registry";
const simulationBlock = seEssentials.lessons
  .find((l) => l.id === "requirements")!
  .blocks.find((b) => b.activityType === "simulation")! as Extract<
  LearningActivity,
  { activityType: "simulation" }
>;
async function loginForWorkspace(page: Page) {
  await page.request.post("http://127.0.0.1:54329/__test/reset", {
    data: { mode: "existing" },
  });
  await page.goto("/login?next=/my-courses");
  await page.getByLabel("Email", { exact: true }).fill("existing@example.test");
  await page.getByLabel("Password", { exact: true }).fill("correct-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/my-courses$/);
}

test("teacher preview runs the simulation without calling the server", async ({
  page,
}) => {
  await loginForWorkspace(page);
  const document = exampleCourse("english");
  document.lessons = [
    {
      ...document.lessons[0],
      blocks: [simulationBlock],
    },
  ];
  const row = {
    id: document.id,
    owner_id: "teacher",
    status: "draft",
    visibility: "private",
    revision: 1,
    document,
  };
  let serverCalls = 0;
  page.on("request", (request) => {
    if (request.url().includes("/api/simulations")) serverCalls += 1;
  });
  await page.route("**/api/me", (route) =>
    route.fulfill({ json: { id: "teacher", isTeacher: true } }),
  );
  await page.route("**/api/courses**", (route) => {
    if (route.request().url().includes("learnerImpact")) {
      return route.fulfill({
        json: { attempts: 0, enrolments: 0, progress: 0 },
      });
    }
    return route.fulfill({ json: [row] });
  });
  await page.goto("/my-courses");
  await page.getByRole("button", { name: document.title, exact: true }).click();
  await page
    .getByRole("button", { name: "Student preview", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Choose the first move" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /Ship a shared availability view/ })
    .click();
  await expect(page.getByText("Step 1 of 5", { exact: true })).toBeVisible();
  expect(serverCalls).toBe(0);
});

test("learner edits a private course and reviews an AI change", async ({
  page,
}) => {
  await loginForWorkspace(page);
  let document = exampleCourse("english");
  const row = {
    id: document.id,
    owner_id: "teacher",
    status: "draft",
    visibility: "private",
    revision: 1,
    document,
  };
  await page.route("**/api/me", (r) =>
    r.fulfill({ json: { id: "teacher", isTeacher: true } }),
  );
  await page.route("**/api/courses", async (r) => {
    if (r.request().method() === "GET") return r.fulfill({ json: [row] });
    const body = r.request().postDataJSON();
    document = body.document;
    Object.assign(row, { ...body, revision: row.revision + 1 });
    return r.fulfill({ json: row });
  });
  await page.route("**/api/builder", (r) => {
    const body = r.request().postDataJSON();
    return r.fulfill({
      json: {
        ...body.activity,
        config: {
          ...body.activity.config,
          markdown: "An improved English explanation.",
        },
      },
    });
  });
  await page.goto("/my-courses");
  await page.getByRole("button", { name: document.title, exact: true }).click();
  await page
    .getByLabel("title", { exact: true })
    .fill("English communication workshop");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("Saved revision 2")).toBeVisible();
  await page
    .getByLabel("AI revision request")
    .first()
    .fill("Use simpler English");
  await page
    .getByRole("button", { name: "Propose AI revision" })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Review proposed change" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Reject", exact: true }).click();
  expect(document.lessons[0].blocks[0].activityType).toBe("reading");
  expect(document.title).toBe("English communication workshop");
});

test("student preview supports feedback, revision and separate attempts without saving progress", async ({
  page,
}) => {
  await loginForWorkspace(page);
  const document = exampleCourse("english");
  const row = {
    id: document.id,
    owner_id: "teacher",
    status: "draft",
    visibility: "private",
    revision: 1,
    document,
  };
  const submissions: { preview: boolean; response: string }[] = [];
  await page.route("**/api/me", (r) =>
    r.fulfill({ json: { id: "teacher", isTeacher: true } }),
  );
  await page.route("**/api/courses", (r) => r.fulfill({ json: [row] }));
  await page.route("**/api/activities", (r) => {
    const body = r.request().postDataJSON();
    submissions.push(body);
    return r.fulfill({
      json: {
        response: body.response,
        score: null,
        feedback: {
          summary: "Your proposed handoff addresses the schedule.",
          criteria: [
            {
              criterion: "A feasible compromise",
              assessment: "developing",
              evidence: body.response,
              suggestion: "Specify the handoff time.",
            },
          ],
          nextStep: "Add a concrete handoff time.",
          characterReply: "Could you send the final figures by 10 AM?",
        },
      },
    });
  });
  await page.goto("/my-courses");
  await page.getByRole("button", { name: document.title, exact: true }).click();
  await page
    .getByRole("button", { name: "Student preview", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Your response", exact: true })
    .fill("I can finish the structure Wednesday.");
  await page
    .getByRole("button", { name: "Submit response", exact: true })
    .click();
  await expect(
    page.getByText("Add a concrete handoff time.", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Your response", exact: true })
    .fill("I will send the final figures Thursday at 10 AM.");
  await page
    .getByRole("button", {
      name: "Submit improvement",
      exact: true,
    })
    .click();
  await expect(
    page.getByText("2 recorded preview attempt(s)", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath("student-preview.png"),
    fullPage: true,
  });
  expect(submissions).toHaveLength(2);
  expect(submissions.every((s) => s.preview)).toBe(true);
});

test("Studio saves both simulation types and previews the immersive desktop without grading", async ({
  page,
}) => {
  await loginForWorkspace(page);
  let document = exampleCourse("english");
  const row = {
    id: document.id,
    owner_id: "author",
    status: "draft",
    visibility: "private",
    revision: 1,
    document,
  };
  await page.route("**/api/me", (route) =>
    route.fulfill({ json: { id: "author", isTeacher: false } }),
  );
  await page.route("**/api/courses", (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: [row] });
    document = route.request().postDataJSON().document;
    Object.assign(row, { document, revision: row.revision + 1 });
    return route.fulfill({ json: row });
  });
  await page.goto("/my-courses");
  await page.getByRole("button", { name: document.title, exact: true }).click();
  await page
    .getByRole("button", { name: "+ Interactive simulation", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "+ Immersive project", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("combobox", { name: /^Immersive project/ }),
  ).toHaveValue("harbour-clinic");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("Saved revision 2")).toBeVisible();
  expect(document.lessons[0].blocks.map((block) => block.activityType)).toEqual(
    ["reading", "response", "simulation", "project"],
  );
  await page
    .getByRole("button", { name: "Student preview", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Preview desktop" }),
  ).toHaveAttribute("href", "/projects/harbour-clinic");
  await expect(
    page.getByRole("button", { name: "Mark lesson complete" }),
  ).toBeDisabled();
});
