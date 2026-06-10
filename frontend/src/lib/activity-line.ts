/**
 * Shared per-verb activity renderer.
 *
 * Maps an ActivityRow (verb + joined entity names + parsed payload_json) to a
 * display line used by the dashboard, student recent-activity surface, and the
 * full activity page. Pure function; does not throw.
 *
 * href conventions (route paths from App.tsx):
 *   technique       -> /library  (no per-technique route exists; library is the
 *                       canonical browse surface for both roles)
 *   video           -> /library?technique=<id>&video=<id>  (existing deep-link
 *                       pattern used in video-overview-card)
 *   syllabus        -> /syllabi/<id>  (coach view; student view needs student id
 *                       which is not always in scope from the renderer alone)
 *   No href when the relevant entity id/name is null (entity was deleted and
 *   the FK was SET NULL).
 */

export interface ActivityRow {
  id: number;
  occurred_at: string;
  verb: string;
  actor_user_id: number;
  actor_name: string | null;
  target_student_id: number | null;
  technique_id: number | null;
  technique_name: string | null;
  syllabus_id: number | null;
  syllabus_name: string | null;
  sst_id: number | null;
  video_id: number | null;
  video_title: string | null;
  payload_json: string | null;
  unread: boolean;
}

export interface ActivityLine {
  text: string;
  href?: string;
}

// Payload shapes mirror the Rust payload constructors in db/activity.rs.
interface SstStatusChangedPayload {
  from: "red" | "amber" | "green";
  to: "red" | "amber" | "green";
}

interface TechniqueEditedPayload {
  fields: {
    name?: true;
    description?: true;
    tags?: { added: string[]; removed: string[] };
  };
}

function parsePayload<T>(json: string | null): T | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

function techniqueHref(row: ActivityRow): string | undefined {
  if (!row.technique_id) return undefined;
  return "/library";
}

function syllabusHref(row: ActivityRow): string | undefined {
  if (!row.syllabus_id) return undefined;
  return `/syllabi/${row.syllabus_id}`;
}

function videoHref(row: ActivityRow): string | undefined {
  if (!row.video_id) return undefined;
  if (row.technique_id) {
    return `/library?technique=${row.technique_id}&video=${row.video_id}`;
  }
  return "/library";
}

/**
 * Maps an ActivityRow to a display line (text + optional deep-link href).
 * Never throws; falls back to plain copy when payload is missing or malformed.
 */
export function activityLine(row: ActivityRow): ActivityLine {
  const tech = row.technique_name;
  const syll = row.syllabus_name;
  const vid = row.video_title;

  switch (row.verb) {
    // --- attempt verbs ---
    case "attempt_logged": {
      return {
        text: tech ? `logged an attempt on ${tech}` : "logged an attempt",
        href: techniqueHref(row),
      };
    }
    case "attempt_edited": {
      return {
        text: tech ? `edited an attempt on ${tech}` : "edited an attempt",
        href: techniqueHref(row),
      };
    }
    case "attempt_deleted": {
      // Non-notifiable; plain history text; still link if technique present.
      return {
        text: tech ? `deleted an attempt on ${tech}` : "deleted an attempt",
        href: techniqueHref(row),
      };
    }

    // --- video verbs ---
    case "video_watched": {
      return {
        text: vid ? `watched ${vid}` : "watched a video",
        href: videoHref(row),
      };
    }
    case "video_added": {
      return {
        text: vid ? `added video ${vid}` : "added a video",
        href: videoHref(row),
      };
    }
    case "video_visibility_set": {
      // Non-notifiable; plain history.
      return {
        text: vid ? `changed visibility of ${vid}` : "changed video visibility",
        href: videoHref(row),
      };
    }

    // --- sst status ---
    case "sst_status_changed": {
      const payload = parsePayload<SstStatusChangedPayload>(row.payload_json);
      if (payload?.to && tech) {
        return {
          text: `went ${payload.to} on ${tech}`,
          href: techniqueHref(row),
        };
      }
      return {
        text: tech ? `updated status on ${tech}` : "updated a technique status",
        href: techniqueHref(row),
      };
    }

    // --- sst notes ---
    case "sst_student_notes_edited": {
      return {
        text: tech ? `updated student notes on ${tech}` : "updated student notes",
        href: techniqueHref(row),
      };
    }
    case "sst_coach_notes_edited": {
      return {
        text: tech ? `updated coach notes on ${tech}` : "updated coach notes",
        href: techniqueHref(row),
      };
    }

    // --- pin verbs ---
    case "technique_pinned": {
      return {
        text: tech ? `pinned ${tech}` : "pinned a technique",
        href: techniqueHref(row),
      };
    }
    case "technique_unpinned": {
      // Non-notifiable; plain history.
      return {
        text: tech ? `unpinned ${tech}` : "unpinned a technique",
        href: techniqueHref(row),
      };
    }

    // --- syllabus assignment verbs ---
    case "syllabus_assigned": {
      return {
        text: syll ? `assigned to ${syll}` : "assigned to a syllabus",
        href: syllabusHref(row),
      };
    }
    case "syllabus_unassigned": {
      // Non-notifiable; plain history.
      return {
        text: syll ? `unassigned from ${syll}` : "unassigned from a syllabus",
        href: syllabusHref(row),
      };
    }
    case "syllabus_graduated": {
      return {
        text: syll ? `graduated ${syll}` : "graduated a syllabus",
        href: syllabusHref(row),
      };
    }

    // --- sst curation verbs ---
    case "sst_added": {
      return {
        text: tech ? `added ${tech} to syllabus` : "added a technique to syllabus",
        href: techniqueHref(row),
      };
    }
    case "sst_hidden": {
      // Non-notifiable; plain history.
      return {
        text: tech ? `hid ${tech}` : "hid a technique",
        href: techniqueHref(row),
      };
    }
    case "sst_unhidden": {
      // Non-notifiable; plain history.
      return {
        text: tech ? `unhid ${tech}` : "unhid a technique",
        href: techniqueHref(row),
      };
    }

    // --- syllabus technique fanout verbs ---
    case "syllabus_technique_added": {
      if (tech && syll) {
        return {
          text: `added ${tech} to ${syll}`,
          href: syllabusHref(row),
        };
      }
      return {
        text: tech ? `added ${tech} to a syllabus` : "added a technique to a syllabus",
        href: syllabusHref(row) ?? techniqueHref(row),
      };
    }
    case "syllabus_technique_removed": {
      // Non-notifiable; plain history.
      if (tech && syll) {
        return {
          text: `removed ${tech} from ${syll}`,
          href: syllabusHref(row),
        };
      }
      return {
        text: tech
          ? `removed ${tech} from a syllabus`
          : "removed a technique from a syllabus",
        href: syllabusHref(row) ?? techniqueHref(row),
      };
    }

    // --- technique edited fanout ---
    case "technique_edited": {
      const payload = parsePayload<TechniqueEditedPayload>(row.payload_json);
      // The payload shape records which fields changed, but the display line
      // just says "edited X" regardless of which fields (keeps copy concise).
      void payload; // parsed but not needed for copy
      return {
        text: tech ? `edited ${tech}` : "edited a technique",
        href: techniqueHref(row),
      };
    }

    default: {
      return { text: "performed an action" };
    }
  }
}
