/**
 * A typed reference to an addressable entity. Closed union so both the URL
 * serializer and every page consumer switch exhaustively. This is the
 * Rails-polymorphic / Relay-node "(type, id)" idea, constrained for
 * compiler-checked safety. Add a member here when a new deep-linkable kind
 * arrives (camp, match, video_thread, comment, ...).
 */
export type EntityRef =
  | { type: "technique"; id: number }
  | { type: "video"; id: number }
  | { type: "sst"; id: number }
  | { type: "syllabus"; id: number }
  | { type: "student"; id: number };

export type EntityType = EntityRef["type"];

// Keyed by every EntityType, so adding a member to EntityRef without listing it
// here is a compile error rather than a silent parse miss.
const ENTITY_TYPE_LOOKUP: Record<EntityType, true> = {
  technique: true,
  video: true,
  sst: true,
  syllabus: true,
  student: true,
};

function isEntityType(value: string): value is EntityType {
  return Object.prototype.hasOwnProperty.call(ENTITY_TYPE_LOOKUP, value);
}

/** Serialize an EntityRef to its URL token form, e.g. "sst:42". */
export function refToken(ref: EntityRef): string {
  return `${ref.type}:${ref.id}`;
}

/**
 * Parse a "<type>:<id>" focus token back into an EntityRef. Returns null for
 * null/empty input, unknown types, or a non-integer id. Never throws.
 */
export function parseFocusToken(raw: string | null | undefined): EntityRef | null {
  if (!raw) return null;
  const parts = raw.split(":");
  if (parts.length !== 2) return null;
  const [type, rawId] = parts;
  if (!isEntityType(type)) return null;
  if (!/^\d+$/.test(rawId)) return null;
  const id = Number.parseInt(rawId, 10);
  if (!Number.isSafeInteger(id)) return null;
  return { type, id };
}
