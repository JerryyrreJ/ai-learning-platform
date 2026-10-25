import { harbourClinic } from "../../src/lib/projects/harbour-clinic";
import { offlineEvaluator } from "../../src/lib/projects/evaluate";
import {
  askClient,
  chooseAction,
  endInterview,
  projectView,
  startProject,
  submitRequirements,
  type ProjectStep,
} from "../../src/lib/projects/runtime";
import type { SimulationHistory } from "../../src/lib/learning/simulation/engine";

// Use real runtime transitions rather than a hand-written approximation of the
// public view. This runs only in Node; scenario answers never enter the bundle.
export async function viewFor(stage: "interview" | "requirements" | "brief") {
  let state = startProject(harbourClinic);
  const history: SimulationHistory = [];
  function step(result: ProjectStep) {
    state = result.state;
    history.push(...result.events);
  }
  step(chooseAction(harbourClinic, state, "pick-engineering"));
  step(chooseAction(harbourClinic, state, "call-grace"));
  if (stage !== "interview") {
    for (const question of ["Why do double bookings happen?", "What happens when a booking is cancelled?", "Who uses the booking board?"]) {
      state = (await askClient(harbourClinic, state, question, offlineEvaluator)).state;
    }
    step(endInterview(harbourClinic, state));
  }
  if (stage === "brief") {
    step(await submitRequirements(harbourClinic, state, "Preserve cancelled bookings and prevent double bookings.", offlineEvaluator));
  }
  return projectView(harbourClinic, state, history);
}
