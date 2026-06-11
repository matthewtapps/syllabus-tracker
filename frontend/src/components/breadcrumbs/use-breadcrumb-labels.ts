import { useAllUsers, useSyllabi, useStudentSyllabi } from "@/lib/queries";
import type { DynamicKey, RawCrumb } from "./breadcrumb-config";

/**
 * Resolves dynamic label keys in a RawCrumb chain to human-readable strings.
 *
 * All hooks are called unconditionally (rules of hooks). Queries are
 * enabled-gated where an id may be absent. Falls back to sensible strings
 * while loading or when data is unavailable.
 *
 * @returns a function that maps a RawCrumb to its resolved label string.
 */
export function useBreadcrumbLabels(chain: RawCrumb[]): (crumb: RawCrumb) => string {
  // Extract param values used by dynamic resolvers. May be undefined when the
  // current route doesn't include those segments.
  const studentIdRaw = chain.find((c) => c.params.id !== undefined)?.params.id;
  const syllabusIdRaw = chain
    .find((c) => c.params.syllabusId !== undefined)
    ?.params.syllabusId;
  const globalSyllabusIdRaw = chain.find((c) => c.params.id !== undefined && c.pattern === "/syllabi/:id")?.params.id;

  const studentId = studentIdRaw !== undefined ? Number(studentIdRaw) : undefined;
  const syllabusId = syllabusIdRaw !== undefined ? Number(syllabusIdRaw) : undefined;
  const globalSyllabusId =
    globalSyllabusIdRaw !== undefined ? Number(globalSyllabusIdRaw) : undefined;

  // --- studentName: look up from the all-users list ---
  const allUsersQuery = useAllUsers();
  const studentUser =
    typeof studentId === "number" && Number.isFinite(studentId)
      ? (allUsersQuery.data ?? []).find((u) => u.id === studentId)
      : undefined;
  const studentName = studentUser
    ? studentUser.display_name || studentUser.username
    : "Student";

  // --- studentSyllabusName: look up from the student's syllabus assignments ---
  const studentSyllabiQuery = useStudentSyllabi(studentId);
  const studentSyllabusEntry =
    typeof syllabusId === "number" && Number.isFinite(syllabusId)
      ? (studentSyllabiQuery.data ?? []).find((s) => s.id === syllabusId)
      : undefined;
  const studentSyllabusName = studentSyllabusEntry
    ? studentSyllabusEntry.syllabus_name
    : "Syllabus";

  // --- globalSyllabusName: look up from the global syllabi list ---
  const syllabiQuery = useSyllabi();
  const globalSyllabusEntry =
    typeof globalSyllabusId === "number" && Number.isFinite(globalSyllabusId)
      ? (syllabiQuery.data ?? []).find((s) => s.id === globalSyllabusId)
      : undefined;
  const globalSyllabusName = globalSyllabusEntry
    ? globalSyllabusEntry.name
    : "Syllabus";

  const resolvers: Record<DynamicKey, string> = {
    studentName,
    studentSyllabusName,
    globalSyllabusName,
  };

  return (crumb: RawCrumb): string => {
    if (crumb.staticLabel !== undefined) return crumb.staticLabel;
    if (crumb.dynamic !== undefined) return resolvers[crumb.dynamic];
    return "";
  };
}
