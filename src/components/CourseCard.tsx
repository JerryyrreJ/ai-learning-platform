"use client";

import Link from "next/link";
import { useLearner } from "@/lib/learner-store";
import type { Course } from "@/lib/types";

export function CourseCard({ course }: { course: Course }) {
  const { progress } = useLearner();
  const done = course.lessons.filter((l) => progress[`${course.id}/${l.id}`]?.completedAt).length;
  const pct = Math.round((done / course.lessons.length) * 100);
  const minutes = course.lessons.reduce((sum, l) => sum + l.minutes, 0);

  return (
    <Link
      href={`/courses/${course.id}`}
      className="group flex flex-col rounded-2xl border border-stone-200 bg-white p-6 shadow-sm transition duration-300 hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-[0_12px_32px_rgba(79,70,229,0.12)]"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="grid h-12 w-12 place-items-center rounded-xl bg-gradient-to-br from-indigo-100 via-violet-100 to-fuchsia-100 text-2xl">
          {course.emoji}
        </span>
      </div>
      <h3 className="mt-4 text-lg font-semibold text-stone-900 group-hover:text-indigo-700">{course.title}</h3>
      <p className="mt-1 text-sm leading-relaxed text-stone-600">{course.tagline}</p>
      <p className="mt-4 text-xs text-stone-500">
        {course.level} · {course.lessons.length} lessons · ~{minutes} min
      </p>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-stone-100">
        <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-fuchsia-500 transition-all" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-xs text-stone-500">{done === 0 ? "Not started" : `${done} of ${course.lessons.length} lessons done`}</p>
    </Link>
  );
}
