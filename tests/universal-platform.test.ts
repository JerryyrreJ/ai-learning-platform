import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { guideFor, nextStep } from "../src/components/projects/desktop/config";
import { getProjectScenario } from "../src/lib/projects";
import { inferDiscipline, projectListings } from "../src/lib/projects/catalog";
import { offlineEvaluator } from "../src/lib/projects/evaluate";
import { buildScenario } from "../src/lib/projects/generated/build";
import { checkProject } from "../src/lib/projects/generated/validate";
import { buildMiniCourse } from "../src/lib/projects/minicourse";
import {
  answerViva,
  askClient,
  chooseAction,
  endInterview,
  projectView,
  requestChanges,
  startProject,
  submitBrief,
  submitRequirements,
} from "../src/lib/projects/runtime";
import { wardGelAuditDraft } from "../src/lib/projects/ward-gel-audit";

test("polymorphic specialist artifacts label rows, clauses, and steps without code jargon", async () => {
  const cases = [
    { id: "ward-gel-audit", kind: "table", prefix: "row " },
    { id: "bean-and-bread", kind: "document", prefix: "§" },
    { id: "river-nitrate-lab", kind: "steps", prefix: "step " },
  ] as const;

  for (const item of cases) {
    const scenario = getProjectScenario(item.id)!;
    assert.equal(scenario.artifactKind, item.kind);

    let state = startProject(scenario);
    state = chooseAction(scenario, state, "pick-engineering").state;
    state = chooseAction(scenario, state, "call-grace").state;
    for (const fact of scenario.facts) {
      state = (await askClient(scenario, state, fact.text, offlineEvaluator)).state;
    }
    state = endInterview(scenario, state).state;
    state = (await submitRequirements(scenario, state, "placeholder", offlineEvaluator)).state;
    state = (await submitBrief(scenario, state, "placeholder brief missing constraints", offlineEvaluator)).state;

    const viewBefore = projectView(scenario, state, []);
    assert.equal(viewBefore.scenario.artifactKind, item.kind);
    assert.equal(viewBefore.work?.files[0]?.kind, item.kind);
    if (item.kind === "table") {
      assert.ok((viewBefore.work?.files[0]?.columns?.length ?? 0) >= 2);
    }
    const guideText = guideFor(viewBefore).join(" ");
    assert.match(guideText, /entry by entry/i);
    assert.doesNotMatch(guideText, /pull request/i);
    assert.doesNotMatch(nextStep(viewBefore) ?? "", /pull request/i);

    const flawed = scenario.variants.find((v) => v.id === state.variables.variant)!;
    const target = flawed.problemLines[0];
    state = requestChanges(scenario, state, target).state;

    const viewAfter = projectView(scenario, state, []);
    const label = viewAfter.work?.reviews[0]?.label ?? "";
    assert.ok(label.includes(`${item.prefix}${target.line}`), `expected "${item.prefix}${target.line}" in "${label}"`);
  }
});

test("table artifact validation rejects mismatched pipe-delimited cell counts", async () => {
  const broken = structuredClone(wardGelAuditDraft);
  broken.artifact = {
    ...broken.artifact!,
    good: [
      "Only two cells | 12",
      ...broken.artifact!.good.slice(1),
    ],
  };
  const check = await checkProject(buildScenario(broken, { id: "gen-broken1234" }), broken, { requireConcepts: true });
  assert.ok(check.problems.some((p) => p.includes("cells, expected 4")));
});

test("live stakeholder viva unlocks at release, grades defense, and boosts trust when strong", async () => {
  const scenario = getProjectScenario("ward-gel-audit")!;
  let state = startProject(scenario);
  // Hidden before release.
  assert.equal(projectView(scenario, state, []).viva, null);

  state = chooseAction(scenario, state, "pick-product").state;
  // Take quote (-1 trust -> 4) so trust has headroom below 10 to verify the +1 viva reward.
  state = chooseAction(scenario, state, "send-quote").state;
  for (const fact of Object.values(wardGelAuditDraft.facts)) {
    state = (await askClient(scenario, state, fact.sampleQuestion, offlineEvaluator)).state;
  }
  state = endInterview(scenario, state).state;
  state = (await submitRequirements(scenario, state, wardGelAuditDraft.samples.requirements, offlineEvaluator)).state;
  state = (await submitBrief(scenario, state, wardGelAuditDraft.samples.brief, offlineEvaluator)).state;
  state = chooseAction(scenario, state, "approve").state;

  const atRelease = projectView(scenario, state, []);
  assert.equal(state.stageId, "release");
  assert.ok(atRelease.viva);
  assert.equal(atRelease.viva.response, null);

  const trustBefore = Number(state.variables.trust);
  const defended = await answerViva(
    scenario,
    state,
    "We divide cases by patient-day occupancy rather than raw counts, stratify surgical transfers separately, and submit for committee zero-revision check.",
    offlineEvaluator,
  );
  assert.equal(projectView(scenario, defended.state, []).viva?.response?.rating, "strong");
  assert.equal(Number(defended.state.variables.trust), trustBefore + 1);

  // Cannot answer viva twice.
  await assert.rejects(
    () => answerViva(scenario, defended.state, "Another answer", offlineEvaluator),
    /already answered/,
  );

  const finished = chooseAction(scenario, defended.state, "release-measure").state;
  const finalView = projectView(scenario, finished, []);
  assert.equal(finalView.viva?.response?.rating, "strong");
  assert.ok(finalView.completion?.trust.changes.some((t) => t.reason.includes("sign-off explanation")));
  const diligenceCard = finalView.completion?.cards.find((c) => c.competency === "diligence");
  assert.ok(diligenceCard?.evidence.some((line) => line.includes("sign-off defense")));
});

test("3-act mini-course builder produces slides and trap cards for every built-in course without leaking hidden facts", () => {
  for (const listing of projectListings) {
    const scenario = getProjectScenario(listing.id)!;
    const course = buildMiniCourse(scenario);
    assert.ok(course.slides.length >= 6, `${listing.id} slides`);
    assert.equal(course.gameCards.length, 5, `${listing.id} game cards`);
    assert.ok(course.gameCards.some((c) => c.verdict === "trap"));
    assert.ok(course.gameCards.some((c) => c.verdict === "sound"));

    const serialised = JSON.stringify(course);
    for (const fact of scenario.facts) {
      assert.ok(!serialised.includes(fact.reply), `${listing.id} mini-course must not leak scripted client reply`);
    }
  }
  assert.equal(inferDiscipline("clinical nursing statistics"), "Data & Healthcare");
  assert.equal(inferDiscipline("environmental chemistry"), "Natural Sciences");
  assert.equal(inferDiscipline("privacy law & media"), "Law & Media");
});

test("public community gallery migration exposes safe listing columns when shared and never exposes draft JSON", async () => {
  const db = new PGlite();
  await db.exec(
    `create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz); create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; grant usage on schema public,auth to anon,authenticated,service_role; grant execute on function auth.uid() to anon,authenticated,service_role;`,
  );
  const migrations = [
    "0001_init.sql",
    "20261022050613_general_learning_platform.sql",
    "20261022180000_review_fixes.sql",
    "20261022203000_quota_params_and_owner_read.sql",
    "20261022235900_learning_preferences.sql",
    "20261023090000_simulation_sessions.sql",
    "20261031150000_generated_projects.sql",
    "20261101120000_learning_paths.sql",
    "20261102090000_classes.sql",
    "20261112090000_public_gallery.sql",
  ];
  for (const file of migrations) {
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  }

  const author = "00000000-0000-4000-8000-000000000011";
  const peer = "00000000-0000-4000-8000-000000000012";
  await db.exec(
    `insert into auth.users values ('${author}','author@example.test',now()),('${peer}','peer@example.test',now());`,
  );
  await db.exec(
    `insert into public.generated_projects (id, owner_id, domain, subject, topic, title, tagline, summary, draft, template_version, model)
     values ('gen-gallerytest01', '${author}', 'accounting', 'Financial Accounting', 'revenue cut-off', 'Harbour Books Audit', 'Check year-end invoices', 'Audit accrual cut-off.', '{"secret":"hidden-facts"}'::jsonb, 1, 'gemini');`,
  );

  async function asRole(role: "anon" | "authenticated", uid: string | null, sql: string) {
    await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub','${uid ?? ""}',false);`);
    try {
      return await db.exec(sql);
    } finally {
      await db.exec("reset role");
    }
  }

  // Private by default: peer and anon see 0 rows.
  const privatePeer = await asRole("authenticated", peer, "select id, title from public.generated_projects");
  assert.equal(privatePeer[0].rows.length, 0);
  const privateAnon = await asRole("anon", null, "select id, title from public.generated_projects");
  assert.equal(privateAnon[0].rows.length, 0);

  // Non-owner cannot publish someone else's course.
  const hijack = await asRole("authenticated", peer, "update public.generated_projects set is_public = true where id = 'gen-gallerytest01'");
  assert.equal(hijack[0].affectedRows, 0);

  // Owner publishes to the Community Gallery.
  await asRole("authenticated", author, "update public.generated_projects set is_public = true where id = 'gen-gallerytest01'");

  // Now anon and peer can read safe listing columns.
  const sharedPeer = await asRole("authenticated", peer, "select id, title, subject, is_public from public.generated_projects");
  assert.equal(sharedPeer[0].rows.length, 1);
  const sharedAnon = await asRole("anon", null, "select id, title, subject, is_public from public.generated_projects");
  assert.equal(sharedAnon[0].rows.length, 1);

  // Even when public, `draft` (hidden facts & flaws) remains strictly unreadable!
  await assert.rejects(
    asRole("authenticated", peer, "select draft from public.generated_projects where id = 'gen-gallerytest01'"),
    /permission denied/,
  );
  await assert.rejects(
    asRole("anon", null, "select draft from public.generated_projects where id = 'gen-gallerytest01'"),
    /permission denied/,
  );
});
