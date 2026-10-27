# DevPath

**A general-purpose AI learning platform with teacher-designed mini-courses.**

Instructors create courses in any subject, organize lessons and activities,
review AI proposals, publish content, invite students and inspect their work.
Students explore courses, practise, receive feedback and build private learning
paths. Harbour Clinic is an immersive project activity inside this platform.

COMP5241 group project, The Hong Kong Polytechnic University.

## Workspaces

| Route | Purpose |
| --- | --- |
| `/` | Course catalogue and learner home |
| `/courses/[courseId]` | Lessons and course preferences |
| `/courses/[courseId]/[lessonId]` | Reading, activities, feedback and progress |
| `/dashboard` | Personal progress |
| `/my-courses` | Student-created private courses and AI builder |
| `/onboarding` | Language, goals and learning preferences |
| `/teach` | Instructor dashboard |
| `/teach/courses/[courseId]` | Overview, curriculum, preview, students and settings |
| `/teach/students`, `/teach/invitations` | Participation and invitation management |
| `/projects` | Standalone project practice |
| `/projects/[scenarioId]` | Full-screen immersive desktop; course launches retain a return link |

The single **Course → Lesson → Activity** model and Activity Registry support
Reading, Choice, Quiz, Ordering, Response, Conversation, Code Review, declarative
Simulation and Immersive Project. Types register validation, authoring,
rendering and evaluation together.

## AI-assisted authoring

Enter a topic, audience, objectives and requirements; generate and review an
outline; generate lessons; edit, preview and accept proposed activities. The
simulation designer can propose declarative variables, stages, actions,
conditions, effects and endings. Teachers review before publishing. A lesson
does not require a quiz or any fixed activity mix.

Model calls stay on the server with schema checks and hourly quotas. The current
Gemini model chain and cooldown behavior are preserved. Course generation,
tutoring and qualitative response feedback need a Gemini key; manual editing,
deterministic practice and the project keyword evaluator work without one.

## Harbour Clinic inside a course

Open **Building Software with AI Coding Agents → Apply your skills: Harbour
Clinic**, or add **Immersive project** to any lesson in Studio. The activity
opens the existing desktop with Mail, Meet, Notes, Cody, Review and Launch.
Both tracks, branching outcomes, client trust, time budget, sounds and the
AI Fluency report are retained.

The activity adapter verifies the signed-in learner's completed project session
on the server. For saved courses, completion and the four feedback cards enter
the existing immutable `learning_attempts` gradebook; instructors see them in
the course's student results. Repeated saves of the same run are idempotent.
The desktop and report link back to the lesson. No second project engine or
session store is introduced.

Standalone routes and their `project:<scenarioId>` session keys are preserved.
An existing completed run can satisfy an assigned activity. Teacher preview
opens the teacher's standalone practice session without grading the course.
Generic simulations remain separately authorable for any subject.

## Run locally

Use Node.js 22 or later.

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Without credentials, static courses, local simulations and preferences work.
For persistent authoring and project runs, configure an **isolated test**
Supabase instance and apply all eight migrations in filename order.

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Auth and RLS-scoped reads |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only learning evidence and project state writes |
| `GEMINI_API_KEY` | Server-only AI authoring, tutoring and feedback |
| `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL` | Primary and fallback model IDs |

Enable GitHub OAuth and/or magic links in the test instance. Allow the local
`http://localhost:3000/auth/callback` redirect, including its `next` query
parameter, in your Auth configuration. Assign test instructors through an
administrator's SQL console; browser users cannot assign their own roles.
Keep service and AI keys out of `NEXT_PUBLIC_` variables.

## Checks

```bash
npm run typecheck
npm run lint
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

`npm test` executes the actual migrations and role policies in an isolated
in-memory PostgreSQL instance (PGlite), alongside application unit tests.
Playwright tests run the production build with explicitly mocked cloud APIs
where required. Use `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to select an installed
browser. `npm run test:postgres` is the older four-migration regression script
and needs a local Postgres superuser; it does not cover the new migrations.

See [RESTORATION.md](docs/RESTORATION.md) for provenance, exact validation
results, migration details, remaining limitations and a staging review
checklist. [GENERAL_LEARNING_PLATFORM.md](docs/GENERAL_LEARNING_PLATFORM.md)
documents the recovered platform. [PROJECT_DESKTOP.md](docs/PROJECT_DESKTOP.md)
preserves the upstream desktop documentation.
