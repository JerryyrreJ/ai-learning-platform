# Unified learning experience

Working branch: `feat/unified-learning-experience`

## Baseline

- Functionally complete restoration: `restore/general-learning-platform`
- Visual shell and catalogue polish selectively taken from: `merge/restored-course-platform`
- Historical reference for the restored platform: `82801c43d61d9324ab49eaa9f2ed50e265e59587`

## Information architecture

| Route | Responsibility |
| --- | --- |
| `/` | Product introduction and featured content |
| `/courses` | Full course discovery library |
| `/dashboard` | Student learning dashboard (My Learning) |
| `/my-courses` | Personal creations / AI learning paths |
| `/teach` | Teaching Studio |
| `/projects/[scenarioId]` | Immersive project execution (kept; not in primary nav) |

## Auth and roles

- First-time authenticated users choose learn or teach intentions on `/onboarding`.
- Verified users may call `public.activate_instructor()` (via `/api/me/activate-instructor` or onboarding) to gain instructor access on the same account.
- Direct client updates to `profiles.role` remain blocked.
- Onboarding never grants `admin`.

## Migration required

Apply:

`supabase/migrations/20261029120000_onboarding_and_instructor_activation.sql`

Existing profiles are backfilled so returning users are not forced through intention choice again.
