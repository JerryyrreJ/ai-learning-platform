import Link from "next/link";
import { notFound } from "next/navigation";
import { CoursePreferences } from "@/components/learning/CoursePreferences";
import { LessonList } from "@/components/LessonList";
import { readCourse } from "@/lib/learning/repository";

export default async function CoursePage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  const course = await readCourse(courseId);
  if (!course) notFound();

  const minutes = course.lessons.reduce((sum, lesson) => sum + lesson.minutes, 0);

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:py-16">
      <Link href="/courses" className="text-sm text-stone-500 transition hover:text-stone-900">
        ← All courses
      </Link>
      <div className="mt-6 flex items-start gap-4">
        <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-indigo-100 via-violet-100 to-fuchsia-100 text-3xl">
          {course.emoji}
        </span>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-600">
            {course.level}
          </p>
          <h1 className="mt-2 text-balance text-3xl font-bold tracking-tight text-stone-900 sm:text-4xl">
            {course.title}
          </h1>
        </div>
      </div>
      <p className="mt-5 text-lg text-stone-600">{course.tagline}</p>
      <p className="mt-3 leading-relaxed text-stone-700">{course.description}</p>
      <p className="mt-4 text-sm text-stone-500">
        {course.lessons.length} lessons · about {minutes} min
      </p>
      <CoursePreferences courseId={course.id} />
      <LessonList course={course} />
    </div>
  );
}
