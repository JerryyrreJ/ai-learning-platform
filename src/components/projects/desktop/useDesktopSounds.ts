"use client";

import { useEffect, useRef } from "react";
import type { ProjectView } from "@/lib/projects/runtime";
import { play } from "@/lib/sound";

/**
 * Plays a cue for each change between one project view and the next.
 * Banners and the Dock play their own cues in Desktop, so this only covers
 * what the server's reply changed. The first view (a reload) plays nothing.
 */
export function useDesktopSounds(view: ProjectView | null) {
  const previous = useRef<ProjectView | null>(null);

  useEffect(() => {
    const before = previous.current;
    previous.current = view;
    if (!before || !view) return;

    if (view.interview.turns.length > before.interview.turns.length) play("reply");
    // A new fact lands in the call notes just after Grace's reply.
    if (view.notes.length > before.notes.length) play("fact", 0.25);
    if (view.requirements && !before.requirements) play("send");
    if (view.work && !before.work) play("delivered", 0.2);
    else if (view.brief && !before.brief) play("send");

    const reviews = view.work?.reviews ?? [];
    if (reviews.length > (before.work?.reviews.length ?? 0)) play(reviews[reviews.length - 1].correct ? "review-right" : "review-wrong");
    // Approving the work moves the project on to the release.
    if (before.stage.id === "review" && view.stage.id === "release") play("delivered");

    if (view.completion && !before.completion) {
      const { outcome, cards } = view.completion;
      play(outcome === "success" ? "success" : outcome === "failure" ? "failure" : "partial");
      // One note per card, in the order the report shows them.
      cards.forEach((card, index) => play(card.rating, 0.6 + index * 0.25));
    }
  }, [view]);
}
