import { test, expect } from "@playwright/test";

const lesson = "/courses/ai-coding-agents/clinic-project";

test("Harbour Clinic launches from its course with a validated return path", async ({
  page,
}) => {
  await page.goto(lesson);
  await expect(
    page.getByRole("heading", { name: "Apply your skills: Harbour Clinic" }),
  ).toBeVisible();
  const launch = page.getByRole("link", { name: "Open immersive project" });
  await expect(launch).toHaveAttribute(
    "href",
    "/projects/harbour-clinic?courseId=ai-coding-agents&lessonId=clinic-project&activityId=clinic-desktop",
  );
  await launch.click();
  await expect(
    page.getByRole("link", { name: "Sign in to start" }),
  ).toBeVisible();
  const signInUrl = new URL(
    (await page
      .getByRole("link", { name: "Sign in to start" })
      .getAttribute("href")) ?? "",
    page.url(),
  );
  expect(signInUrl.searchParams.get("next")).toBe(
    "/projects/harbour-clinic?courseId=ai-coding-agents&lessonId=clinic-project&activityId=clinic-desktop",
  );
  await page
    .getByRole("link", { name: "Return to lesson", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`${lesson}$`));
  await expect(
    page.getByRole("button", { name: "Mark lesson complete" }),
  ).toBeDisabled();
});

test("standalone project routes still work and forged course contexts fail closed", async ({
  page,
  request,
}) => {
  await page.goto("/projects/harbour-clinic");
  await expect(
    page.getByRole("heading", { name: "Harbour Clinic booking board" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Back to DevPath" }),
  ).toHaveAttribute("href", "/projects");
  for (const query of [
    "courseId=ai-coding-agents&lessonId=clinic-project&activityId=wrong",
    "courseId=ai-coding-agents&lessonId=discernment&activityId=clinic-desktop",
    "courseId=ai-coding-agents",
    "courseId=missing&lessonId=missing&activityId=missing",
  ]) {
    expect(
      (await request.get(`/projects/harbour-clinic?${query}`)).status(),
    ).toBe(404);
  }
});

test("a claimed project result cannot complete the course without server evidence", async ({
  page,
}) => {
  await page.goto(lesson);
  await page.getByRole("button", { name: "Record completed run" }).click();
  await expect(page.locator("p[role=alert]")).toContainText(
    /Configure Supabase|Sign in/,
  );
  await expect(
    page.getByRole("button", { name: "Mark lesson complete" }),
  ).toBeDisabled();
  await expect(page.getByText("Done ✓", { exact: true })).not.toBeVisible();
});

test("teacher and learner navigation stays separate from standalone project practice", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: "Learn anything. By doing.",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open Harbour Clinic", exact: true }),
  ).toHaveAttribute("href", "/login?next=%2Fprojects%2Fharbour-clinic");
  await page.goto("/teach");
  await expect(page).toHaveURL(/\/login\?next=%2Fteach$/);
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
});
