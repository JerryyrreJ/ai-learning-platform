import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError, recordDb } from "@/lib/supabase/server";

/**
 * Hourly AI quotas with three-tier governance:
 *   1. Role defaults (student vs instructor vs admin)
 *   2. Instructor-configured class caps for students in their classes
 *   3. Administrator per-account overrides on `public.profiles`
 *
 * The in-memory counter is per server process only. It still applies when the
 * database function is missing, so a single instance cannot be driven without
 * a limit. `consume_ai_quota` is the shared quota. A request must pass both.
 */
export const AI_QUOTA = {
  generation: 12,
  feedback: 40,
  tutor: 60,
  roleplay: 40,
  "prompt-lab": 30,
} as const;

export type AiBucket = keyof typeof AI_QUOTA;

export const ACTIVE_BUCKETS = ["generation", "roleplay", "feedback"] as const;
export type ActiveAiBucket = (typeof ACTIVE_BUCKETS)[number];

export const BUCKET_META: Record<
  ActiveAiBucket,
  { label: string; shortLabel: string; description: string; color: string }
> = {
  generation: {
    label: "Course Generation",
    shortLabel: "Generate",
    description: "Creating or remixing mini-courses & learning paths",
    color: "#22d3ee",
  },
  roleplay: {
    label: "Client Call AI",
    shortLabel: "Client Call",
    description: "Free-text discovery questions during stakeholder interviews",
    color: "#818cf8",
  },
  feedback: {
    label: "Writing & Viva Grading",
    shortLabel: "Grading",
    description: "Evaluating custom requirements, briefs, teach-back & Viva",
    color: "#34d399",
  },
};

export type QuotaOverrides = {
  generation: number | null;
  roleplay: number | null;
  feedback: number | null;
};

export const EMPTY_QUOTA_OVERRIDES: QuotaOverrides = {
  generation: null,
  roleplay: null,
  feedback: null,
};

export const ROLE_DEFAULT_QUOTA: Record<"student" | "instructor" | "admin", Record<ActiveAiBucket, number>> = {
  student: {
    generation: AI_QUOTA.generation,
    roleplay: AI_QUOTA.roleplay,
    feedback: AI_QUOTA.feedback,
  },
  instructor: {
    generation: 30,
    roleplay: 80,
    feedback: 80,
  },
  admin: {
    generation: 60,
    roleplay: 120,
    feedback: 120,
  },
};

export type QuotaSource =
  | { kind: "role"; role: "student" | "instructor" | "admin" }
  | { kind: "class"; classId: string; className: string }
  | { kind: "account" };

export interface EffectiveBucketQuota {
  limit: number;
  source: QuotaSource;
  sourceLabel: string;
}

export type EffectiveQuotaMap = Record<ActiveAiBucket, EffectiveBucketQuota>;

export interface ClassQuotaRule {
  classId: string;
  className: string;
  quotas: QuotaOverrides;
}

function normaliseRole(role: string | null | undefined): "student" | "instructor" | "admin" {
  if (role === "instructor" || role === "admin") return role;
  return "student";
}

export function formatQuotaSource(source: QuotaSource): string {
  if (source.kind === "account") return "Custom account limit (Admin)";
  if (source.kind === "class") return `Set by class: ${source.className}`;
  if (source.role === "instructor") return "Instructor allowance";
  if (source.role === "admin") return "Administrator allowance";
  return "Standard student allowance";
}

/**
 * Pure 3-tier resolution:
 *   Role default -> Instructor class cap (for students) -> Admin account override.
 */
export function computeEffectiveQuota(
  rawRole: string | null | undefined,
  accountOverrides: Partial<QuotaOverrides> | null | undefined,
  classRules: ClassQuotaRule[] = [],
): EffectiveQuotaMap {
  const role = normaliseRole(rawRole);
  const defaults = ROLE_DEFAULT_QUOTA[role];

  const out = {} as EffectiveQuotaMap;
  for (const bucket of ACTIVE_BUCKETS) {
    let limit = defaults[bucket];
    let source: QuotaSource = { kind: "role", role };

    if (role === "student" && classRules.length > 0) {
      for (const cls of classRules) {
        const cap = cls.quotas[bucket];
        if (typeof cap === "number" && Number.isFinite(cap)) {
          const clamped = Math.max(0, Math.min(500, Math.trunc(cap)));
          if (source.kind !== "class" || clamped < limit) {
            limit = clamped;
            source = { kind: "class", classId: cls.classId, className: cls.className };
          }
        }
      }
    }

    const personal = accountOverrides?.[bucket];
    if (typeof personal === "number" && Number.isFinite(personal)) {
      limit = Math.max(0, Math.min(500, Math.trunc(personal)));
      source = { kind: "account" };
    }

    out[bucket] = {
      limit,
      source,
      sourceLabel: formatQuotaSource(source),
    };
  }
  return out;
}

function isActiveBucket(bucket: AiBucket): bucket is ActiveAiBucket {
  return bucket === "generation" || bucket === "roleplay" || bucket === "feedback";
}

export async function resolveEffectiveQuota(db: SupabaseClient, userId: string): Promise<EffectiveQuotaMap> {
  if (typeof (db as { from?: unknown }).from !== "function" || !userId) {
    return computeEffectiveQuota("student", null, []);
  }

  let role = "student";
  let accountOverrides: QuotaOverrides = { ...EMPTY_QUOTA_OVERRIDES };

  const profileRes = await db
    .from("profiles")
    .select("role,quota_generation,quota_roleplay,quota_feedback")
    .eq("id", userId)
    .maybeSingle();

  if (profileRes.error?.code === "42703") {
    const basic = await db.from("profiles").select("role").eq("id", userId).maybeSingle();
    role = (basic.data?.role as string | undefined) ?? "student";
  } else if (!profileRes.error && profileRes.data) {
    const row = profileRes.data as {
      role?: string;
      quota_generation?: number | null;
      quota_roleplay?: number | null;
      quota_feedback?: number | null;
    };
    role = row.role ?? "student";
    accountOverrides = {
      generation: row.quota_generation ?? null,
      roleplay: row.quota_roleplay ?? null,
      feedback: row.quota_feedback ?? null,
    };
  }

  const classRules: ClassQuotaRule[] = [];
  if (normaliseRole(role) === "student") {
    const { data: memberships } = await db.from("class_members").select("class_id").eq("student_id", userId);
    const classIds = (memberships ?? []).map((m) => m.class_id as string);
    if (classIds.length > 0) {
      const classesRes = await db
        .from("classes")
        .select("id,name,quota_generation,quota_roleplay,quota_feedback")
        .in("id", classIds);
      if (!classesRes.error && classesRes.data) {
        for (const c of classesRes.data as Array<{
          id: string;
          name: string;
          quota_generation?: number | null;
          quota_roleplay?: number | null;
          quota_feedback?: number | null;
        }>) {
          classRules.push({
            classId: c.id,
            className: c.name,
            quotas: {
              generation: c.quota_generation ?? null,
              roleplay: c.quota_roleplay ?? null,
              feedback: c.quota_feedback ?? null,
            },
          });
        }
      }
    }
  }

  return computeEffectiveQuota(role, accountOverrides, classRules);
}

const WINDOW_MS = 60 * 60 * 1000;
const memory = new Map<string, { start: number; hits: number }>();

export function resetMemoryQuota() {
  memory.clear();
}

function consumeMemory(userId: string, bucket: AiBucket, maxHits: number): boolean {
  const key = `${userId}:${bucket}`;
  const now = Date.now();
  const row = memory.get(key);
  if (!row || now - row.start >= WINDOW_MS) {
    memory.set(key, { start: now, hits: 1 });
    return 1 <= maxHits;
  }
  row.hits += 1;
  return row.hits <= maxHits;
}

export async function enforceQuota(
  db: SupabaseClient,
  userId: string,
  bucket: AiBucket,
) {
  let maxHits: number = AI_QUOTA[bucket];
  let sourceNote = "";

  if (typeof (db as { from?: unknown }).from === "function" && isActiveBucket(bucket)) {
    try {
      const effective = await resolveEffectiveQuota(db, userId);
      maxHits = effective[bucket].limit;
      if (effective[bucket].source.kind !== "role") {
        sourceNote = ` (${effective[bucket].sourceLabel})`;
      }
    } catch {
      // Fall back to static cap if lookup fails unexpectedly.
      maxHits = AI_QUOTA[bucket];
    }
  }

  if (maxHits <= 0) {
    throw new HttpError(
      429,
      `AI ${bucket} is currently disabled for your account${sourceNote}.`,
    );
  }

  if (!consumeMemory(userId, bucket, maxHits)) {
    throw new HttpError(
      429,
      `Hourly limit (${maxHits}/hr) reached for ${bucket}${sourceNote}. Wait and try again.`,
    );
  }

  let { data, error } = await db.rpc("consume_ai_quota", {
    p_bucket: bucket,
    max_hits: maxHits,
    window_seconds: 3600,
  });

  // Backwards compatibility if an older DB migration still caps max_hits at 100.
  if (error && maxHits > 100 && /Invalid quota window/i.test(error.message ?? "")) {
    ({ data, error } = await db.rpc("consume_ai_quota", {
      p_bucket: bucket,
      max_hits: 100,
      window_seconds: 3600,
    }));
  }

  if (error) {
    // Only a missing function may use the per-process counter. Other failures,
    // including a broken quota upsert, must not look like a successful check.
    if (quotaFunctionMissing(error)) {
      console.warn(
        "AI quota RPC unavailable; using the in-memory per-instance limit only.",
      );
      return;
    }
    throw new HttpError(503, "Could not check the AI usage quota.");
  }
  if (data !== true) {
    throw new HttpError(
      429,
      `Hourly limit (${maxHits}/hr) reached for ${bucket}${sourceNote}. Wait and try again.`,
    );
  }
}

function quotaFunctionMissing(error: { code?: string; message?: string }) {
  const code = error.code ?? "";
  if (code === "PGRST202" || code === "42883") return true;
  const message = error.message ?? "";
  return /\bPGRST202\b/.test(message) || /\b42883\b/.test(message);
}

// ---------------------------------------------------------------------------
// Usage analytics & chart series for Student (/profile), Instructor (/teach) & Admin (/admin)

export interface HourlyQuotaPoint {
  windowStartIso: string;
  label: string;
  generation: number;
  roleplay: number;
  feedback: number;
  total: number;
}

export interface BucketStatus {
  bucket: ActiveAiBucket;
  label: string;
  shortLabel: string;
  description: string;
  color: string;
  used: number;
  limit: number;
  remaining: number;
  sourceLabel: string;
}

export interface UserQuotaSummary {
  buckets: BucketStatus[];
  resetMinutes: number;
  hourly: HourlyQuotaPoint[];
  totals24h: { generation: number; roleplay: number; feedback: number; total: number };
}

export function currentHourWindowMs(nowMs = Date.now()): number {
  return Math.floor(nowMs / WINDOW_MS) * WINDOW_MS;
}

export function minutesUntilNextHour(nowMs = Date.now()): number {
  const next = currentHourWindowMs(nowMs) + WINDOW_MS;
  return Math.max(1, Math.ceil((next - nowMs) / 60_000));
}

export function buildHourlySeries(
  rows: Array<{ bucket: string; window_start: string; hits: number }>,
  nowMs = Date.now(),
): HourlyQuotaPoint[] {
  const currentStart = currentHourWindowMs(nowMs);
  const byHour = new Map<number, { generation: number; roleplay: number; feedback: number }>();

  for (let i = 23; i >= 0; i--) {
    byHour.set(currentStart - i * WINDOW_MS, { generation: 0, roleplay: 0, feedback: 0 });
  }

  for (const row of rows) {
    const ts = currentHourWindowMs(new Date(row.window_start).getTime());
    const slot = byHour.get(ts);
    if (!slot) continue;
    const hits = Number(row.hits) || 0;
    if (row.bucket === "generation") slot.generation += hits;
    else if (row.bucket === "roleplay") slot.roleplay += hits;
    else if (row.bucket === "feedback") slot.feedback += hits;
  }

  const fmt = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "Asia/Hong_Kong",
  });

  return [...byHour.entries()].map(([ts, counts]) => ({
    windowStartIso: new Date(ts).toISOString(),
    label: fmt.format(new Date(ts)),
    generation: counts.generation,
    roleplay: counts.roleplay,
    feedback: counts.feedback,
    total: counts.generation + counts.roleplay + counts.feedback,
  }));
}

export async function loadUserQuotaSummary(
  db: SupabaseClient,
  userId: string,
  nowMs = Date.now(),
): Promise<UserQuotaSummary> {
  const sinceIso = new Date(currentHourWindowMs(nowMs) - 23 * WINDOW_MS).toISOString();
  const [effective, usageRes] = await Promise.all([
    resolveEffectiveQuota(db, userId),
    db
      .from("ai_usage")
      .select("bucket,window_start,hits")
      .eq("user_id", userId)
      .gte("window_start", sinceIso),
  ]);

  const rows = ((usageRes.data ?? []) as Array<{ bucket: string; window_start: string; hits: number }>);
  const hourly = buildHourlySeries(rows, nowMs);
  const currentSlot = hourly[hourly.length - 1] ?? { generation: 0, roleplay: 0, feedback: 0, total: 0 };

  const buckets: BucketStatus[] = ACTIVE_BUCKETS.map((bucket) => {
    const meta = BUCKET_META[bucket];
    const used = currentSlot[bucket];
    const limit = effective[bucket].limit;
    return {
      bucket,
      label: meta.label,
      shortLabel: meta.shortLabel,
      description: meta.description,
      color: meta.color,
      used,
      limit,
      remaining: Math.max(0, limit - used),
      sourceLabel: effective[bucket].sourceLabel,
    };
  });

  const totals24h = hourly.reduce(
    (acc, pt) => ({
      generation: acc.generation + pt.generation,
      roleplay: acc.roleplay + pt.roleplay,
      feedback: acc.feedback + pt.feedback,
      total: acc.total + pt.total,
    }),
    { generation: 0, roleplay: 0, feedback: 0, total: 0 },
  );

  return {
    buckets,
    resetMinutes: minutesUntilNextHour(nowMs),
    hourly,
    totals24h,
  };
}

export interface StudentQuotaUsageRow {
  studentId: string;
  name: string;
  email: string | null;
  currentHour: { generation: number; roleplay: number; feedback: number; total: number };
  last24h: { generation: number; roleplay: number; feedback: number; total: number };
}

/**
 * Loads AI usage across students in an instructor's class.
 * Call ONLY after verifying class ownership via `loadOwnClass`.
 */
export async function loadClassStudentQuotaUsage(
  students: Array<{ id: string; name: string; email: string | null }>,
  nowMs = Date.now(),
): Promise<{ students: StudentQuotaUsageRow[]; hourly: HourlyQuotaPoint[] }> {
  if (!students.length) {
    return { students: [], hourly: buildHourlySeries([], nowMs) };
  }
  const service = recordDb();
  const sinceIso = new Date(currentHourWindowMs(nowMs) - 23 * WINDOW_MS).toISOString();
  const currentStartMs = currentHourWindowMs(nowMs);

  const { data } = await service
    .from("ai_usage")
    .select("user_id,bucket,window_start,hits")
    .in(
      "user_id",
      students.map((s) => s.id),
    )
    .gte("window_start", sinceIso);

  const rows = ((data ?? []) as Array<{ user_id: string; bucket: string; window_start: string; hits: number }>);
  const hourly = buildHourlySeries(rows, nowMs);

  const perStudent: StudentQuotaUsageRow[] = students.map((student) => {
    const own = rows.filter((r) => r.user_id === student.id);
    const currentHour = { generation: 0, roleplay: 0, feedback: 0, total: 0 };
    const last24h = { generation: 0, roleplay: 0, feedback: 0, total: 0 };

    for (const r of own) {
      const hits = Number(r.hits) || 0;
      const isCurrent = currentHourWindowMs(new Date(r.window_start).getTime()) === currentStartMs;
      if (r.bucket === "generation" || r.bucket === "roleplay" || r.bucket === "feedback") {
        last24h[r.bucket] += hits;
        last24h.total += hits;
        if (isCurrent) {
          currentHour[r.bucket] += hits;
          currentHour.total += hits;
        }
      }
    }

    return {
      studentId: student.id,
      name: student.name,
      email: student.email,
      currentHour,
      last24h,
    };
  });

  return { students: perStudent, hourly };
}
