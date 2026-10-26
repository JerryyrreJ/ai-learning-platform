"use client";

// Space kept clear above the target for the fixed navbar, and below the player.
const NAV_CLEARANCE = 112;
const BOTTOM_GAP = 24;

/**
 * Glides to the tour section. If the heading and the whole player fit on
 * screen it shows both; on a short screen it scrolls further so the player's
 * bottom edge, with its controls, is not cut off. Without JavaScript the plain
 * #tour link still jumps there.
 */
export function TourLink({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <a
      href="#tour"
      className={className}
      onClick={(event) => {
        const section = document.getElementById("tour");
        const player = document.getElementById("tour-player");
        if (!section || !player) return;
        event.preventDefault();
        const sectionTop = section.getBoundingClientRect().top + window.scrollY;
        const box = player.getBoundingClientRect();
        const playerTop = box.top + window.scrollY;
        const playerBottom = playerTop + box.height;
        const showAll = sectionTop - NAV_CLEARANCE;
        // Scroll just far enough to bring the player's bottom on screen, never past its top.
        const top = Math.min(Math.max(showAll, playerBottom + BOTTOM_GAP - window.innerHeight), playerTop - NAV_CLEARANCE);
        const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        window.scrollTo({ top, behavior: still ? "instant" : "smooth" });
        history.pushState(null, "", "#tour");
      }}
    >
      {children}
    </a>
  );
}
