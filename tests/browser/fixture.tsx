import { createRoot } from "react-dom/client";
import { Desktop } from "../../src/components/projects/desktop/Desktop";

createRoot(document.getElementById("root")!).render(
  <main className="h-dvh overflow-hidden">
    <Desktop
      scenarioId="harbour-clinic"
      title="Harbour Clinic booking board"
      summary="Local browser regression fixture"
      client={{ name: "Grace Wong", role: "Practice manager", organisation: "Harbour Clinic" }}
    />
  </main>,
);
