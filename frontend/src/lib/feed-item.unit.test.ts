import { describe, expect, it } from "vitest";
import { resolveFeedItem } from "./feed-item";
import type { ActivityRow } from "./activity-line";

function row(overrides: Partial<ActivityRow>): ActivityRow {
  return {
    id: 1,
    occurred_at: "2026-06-18 00:00:00",
    verb: "attempt_logged",
    actor_user_id: 2,
    actor_name: "Alex",
    target_student_id: 4,
    target_student_name: "Bianca",
    technique_id: 3,
    technique_name: "Armbar",
    syllabus_id: 2,
    syllabus_name: "White Belt Fundamentals",
    sst_id: 5,
    video_id: null,
    video_title: null,
    payload_json: null,
    unread: false,
    context_kind: "syllabus",
    thread_id: null,
    camp_id: null,
    camp_name: null,
    competition_id: null,
    competition_name: null,
    match_id: null,
    comment_count: 0,
    ...overrides,
  };
}

describe("resolveFeedItem subject", () => {
  it("surfaces a video with no focus thread for a watch", () => {
    const item = resolveFeedItem(
      row({ verb: "video_watched", video_id: 11, video_title: "Drill", context_kind: "library", sst_id: null }),
    );
    expect(item.subject).toEqual({
      kind: "video",
      videoId: 11,
      techniqueId: 3,
      context: expect.anything(),
      focusThreadId: null,
    });
  });

  it("surfaces a video with the focus thread for a comment on a video", () => {
    const item = resolveFeedItem(
      row({ verb: "thread_comment_posted", thread_id: 7, video_id: 11, context_kind: "library", sst_id: null }),
    );
    expect(item.subject).toMatchObject({ kind: "video", videoId: 11, focusThreadId: 7 });
  });

  it("surfaces the collapsed technique row (no thread) for an attempt", () => {
    expect(resolveFeedItem(row({})).subject).toEqual({ kind: "technique", thread: null });
  });

  it("surfaces the collapsed technique row (no thread) for a pin", () => {
    expect(resolveFeedItem(row({ verb: "technique_pinned", sst_id: null, context_kind: "library" })).subject).toEqual({
      kind: "technique",
      thread: null,
    });
  });

  it("attaches the focus thread for a sst comment", () => {
    expect(
      resolveFeedItem(row({ verb: "thread_comment_posted", thread_id: 7, context_kind: "syllabus" })).subject,
    ).toEqual({ kind: "technique", thread: { anchorKind: "sst", anchorId: 5, threadId: 7 } });
  });

  it("attaches the focus thread for a library technique comment", () => {
    expect(
      resolveFeedItem(
        row({ verb: "thread_comment_posted", thread_id: 7, context_kind: "library", sst_id: null }),
      ).subject,
    ).toEqual({ kind: "technique", thread: { anchorKind: "technique", anchorId: 3, threadId: 7 } });
  });

  it("routes a camp comment to the camp thread", () => {
    expect(
      resolveFeedItem(
        row({ verb: "thread_comment_posted", thread_id: 7, context_kind: "camp", camp_id: 9, technique_id: null, sst_id: null }),
      ).subject,
    ).toEqual({ kind: "thread", anchorKind: "camp", anchorId: 9, threadId: 7 });
  });

  it("routes a profile comment to the student profile thread", () => {
    expect(
      resolveFeedItem(
        row({ verb: "thread_comment_posted", thread_id: 7, context_kind: null, technique_id: null, sst_id: null, target_student_id: 4 }),
      ).subject,
    ).toEqual({ kind: "thread", anchorKind: "student_profile", anchorId: 4, threadId: 7 });
  });

  it("is header-only for an assignment", () => {
    expect(resolveFeedItem(row({ verb: "syllabus_assigned", technique_id: null, sst_id: null })).subject).toEqual({
      kind: "none",
    });
  });

  it("surfaces the technique row for a technique added to a camp", () => {
    const item = resolveFeedItem(
      row({ verb: "camp_technique_added", context_kind: "camp", camp_id: 9, camp_name: "Winter Prep", sst_id: null }),
    );
    expect(item.subject).toEqual({ kind: "technique", thread: null });
    expect(item.gated).toBe(true);
  });

  it("is header-only and gated for camp_created", () => {
    const item = resolveFeedItem(
      row({ verb: "camp_created", context_kind: "camp", camp_id: 9, technique_id: null, sst_id: null }),
    );
    expect(item.subject).toEqual({ kind: "none" });
    expect(item.gated).toBe(true);
  });
});

describe("resolveFeedItem path", () => {
  it("builds surface → technique for a library video", () => {
    const item = resolveFeedItem(
      row({ verb: "video_watched", video_id: 11, video_title: "Drill", context_kind: "library", sst_id: null }),
    );
    expect(item.path).toEqual([
      { label: "Global Technique Library", href: "/library", surfaceKind: "library" },
      { label: "Armbar", href: "/library?focus=technique:3&video=11" },
    ]);
  });

  it("builds syllabus → technique for a syllabus action", () => {
    const item = resolveFeedItem(row({}));
    expect(item.path[0]).toMatchObject({ label: "White Belt Fundamentals", surfaceKind: "syllabus" });
    expect(item.path[0].href).toBe("/student/4/syllabi/2");
    expect(item.path[1]).toMatchObject({ label: "Armbar" });
  });

  it("has no path for a profile thread", () => {
    const item = resolveFeedItem(
      row({ verb: "thread_comment_posted", thread_id: 7, context_kind: null, technique_id: null, sst_id: null }),
    );
    expect(item.path).toEqual([]);
  });

  it("links the promote-camp tile to the camp, not the competition", () => {
    // The camp is the navigable noun; the competition is named only in the caption.
    const item = resolveFeedItem(
      row({
        verb: "camp_promoted_to_competition",
        context_kind: "competition",
        camp_id: 7,
        camp_name: "Worlds Camp",
        competition_id: 3,
        competition_name: "Worlds",
        technique_id: null,
        sst_id: null,
        syllabus_id: null,
        syllabus_name: null,
      }),
    );
    expect(item.path).toContainEqual({
      surfaceKind: "camp",
      label: "Worlds Camp",
      href: "/camps/7",
    });
  });
});

/**
 * One assertion per verb of the full taxonomy: what embeds beneath the header
 * (subject), the bare caption, and the surface breadcrumb (label + deep link).
 * This is the contract that every kind of social tile is surfaced correctly; a
 * new verb or a regression in any of the three projections fails here loudly.
 */
describe("every activity verb surfaces correctly", () => {
  interface Case {
    name: string;
    verb: ActivityRow["verb"];
    over: Partial<ActivityRow>;
    subject: unknown;
    caption: string;
    /** Expected first breadcrumb crumb, or null when the row has no surface. */
    surface: { label: string; href: string } | null;
    gated?: boolean;
  }

  const SYLLABUS = { label: "White Belt Fundamentals", href: "/student/4/syllabi/2" };
  const LIBRARY = { label: "Global Technique Library", href: "/library" };
  const technique = { kind: "technique", thread: null };
  const video = (focusThreadId: number | null) => ({
    kind: "video",
    videoId: 11,
    techniqueId: 3,
    context: expect.anything(),
    focusThreadId,
  });

  const cases: Case[] = [
    // --- attempts (syllabus, technique row) ---
    { name: "attempt_logged", verb: "attempt_logged", over: {}, subject: technique, caption: "Logged an attempt", surface: SYLLABUS },
    { name: "attempt_edited", verb: "attempt_edited", over: {}, subject: technique, caption: "Edited an attempt", surface: SYLLABUS },
    { name: "attempt_deleted", verb: "attempt_deleted", over: {}, subject: technique, caption: "Deleted an attempt", surface: SYLLABUS },

    // --- sst (syllabus, technique row) ---
    { name: "sst_status_changed", verb: "sst_status_changed", over: { payload_json: JSON.stringify({ from: "red", to: "green" }) }, subject: technique, caption: "Set to", surface: SYLLABUS },
    { name: "sst_student_notes_edited", verb: "sst_student_notes_edited", over: {}, subject: technique, caption: "Updated student notes", surface: SYLLABUS },
    { name: "sst_coach_notes_edited", verb: "sst_coach_notes_edited", over: {}, subject: technique, caption: "Updated coach notes", surface: SYLLABUS },
    { name: "sst_added", verb: "sst_added", over: {}, subject: technique, caption: "Added", surface: SYLLABUS },
    { name: "sst_hidden", verb: "sst_hidden", over: {}, subject: technique, caption: "Hidden", surface: SYLLABUS },
    { name: "sst_unhidden", verb: "sst_unhidden", over: {}, subject: technique, caption: "Made visible", surface: SYLLABUS },

    // --- pins (library context, no surface crumb) ---
    { name: "technique_pinned", verb: "technique_pinned", over: { context_kind: "library", sst_id: null }, subject: technique, caption: "Pinned", surface: null },
    { name: "technique_unpinned", verb: "technique_unpinned", over: { context_kind: "library", sst_id: null }, subject: technique, caption: "Unpinned", surface: null },

    // --- syllabus-wide events (header-only, syllabus surface) ---
    { name: "syllabus_assigned", verb: "syllabus_assigned", over: { technique_id: null, sst_id: null }, subject: { kind: "none" }, caption: "Assigned", surface: SYLLABUS },
    { name: "syllabus_unassigned", verb: "syllabus_unassigned", over: { technique_id: null, sst_id: null }, subject: { kind: "none" }, caption: "Unassigned", surface: SYLLABUS },
    { name: "syllabus_graduated", verb: "syllabus_graduated", over: { technique_id: null, sst_id: null }, subject: { kind: "none" }, caption: "Graduated", surface: SYLLABUS },

    // --- gym-template curation (syllabus template page, technique row) ---
    { name: "syllabus_technique_added", verb: "syllabus_technique_added", over: { target_student_id: null, sst_id: null, context_kind: null }, subject: technique, caption: "Added", surface: { label: "White Belt Fundamentals", href: "/syllabi/2" } },
    { name: "syllabus_technique_removed", verb: "syllabus_technique_removed", over: { target_student_id: null, sst_id: null, context_kind: null }, subject: technique, caption: "Removed", surface: { label: "White Belt Fundamentals", href: "/syllabi/2" } },

    // --- videos (library, video player) ---
    { name: "video_watched", verb: "video_watched", over: { video_id: 11, video_title: "Drill", context_kind: "library", sst_id: null }, subject: video(null), caption: "Watched Drill", surface: LIBRARY },
    { name: "video_added", verb: "video_added", over: { video_id: 11, video_title: "Setup", context_kind: "library", sst_id: null }, subject: video(null), caption: "Added Setup", surface: LIBRARY },
    { name: "video_visibility_set", verb: "video_visibility_set", over: { video_id: 11, video_title: "Setup", context_kind: "library", sst_id: null }, subject: video(null), caption: "Changed video visibility", surface: LIBRARY },

    // --- library technique edit ---
    { name: "technique_edited", verb: "technique_edited", over: { context_kind: null, sst_id: null }, subject: technique, caption: "Edited", surface: LIBRARY },

    // --- thread comments (anchor-dependent embed) ---
    { name: "comment on sst", verb: "thread_comment_posted", over: { thread_id: 7, context_kind: "syllabus" }, subject: { kind: "technique", thread: { anchorKind: "sst", anchorId: 5, threadId: 7 } }, caption: "Commented", surface: SYLLABUS },
    { name: "comment on video", verb: "thread_comment_posted", over: { thread_id: 7, video_id: 11, video_title: "Drill", context_kind: "library", sst_id: null }, subject: video(7), caption: "Commented", surface: LIBRARY },
    { name: "comment on profile", verb: "thread_comment_posted", over: { thread_id: 7, context_kind: null, technique_id: null, sst_id: null }, subject: { kind: "thread", anchorKind: "student_profile", anchorId: 4, threadId: 7 }, caption: "Commented", surface: null },

    // --- camp epic (gated) ---
    { name: "camp_created", verb: "camp_created", over: { context_kind: "camp", camp_id: 9, camp_name: "Winter Prep", technique_id: null, sst_id: null }, subject: { kind: "none" }, caption: "Started", surface: { label: "Winter Prep", href: "/camps/9" }, gated: true },
    { name: "camp_technique_added", verb: "camp_technique_added", over: { context_kind: "camp", camp_id: 9, camp_name: "Winter Prep", sst_id: null }, subject: technique, caption: "Added", surface: { label: "Winter Prep", href: "/camps/9" }, gated: true },
    { name: "camp_archived", verb: "camp_archived", over: { context_kind: "camp", camp_id: 9, camp_name: "Winter Prep", technique_id: null, sst_id: null }, subject: { kind: "none" }, caption: "Archived", surface: { label: "Winter Prep", href: "/camps/9" }, gated: true },

    // --- competition epic (gated) ---
    { name: "competition_created", verb: "competition_created", over: { context_kind: "competition", competition_id: 8, competition_name: "Summer Open", target_student_id: null, technique_id: null, sst_id: null, syllabus_id: null }, subject: { kind: "none" }, caption: "Created", surface: { label: "Summer Open", href: "/competitions/8" }, gated: true },
    { name: "student_registered", verb: "student_registered", over: { context_kind: "competition", competition_id: 8, competition_name: "Summer Open", technique_id: null, sst_id: null, syllabus_id: null }, subject: { kind: "none" }, caption: "Registered", surface: { label: "Summer Open", href: "/competitions/8" }, gated: true },
    { name: "camp_promoted_to_competition", verb: "camp_promoted_to_competition", over: { context_kind: "competition", competition_id: 8, competition_name: "Summer Open", camp_id: 9, camp_name: "Winter Prep", technique_id: null, sst_id: null, syllabus_id: null }, subject: { kind: "none" }, caption: "Promoted a camp", surface: { label: "Summer Open", href: "/competitions/8" }, gated: true },

    // --- match epic (gated) — links to the owning camp page ---
    { name: "match_logged", verb: "match_logged", over: { context_kind: "competition", competition_id: 8, competition_name: "Summer Open", match_id: 6, camp_id: 9, technique_id: null, sst_id: null, syllabus_id: null }, subject: { kind: "none" }, caption: "Logged a match", surface: { label: "Summer Open", href: "/camps/9" }, gated: true },
    { name: "match_technique_linked", verb: "match_technique_linked", over: { context_kind: "competition", competition_id: 8, competition_name: "Summer Open", match_id: 6, camp_id: 9, sst_id: null, syllabus_id: null }, subject: technique, caption: "Linked to a match", surface: { label: "Summer Open", href: "/camps/9" }, gated: true },
  ];

  it.each(cases)("$name", ({ verb, over, subject, caption, surface, gated }) => {
    const item = resolveFeedItem(row({ verb, ...over }));
    expect(item.subject).toEqual(subject);
    expect(item.caption.text).toBe(caption);
    if (surface) {
      expect(item.path[0]).toMatchObject({ label: surface.label, href: surface.href });
    } else {
      expect(item.path).toEqual([]);
    }
    expect(item.gated).toBe(gated ?? false);
  });
});
