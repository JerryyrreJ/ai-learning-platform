"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CourseCard } from "@/components/CourseCard";
import { useLearner } from "@/lib/learner-store";
import type { Course } from "@/lib/types";

/**
 * The course catalogue is a library, not a landing page: one heading, a search
 * box and level filters, then the courses themselves.
 */
export function CourseCatalogue({
  courses,
  signedIn,
}: {
  courses: Course[];
  signedIn: boolean;
}) {
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState("All");
  const { progress } = useLearner();

  const levels = useMemo(
    () => ["All", ...Array.from(new Set(courses.map((course) => course.level)))],
    [courses],
  );

  function started(course: Course) {
    return course.lessons.some((lesson) => {
      const p = progress[`${course.id}/${lesson.id}`];
      return !!p?.completedAt || Object.values(p?.blocks ?? {}).some((b) => b.done);
    });
  }

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return courses
      .map((course, index) => ({ course, index }))
      .filter(({ course }) => {
        if (level !== "All" && course.level !== level) return false;
        if (!q) return true;
        return [course.title, course.tagline, course.description, course.domain ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(q);
      })
      // Courses in progress come first; everything else keeps catalogue order.
      .sort(
        (a, b) =>
          Number(started(b.course)) - Number(started(a.course)) ||
          a.index - b.index,
      )
      .map(({ course }) => course);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- progress drives the order
  }, [courses, level, query, progress]);

  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 pt-12 sm:pt-16">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-stone-900 sm:text-4xl">
            Courses
          </h1>
          <p className="mt-2 max-w-xl leading-relaxed text-stone-600">
            Short, hands-on courses built by teachers. Work through real scenarios
            and get feedback that matches how you like to learn.
          </p>
        </div>
        <Link
          href={signedIn ? "/dashboard" : "/onboarding"}
          className="inline-flex items-center justify-center rounded-full border border-stone-300 bg-white px-5 py-2 text-sm font-medium text-stone-700 transition hover:bg-stone-100"
        >
          {signedIn ? "My progress" : "Personalise my learning"}
        </Link>
      </header>

      <div className="mt-8 flex flex-wrap items-center gap-3 border-b border-stone-200 pb-4">
        <div>
          <label htmlFor="course-search" className="sr-only">
            Search courses
          </label>
          <input
            id="course-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search courses"
            className="w-full rounded-full border border-stone-300 bg-white px-4 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100 sm:w-64"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {levels.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setLevel(option)}
              aria-pressed={level === option}
              className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
                level === option
                  ? "bg-stone-900 text-white"
                  : "border border-stone-300 bg-white text-stone-600 hover:bg-stone-100"
              }`}
            >
              {option}
            </button>
          ))}
        </div>
        <p className="ml-auto text-sm text-stone-500">
          {shown.length} {shown.length === 1 ? "course" : "courses"}
        </p>
      </div>

      {shown.length ? (
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((course) => (
            <CourseCard key={course.id} course={course} />
          ))}
        </div>
      ) : (
        <p className="mt-10 rounded-2xl border border-dashed border-stone-300 bg-white p-8 text-center text-sm text-stone-600">
          No courses match “{query}”. Try a different search or level.
        </p>
      )}
    </div>
  );
}
