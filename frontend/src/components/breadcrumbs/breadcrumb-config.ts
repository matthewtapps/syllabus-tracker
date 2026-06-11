import { generatePath, matchPath } from "react-router-dom";

// ---------- Types ----------

export type DynamicKey =
  | "studentName"
  | "studentSyllabusName"
  | "globalSyllabusName";

export interface CrumbDef {
  pattern: string;
  label: string | { dynamic: DynamicKey };
  parent: string | null;
}

/** Intermediate crumb before labels are resolved. */
export interface RawCrumb {
  pattern: string;
  params: Record<string, string>;
  to: string;
  dynamic?: DynamicKey;
  staticLabel?: string;
}

/** Final crumb with label resolved. */
export interface Crumb {
  label: string;
  to?: string;
}

// ---------- Config ----------

export const CRUMB_DEFS: CrumbDef[] = [
  { pattern: "/students", label: "Students", parent: null },
  { pattern: "/student/:id", label: { dynamic: "studentName" }, parent: "/students" },
  { pattern: "/student/:id/syllabi", label: "Syllabi", parent: "/student/:id" },
  {
    pattern: "/student/:id/syllabi/:syllabusId",
    label: { dynamic: "studentSyllabusName" },
    parent: "/student/:id/syllabi",
  },
  { pattern: "/student/:id/pinned", label: "Pinned", parent: "/student/:id" },
  { pattern: "/student/:id/activity", label: "Timeline", parent: "/student/:id" },
  { pattern: "/library", label: "Library", parent: null },
  { pattern: "/syllabi", label: "Syllabus library", parent: null },
  { pattern: "/syllabi/:id", label: { dynamic: "globalSyllabusName" }, parent: "/syllabi" },
  { pattern: "/profile", label: "Profile", parent: null },
  { pattern: "/admin", label: "Admin", parent: null },
];

// ---------- Pure builder ----------

/**
 * Builds a root-first crumb chain for the given pathname and role.
 *
 * Returns [] if no CRUMB_DEF matches the pathname.
 * When role === "student" the leading /students crumb is suppressed.
 */
export function buildCrumbChain(
  pathname: string,
  role: string,
): RawCrumb[] {
  // 1. Find the most specific matching def.
  let matchedDef: CrumbDef | null = null;
  let matchedParams: Record<string, string> = {};

  for (const def of CRUMB_DEFS) {
    const m = matchPath({ path: def.pattern, end: true }, pathname);
    if (m) {
      // matchPath returns params typed as Readonly<Params<string>>; cast to plain record.
      const params: Record<string, string> = {};
      for (const [k, v] of Object.entries(m.params)) {
        if (typeof v === "string") params[k] = v;
      }
      matchedDef = def;
      matchedParams = params;
      break;
    }
  }

  if (!matchedDef) return [];

  // 2. Walk the parent chain, building each crumb.
  const chain: RawCrumb[] = [];
  let current: CrumbDef | null = matchedDef;

  while (current !== null) {
    const to = generatePath(current.pattern, matchedParams);
    const raw: RawCrumb = {
      pattern: current.pattern,
      params: matchedParams,
      to,
    };
    if (typeof current.label === "string") {
      raw.staticLabel = current.label;
    } else {
      raw.dynamic = current.label.dynamic;
    }
    chain.unshift(raw); // prepend so chain is root-first

    if (current.parent === null) break;
    const parentDef = CRUMB_DEFS.find((d) => d.pattern === current!.parent) ?? null;
    current = parentDef;
  }

  // 3. Role filter: students don't have a student-list page.
  if (role === "student") {
    const idx = chain.findIndex((c) => c.pattern === "/students");
    if (idx !== -1) chain.splice(idx, 1);
  }

  return chain;
}
