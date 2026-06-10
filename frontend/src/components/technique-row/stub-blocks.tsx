// Placeholders for the student-syllabus blocks (PR 3 + PR 4). Listed in
// BLOCK_VISIBILITY so the expanded-panel orchestrator can iterate without
// branching, but they render nothing until their owning PRs land.

export function NotesStudentBlock() {
  return null;
}

export function NotesCoachBlock() {
  return null;
}

export function AttemptsBlock() {
  return null;
}

export function EditDefinitionBlock() {
  // The description-block's inline edit affordance covers PR 1's edit
  // surface. This block stays as a registered slot for PR 4's syllabus-
  // context coach edits.
  return null;
}

export function RemoveFromSyllabusBlock() {
  return null;
}

export function HiddenToggleBlock() {
  return null;
}

export function VideoVisibilityOverrideBlock() {
  return null;
}
