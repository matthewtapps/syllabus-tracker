/**
 * The single source of truth for "what is this activity row about, and how do we
 * render it". Every feed consumer (tile dispatch, breadcrumb, gating) is a pure
 * projection of `resolveFeedItem`, so the taxonomy lives in ONE place and the
 * parallel verb/anchor switches that used to drift (tile-kind vs view-context vs
 * the header) can no longer disagree.
 *
 * Modelled on ActivityStreams (actor-verb-object): `Subject` is the object the
 * activity is about; the renderer dispatches polymorphically on `subject.kind`,
 * never on the verb.
 */
import type { ActivityRow } from "./activity-line";
import type { AnchorKind } from "./api";
import { activityCaption, type ActivityCaption } from "./activity-caption";
import {
  activitySurface,
  isGatedEpicRow,
  rowToViewContext,
  viewContextHref,
  viewContextSurfaceHref,
  type ViewContext,
} from "./view-context";

/**
 * The object the activity surfaces, at the altitude we render it.
 *
 * - `video`: anything carrying a video (a watch, an add, a comment on a video)
 *   surfaces the video player itself.
 *   `focusThreadId` set = a comment on the video (show that thread, collapse the
 *   rest); null = a watch/add (collapse the discussion entirely).
 * - `technique`: a technique-anchored action surfaces the COLLAPSED technique
 *   row. `thread` set = a comment on the technique/sst (show that one thread
 *   below the collapsed row); null = a plain action (attempt/status/pin/edit).
 * - `thread`: a thread with no technique/video noun (profile or camp anchor)
 *   surfaces the thread directly.
 * - `none`: header-only (assignment/graduation, gated camp/competition verbs).
 */
export interface FocusThread {
  anchorKind: AnchorKind;
  anchorId: number;
  threadId: number;
}

export type Subject =
  | {
      kind: "video";
      videoId: number;
      techniqueId: number | null;
      context: ViewContext | null;
      /** Set = a comment on the video (show that thread); null = a watch/add. */
      focusThreadId: number | null;
    }
  | { kind: "technique"; thread: FocusThread | null }
  | { kind: "thread"; anchorKind: AnchorKind; anchorId: number; threadId: number }
  | { kind: "none" };

/** One breadcrumb segment: a deep-linked step on the path to the subject. */
export interface Crumb {
  label: string;
  href?: string;
  /** Drives the leading icon for a surface crumb (syllabus/library/camp). */
  surfaceKind?: "library" | "syllabus" | "camp" | "competition" | "match";
}

export interface FeedItem {
  /** What to embed, and how. The renderer switches on `subject.kind`. */
  subject: Subject;
  /** The bare verb caption (the breadcrumb + tile carry the nouns). */
  caption: ActivityCaption;
  /** Surface → noun crumbs, after the actor/target the header renders itself. */
  path: Crumb[];
  /** True for the camp/competition/match epic that is hidden on production. */
  gated: boolean;
}

/** The one place the row's meaning is decided. Pure; never throws. */
export function resolveFeedItem(row: ActivityRow): FeedItem {
  const context = rowToViewContext(row);
  return {
    subject: resolveSubject(row, context),
    caption: activityCaption(row),
    path: buildPath(row, context),
    gated: isGatedEpicRow(row),
  };
}

function resolveSubject(row: ActivityRow, context: ViewContext | null): Subject {
  const isComment = row.verb === "thread_comment_posted";

  // 1. A video present means the activity is about the video. A comment carries
  //    the focus thread; a watch/add does not (its discussion stays collapsed).
  if (row.video_id != null) {
    return {
      kind: "video",
      videoId: row.video_id,
      techniqueId: row.technique_id,
      context,
      focusThreadId: isComment ? row.thread_id : null,
    };
  }

  // 2. A comment without a video: route by anchor. Camp/profile threads have no
  //    technique noun (render the thread); a technique/sst comment surfaces the
  //    collapsed technique row plus that one thread.
  if (isComment) {
    if (row.thread_id == null) return { kind: "none" };
    if (row.camp_id != null) {
      return { kind: "thread", anchorKind: "camp", anchorId: row.camp_id, threadId: row.thread_id };
    }
    if (row.technique_id == null && row.sst_id == null && row.target_student_id != null) {
      return {
        kind: "thread",
        anchorKind: "student_profile",
        anchorId: row.target_student_id,
        threadId: row.thread_id,
      };
    }
    if (row.technique_id != null || row.sst_id != null) {
      // sst-context comment anchors on the sst; a library comment on the technique.
      const onSst = row.context_kind === "syllabus" && row.sst_id != null;
      return {
        kind: "technique",
        thread: {
          anchorKind: onSst ? "sst" : "technique",
          anchorId: onSst ? row.sst_id! : row.technique_id!,
          threadId: row.thread_id,
        },
      };
    }
    return { kind: "none" };
  }

  // 3. Any other technique-anchored verb surfaces the collapsed technique row.
  if (row.technique_id != null) {
    return { kind: "technique", thread: null };
  }

  // 4. No renderable noun (assignment/graduation, camp_created, competition,
  //    match_logged): header-only.
  return { kind: "none" };
}

/**
 * The breadcrumb path AFTER the actor/target the header prints: the surface root
 * (deep-linked to the surface, not the technique) then the technique noun
 * (deep-linked to the technique in that surface). This is the "Demo Coach →
 * Global Technique Library → Scissor Sweep" chain; the actor is prepended by the
 * header, the surface and noun come from here.
 */
function buildPath(row: ActivityRow, context: ViewContext | null): Crumb[] {
  if (!context) return [];
  const crumbs: Crumb[] = [];

  const surface = activitySurface(row);
  if (surface) {
    crumbs.push({
      label: surface.label,
      href: viewContextSurfaceHref(context),
      surfaceKind: surface.kind,
    });
  }

  // The technique noun, deep-linked. sst-anchored thread comments carry no
  // technique name (the anchor doesn't denormalise it), so the crumb is simply
  // omitted there and the embedded row names the technique instead.
  if (row.technique_name && (context.kind === "library" || context.kind === "syllabus")) {
    crumbs.push({ label: row.technique_name, href: viewContextHref(context) });
  }

  return crumbs;
}
