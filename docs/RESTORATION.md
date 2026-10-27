# General learning platform restoration

## Recovery baseline

- Branch: `restore/general-learning-platform`, based on upstream `main` at
  `35518d93ca297ba2667a7b0a628916e5f84e0350` (2026-10-27 inspection).
- Fork `main` at inspection: `8c0ecbea72cbd49b0a10b1723d3023c25ba89f65`.
- Recovery source: `82801c43d61d9324ab49eaa9f2ed50e265e59587`, before
  `0185d374cce07f81bb2b3a2df2d985f9028159ce` removed the course application.
- No main reset, blanket revert, cherry-pick, production deployment or live
  database operation is part of this restoration.

## Historical architecture audit

The historical snapshot and current main differ in 147 files. The deletion
removed roughly 18,000 lines of platform code and tests. Recovered files are
selected from that snapshot, with existing files reconciled separately:

| Area | Recovered implementation | Current code retained/adapted |
| --- | --- | --- |
| Course model | `src/lib/learning/{model,registry,repository,read,course-view}.ts` | One course model and one activity registry |
| Learner | Course/lesson/dashboard/onboarding/my-courses routes; learner store and progress logic | Desktop `useAuth` delegates to the same learner provider |
| Teaching | `/teach`, teaching components, Course Studio, invitations and student views | Existing Supabase role and ownership guards |
| AI builder | `generation.ts`, builder/tutor APIs, draft review and preference context | Current Gemini model chain, cooldowns, timeouts and secret redaction |
| Generic simulations | Editor, View, API, redaction and evaluation | Current engine/schema/conditions/http are byte-identical to the recovery snapshot and retained |
| Harbour Clinic | Existing immersive desktop and project runtime | Current client interview, evaluator, tracks, trust balancing, sounds and standalone routes |
| Tests | Deleted unit and Playwright platform tests | Current project, evaluator, quota and simulation tests retained |

The six existing migrations are unchanged between the historical snapshot and
upstream main. They already define courses, enrolments, invitations, attempts,
progress, learner preferences, quota functions and simulation sessions. Reuse
these tables; do not create a second course or simulation-session store.

Restored packages are the historical Markdown/GFM renderer, Tailwind typography
and Playwright, using the historical lockfile. Supabase package versions are
unchanged. Current server-side error redaction and service-key normalization
are preserved.

## Review locally

```bash
git fetch origin
git switch restore/general-learning-platform
npm ci
cp .env.example .env.local
npm run dev
```

Without credentials, browse the static catalogue, course lessons, local generic
simulations and Studio previews. Persistent authoring, project runs and the
gradebook require an isolated Supabase test project with the repository's
migrations. AI authoring/tutoring require a server-only `GEMINI_API_KEY`.
Never put the Gemini key or Supabase service key in a `NEXT_PUBLIC_` variable.

Validation results and the immersive activity integration are recorded below
as implementation proceeds.
