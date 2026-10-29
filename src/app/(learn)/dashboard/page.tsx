"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ContinueLearning,
  CourseProgressList,
  ProgressStats,
} from "@/components/learning/ProgressSummary";
import { catalogCourses } from "@/content/courses";
import {
  continueLearningTarget,
  isCourseCompleted,
  isCourseStarted,
} from "@/lib/learning/continue";
import { useLearner } from "@/lib/learner-store";
import { GOAL_LABELS, LEARNING_STYLE_LABELS, type Course } from "@/lib/types";

export default function DashboardPage() {
  const [courses, setCourses] = useState<Course[]>(catalogCourses);
  const { ready, profile, progress, user } = useLearner();
  const [isTeacher, setIsTeacher] = useState(false);

  useEffect(() => {
    fetch("/api/courses?accessible=1")
      .then((r) => r.json())
      .then((rows) => {
        if (!Array.isArray(rows)) return;
        const stored = rows
          .map((row: { document?: Course }) => row.document)
          .filter((c: Course | undefined): c is Course => !!c?.id);
        const seen = new Set(catalogCourses.map((c) => c.id));
        setCourses([
          ...catalogCourses,
          ...stored.filter((c: Course) => !seen.has(c.id)),
        ]);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!user) {
      setIsTeacher(false);
      return;
    }
    let active = true;
    fetch("/api/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((account) => {
        if (active) setIsTeacher(!!account?.isTeacher);
      })
      .catch(() => {
        if (active) setIsTeacher(false);
      });
    return () => {
      active = false;
    };
  }, [user]);

  const inProgress = useMemo(
    () =>
      courses.filter(
        (course) =>
          isCourseStarted(progress, course) && !isCourseCompleted(progress, course),
      ),
    [courses, progress],
  );
  const completedCourses = useMemo(
    () => courses.filter((course) => isCourseCompleted(progress, course)),
    [courses, progress],
  );

  const allLessons = courses.flatMap((c) =>
    c.lessons.map((l) => ({ course: c, lesson: l })),
  );
  const completedLessons = allLessons.filter(
    ({ course, lesson }) => progress[`${course.id}/${lesson.id}`]?.completedAt,
  );
  const activitiesDone = Object.values(progress).reduce(
    (n, p) => n + Object.values(p.blocks).filter((b) => b.done).length,
    0,
  );
  const scores = Object.values(progress).flatMap((p) =>
    Object.values(p.blocks).flatMap((b) =>
      typeof b.score === "number" ? [b.score] : [],
    ),
  );
  const avg = scores.length
    ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100)
    : null;
  const continueTarget = continueLearningTarget(courses, progress);

  const feedbackSnips = Object.entries(progress)
    .flatMap(([key, lesson]) =>
      Object.entries(lesson.blocks)
        .filter(([, block]) => block.done && typeof block.score === "number")
        .map(([blockId, block]) => ({
          key: `${key}/${blockId}`,
          score: Math.round((block.score ?? 0) * 100),
          courseId: key.split("/")[0],
          lessonId: key.split("/")[1],
        })),
    )
    .slice(-6)
    .reverse();

  if (!ready) {
    return (
      <div className="mx-auto max-w-4xl space-y-4 px-4 py-12">
        <div className="h-9 w-64 animate-pulse rounded bg-stone-200" />
        <div className="h-28 animate-pulse rounded-2xl bg-stone-100" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-12">
        <h1 className="text-3xl font-bold text-stone-900">My Learning</h1>
        <p className="mt-2 text-stone-600">
          Sign in to see continue learning, progress and AI feedback for your account.
        </p>
        <Link
          href="/login?next=/dashboard"
          className="mt-6 inline-flex rounded-full bg-stone-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-stone-700"
        >
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-10 px-4 py-12">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-stone-900">
            {profile?.displayName
              ? `${profile.displayName}'s learning`
              : "My Learning"}
          </h1>
          {profile ? (
            <p className="mt-2 text-stone-600">
              {GOAL_LABELS[profile.goal]} · {LEARNING_STYLE_LABELS[profile.learningStyle]}
            </p>
          ) : (
            <p className="mt-2 text-stone-600">
              <Link href="/onboarding" className="text-indigo-600 underline">
                Set your learning preferences
              </Link>{" "}
              to personalise explanations.
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/courses"
            className="rounded-full border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50"
          >
            Browse courses
          </Link>
          <Link
            href="/my-courses"
            className="rounded-full bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700"
          >
            Create learning path
          </Link>
          {!isTeacher && (
            <Link
              href="/onboarding?intent=teach"
              className="rounded-full border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-800 hover:bg-indigo-100"
            >
              Start Teaching
            </Link>
          )}
        </div>
      </header>

      <ProgressStats
        completed={completedLessons.length}
        total={allLessons.length}
        activities={activitiesDone}
        average={avg}
      />

      {continueTarget ? (
        <ContinueLearning
          course={continueTarget.course}
          lesson={continueTarget.lesson}
          started={continueTarget.started}
        />
      ) : (
        <div className="rounded-2xl border border-dashed border-stone-300 bg-white p-6 text-sm text-stone-600">
          No active course yet.{" "}
          <Link href="/courses" className="font-medium text-indigo-600 underline">
            Explore the catalogue
          </Link>{" "}
          or{" "}
          <Link href="/my-courses" className="font-medium text-indigo-600 underline">
            create a learning path with AI
          </Link>
          .
        </div>
      )}

      <section>
        <h2 className="text-lg font-semibold text-stone-900">In progress</h2>
        {inProgress.length ? (
          <ul className="mt-3 divide-y divide-stone-100 rounded-2xl border border-stone-200 bg-white">
            {inProgress.map((course) => {
              const done = course.lessons.filter(
                (lesson) => progress[`${course.id}/${lesson.id}`]?.completedAt,
              ).length;
              return (
                <li
                  key={course.id}
                  className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
                >
                  <Link
                    href={`/courses/${course.id}`}
                    className="font-medium text-stone-800 hover:text-indigo-600"
                  >
                    {course.emoji} {course.title}
                  </Link>
                  <span className="text-stone-500">
                    {done}/{course.lessons.length} lessons
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-stone-500">No courses in progress.</p>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold text-stone-900">Completed</h2>
        {completedCourses.length ? (
          <ul className="mt-3 divide-y divide-stone-100 rounded-2xl border border-stone-200 bg-white">
            {completedCourses.map((course) => (
              <li key={course.id} className="px-4 py-3 text-sm text-stone-800">
                {course.emoji} {course.title}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-stone-500">No completed courses yet.</p>
        )}
      </section>

      {feedbackSnips.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-stone-900">
            Recent scored activity results
          </h2>
          <ul className="mt-3 divide-y divide-stone-100 rounded-2xl border border-stone-200 bg-white">
            {feedbackSnips.map((item) => (
              <li
                key={item.key}
                className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
              >
                <Link
                  href={`/courses/${item.courseId}/${item.lessonId}`}
                  className="text-stone-700 hover:text-indigo-600"
                >
                  Lesson activity
                </Link>
                <span className="font-medium text-stone-900">{item.score}%</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <CourseProgressList courses={courses} progress={progress} />
    </div>
  );
}
