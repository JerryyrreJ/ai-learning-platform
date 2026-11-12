import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { projectListings } from "@/lib/projects/catalog";
import { HttpError, recordDb, redactSecrets } from "@/lib/supabase/server";

export const FEEDBACK_KINDS = ["content_error", "grading_issue", "unclear", "diagram_broken"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

export const FEEDBACK_SURFACES = ["primer", "game", "desktop", "report"] as const;
export type FeedbackSurface = (typeof FEEDBACK_SURFACES)[number];

export const FEEDBACK_STATUSES = ["open", "resolved", "dismissed"] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export const FEEDBACK_KIND_LABELS: Record<FeedbackKind, string> = {
  content_error: "Content / domain error",
  grading_issue: "Unfair grading / check",
  unclear: "Unclear wording",
  diagram_broken: "Diagram display issue",
};

export const submitFeedbackSchema = z.object({
  projectId: z.string().trim().regex(/^[a-z0-9-]{1,64}$/, "Invalid course id."),
  kind: z.enum(FEEDBACK_KINDS),
  surface: z.enum(FEEDBACK_SURFACES),
  targetId: z.string().trim().max(80).optional(),
  targetLabel: z.string().trim().max(160).optional(),
  message: z.string().trim().min(3, "Please add a short note (at least 3 characters).").max(1000),
  context: z.record(z.string(), z.unknown()).optional(),
});

export const resolveFeedbackSchema = z.object({
  status: z.enum(FEEDBACK_STATUSES),
  resolutionNote: z.string().trim().max(500).optional(),
});

export interface FeedbackItem {
  id: string;
  reporterId: string;
  projectId: string;
  projectTitle: string;
  kind: FeedbackKind;
  surface: FeedbackSurface;
  targetId: string | null;
  targetLabel: string | null;
  message: string;
  context: Record<string, unknown>;
  status: FeedbackStatus;
  resolutionNote: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

function tableMissing(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  if (code === "42P01" || code === "PGRST205") return true;
  return /content_feedback/i.test(error.message ?? "") && /does not exist|schema cache/i.test(error.message ?? "");
}

type RawFeedbackRow = {
  id: string;
  reporter_id: string;
  project_id: string;
  kind: FeedbackKind;
  surface: FeedbackSurface;
  target_id: string | null;
  target_label: string | null;
  message: string;
  context: Record<string, unknown> | null;
  status: FeedbackStatus;
  resolution_note: string | null;
  created_at: string;
  resolved_at: string | null;
};

function mapRow(row: RawFeedbackRow, titles: Map<string, string>): FeedbackItem {
  return {
    id: row.id,
    reporterId: row.reporter_id,
    projectId: row.project_id,
    projectTitle: titles.get(row.project_id) ?? row.project_id,
    kind: row.kind,
    surface: row.surface,
    targetId: row.target_id,
    targetLabel: row.target_label,
    message: row.message,
    context: row.context ?? {},
    status: row.status,
    resolutionNote: row.resolution_note,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  };
}

export async function createFeedback(
  db: SupabaseClient,
  userId: string,
  input: z.infer<typeof submitFeedbackSchema>,
): Promise<{ id: string }> {
  // Clamp serialized context size so nobody stores megabytes in jsonb.
  let safeContext: Record<string, unknown> = {};
  if (input.context) {
    const raw = JSON.stringify(input.context);
    safeContext = raw.length <= 8000 ? input.context : { truncated: true };
  }

  const { data, error } = await db
    .from("content_feedback")
    .insert({
      reporter_id: userId,
      project_id: input.projectId,
      kind: input.kind,
      surface: input.surface,
      target_id: input.targetId || null,
      target_label: input.targetLabel || null,
      message: input.message,
      context: safeContext,
    })
    .select("id")
    .single();

  if (error) {
    if (tableMissing(error)) {
      throw new HttpError(503, "Feedback storage requires applying the latest database migration.");
    }
    console.error("createFeedback failed", { code: error.code, message: redactSecrets(error.message) });
    throw new HttpError(503, "Could not submit feedback right now. Please retry.");
  }
  return { id: data.id as string };
}

/** Feedback reports on a single generated project owned by the signed-in instructor. */
export async function listProjectFeedbackForOwner(
  db: SupabaseClient,
  projectId: string,
  projectTitle: string,
): Promise<FeedbackItem[]> {
  const { data, error } = await db
    .from("content_feedback")
    .select("id,reporter_id,project_id,kind,surface,target_id,target_label,message,context,status,resolution_note,created_at,resolved_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    if (!tableMissing(error)) {
      console.warn("listProjectFeedbackForOwner failed", { code: error.code });
    }
    return [];
  }
  const titles = new Map([[projectId, projectTitle]]);
  return ((data ?? []) as RawFeedbackRow[]).map((row) => mapRow(row, titles));
}

/** Open feedback counts keyed by projectId across an instructor's own projects. */
export async function openFeedbackCountsForProjects(
  db: SupabaseClient,
  projectIds: string[],
): Promise<Record<string, number>> {
  if (!projectIds.length) return {};
  const { data, error } = await db
    .from("content_feedback")
    .select("project_id")
    .in("project_id", projectIds)
    .eq("status", "open");
  if (error) return {};
  const counts: Record<string, number> = {};
  for (const row of data ?? []) {
    const pid = row.project_id as string;
    counts[pid] = (counts[pid] ?? 0) + 1;
  }
  return counts;
}

/** All feedback across built-in, community and instructor courses (for /admin). */
export async function listFeedbackForAdmin(limit = 60): Promise<FeedbackItem[]> {
  const service = recordDb();
  const { data, error } = await service
    .from("content_feedback")
    .select("id,reporter_id,project_id,kind,surface,target_id,target_label,message,context,status,resolution_note,created_at,resolved_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    if (!tableMissing(error)) {
      console.warn("listFeedbackForAdmin failed", { code: error.code });
    }
    return [];
  }
  const rows = (data ?? []) as RawFeedbackRow[];
  const titles = new Map(projectListings.map((p) => [p.id, p.title]));
  const genIds = [...new Set(rows.map((r) => r.project_id).filter((id) => id.startsWith("gen-")))];
  if (genIds.length > 0) {
    const { data: genRows } = await service.from("generated_projects").select("id,title").in("id", genIds);
    for (const row of genRows ?? []) {
      titles.set(row.id as string, row.title as string);
    }
  }
  return rows.map((row) => mapRow(row, titles));
}

/** Updates a feedback report's status (allowed for the course owner via RLS or an admin via service_role). */
export async function resolveFeedbackItem(
  db: SupabaseClient,
  actorId: string,
  feedbackId: string,
  patch: z.infer<typeof resolveFeedbackSchema>,
) {
  if (!/^[0-9a-f-]{36}$/i.test(feedbackId)) {
    throw new HttpError(400, "Invalid feedback id.");
  }
  const { data: profile } = await db.from("profiles").select("role").eq("id", actorId).maybeSingle();
  const isAdmin = profile?.role === "admin";
  const client = isAdmin ? recordDb() : db;

  const updatePayload = {
    status: patch.status,
    resolution_note: patch.resolutionNote || null,
    resolved_at: patch.status === "open" ? null : new Date().toISOString(),
  };

  const { data, error } = await client
    .from("content_feedback")
    .update(updatePayload)
    .eq("id", feedbackId)
    .select("id,status");

  if (error) {
    if (tableMissing(error)) throw new HttpError(503, "Feedback table is not available yet.");
    throw new HttpError(error.code === "42501" ? 403 : 503, "Could not update feedback status.");
  }
  if (!data?.length) {
    throw new HttpError(404, "Feedback report not found or you do not have permission to update it.");
  }
  return data[0];
}
