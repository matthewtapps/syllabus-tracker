# Sillybus ongoing-use, concepts primer

## Why this doc exists

Sillybus today is built around a student's syllabus: a coach assigns techniques, the student marks them red/amber/green, and once they're all green, the student graduates. That's a manifest, a finite checklist with a finish line.

This doc captures a set of ideas that turn Sillybus into something a coach and student actively use week-to-week, independent of where a student is on their syllabus. The shift is from "manifest" to "workspace": the app holds your competition prep, your training history, your conversations with the coach, and the videos that go with all of that.

The concepts below are what the user stories assume. Read this first, then the stories will make sense.

## The student profile, expanded

Today a "student" is a thin record (name, role, syllabus assignments). The proposal is to develop that profile to also hold:

- **Rank**: belt, stripe count, date of last grading. Visible to the student and to coaches.
- **Camps** (see below): things they're currently working on, with the coach.
- **Pinned techniques**: techniques they've pinned to their personal working-on list, separate from any syllabus.
- **Activity feed**: a scrolling history of conversations, videos, camps, matches, pins, comments, and rank changes relating to that student.

The syllabus stays first-class. It's still how a student progresses through a curriculum. It just becomes a separate dedicated tab on the profile, alongside Activity / Pinned / Camps, rather than being the default mixed view it is today.

## Camps

A **Camp** is the central new concept. A camp is a stretch of intentional work between a student and their coach: a focused project, a few techniques to drill, with videos and notes attached.

There are two flavours:

- **Generic camp**: "Matty is working on X guard right now." No date, no event, just a thing to focus on.
- **Competition camp**: a generic camp plus competition metadata (event name and date). Carries extra optional details like a match log and post-competition analysis.

A camp can start generic and be **promoted to a competition camp** later. The coach builds an x-guard camp, a tournament comes up where x-guard would be useful, and they bolt the comp metadata on without starting over.

The coach creates camps. For competition camps, students opt in by registering for the competition (or the coach adds them). For generic camps, the coach creates them per-student directly.

### What lives inside a camp

- **Camp techniques**, the techniques the student is focusing on. These can be: (a) picked from the global library, (b) created fresh and added to the global library at the same time, or (c) created fresh but scoped only to this camp/student. The coach chooses (b) or (c) at creation time so the decision is explicit. Scoped techniques can be **promoted to the global library later** if they turn out to be useful for others, optionally bringing existing content (videos, notes) along.
- **Videos**, uploaded to the camp directly, to a technique in the camp, or (for competition camps) to a specific match for post-match analysis. Coach or student can upload. When a video is uploaded inside a camp on a technique that exists in the global library, a coach uploader can choose whether the video is scoped to the camp or promoted to the global technique.
- **Per-camp video visibility**: the coach can hide specific library videos from a student within a single camp ("for this student on this comp, I hide all the videos that aren't relevant to their preparation"), without affecting their view of the technique elsewhere (the global library/their syllabus).
- **Matches** (competition camps only): the coach or the student optionally record each match's result (win/loss/draw) and how (submission with detail, points, decision). Raw match videos can be attached to the match itself. Post-competition, the coach can attach camp techniques to specific matches as analysis ("in this match, we saw you need to drill your kimura escapes").

### Match opponents

We are not recording opponent information at all for now: no name, no academy, nothing. The goal is to keep the data minimal and the privacy footprint small. A match is "won by armbar," not "won by armbar against Joe at Atos." If this turns out to be a blocker, we revisit.

### Footage review and the next-camp flow

The dominant real-world use of competition footage isn't a general post-comp retrospective. It's preparation for the next thing. Students typically watch their own match footage after the dust settles, spot a moment that bothered them, and bring it to their coach to discuss. From that conversation, a new camp tends to take shape.

Sillybus mirrors that flow:

- Students can review their historical match footage in detail and **start threads on specific moments** to flag them for the coach.
- While reviewing, students can **suggest a technique from the global library** to be added to their next camp ("I think I need to work on this specifically"). The suggestion lands in the coach's queue.
- The coach reviews suggestions and either approves, replaces with a different technique they think fits better, or dismisses.
- When the coach starts a **new camp** for the student, they can **explicitly reference a previous camp** as its origin, and reference specific matches, threads, and techniques from it directly. Raw match footage from a previous camp is referenceable as first-class content in the new camp.

This puts more of the curation burden on the student (where they're best placed to feel what went wrong) and reduces the coach's overhead for setting up the next prep cycle.

## Threads, video replies, and @-mentions

Conversations in Sillybus happen in **threads**. A thread is a top-level post (with a body, optionally containing media or technique/specific video @-mentions) plus replies underneath.

Threads can be attached to:

- A specific timestamp on a video (e.g. "at 0:42 your hand position is wrong")
- A camp (general discussion about the camp, not anchored to a video)
- A student's profile (general questions, ad-hoc check-ins)

Replies in a thread can be text, **video replies**, or both. A coach can record a quick demo as a video reply, or a student can post a follow-up clip showing the change. Video replies can be commented on within their thread but can't spawn new threads themselves, to avoid endless chains.

When a comment body contains an **@-mention** to a technique or a video, it inlines as a card the reader can tap to open. If the mentioned video isn't visible to the recipient student (the coach has hidden it from them globally), the author gets a prompt to make it visible before the mention is published.

### Who can see what

- Comments on a **camp video or thread**: visible to that student and to any coach.
- **Coach broadcast comments** on a library video: visible to every student who can see that video. Think "adding context to a video after the fact as a comment, visible at the given timestamp, while watching the video, because every student asks the same question about this part and I don't have time to record a whole new video to address it".
- **Student private comments** on a library video: visible to that student and to coaches. Other students do not see them.
- **Reply visibility** inherits the parent's visibility.

Students cannot see each other's library questions. Coaches see all of it.

### Reactions

Emoji reactions are a phase-2 idea: useful for low-effort acknowledgement ("got it", "good clip") without typing. Not in v1.

## Activity feed

The default view of a student profile is an **activity feed**: a reverse-chronological list of everything that happened (most recent at the top). Items include new threads, replies, video uploads, camp creations/activity, pinned techniques, library comments, match logs, rank changes, and so on. Filter chips at the top let the viewer narrow to one kind of item. A search box allows searching across technique names, camp details, and comment bodies.

The student sees their own feed. Any coach sees the feed for any student they look at. Other students don't see each other's feeds.

## Self-directed library access

Today, students only see techniques their coach has assigned to them. We're opening that up: any student can browse the full global technique library and watch any non-hidden video.

A student can **pin** a technique to their personal "working on" list, separate from any syllabus assignment. They can take notes on it, leave private timestamped comments on its videos, and ask their coach questions inline. There's no red/amber/green status here (status is a syllabus concept) and attempts aren't tracked here (attempts are also syllabus-only). To stop working on a pinned technique, they **unpin** it; unpinning doesn't broadcast as activity, but pinning, commenting, and asking questions all do.

A pinned technique can later be promoted by the coach into one of the student's camps, carrying the notes and discussion along with it.

If a technique is or was part of the student's syllabus, that context surfaces when they view it on their pinned list: status, attempts, notes from when it was in the syllabus. A toggle hides the syllabus context if it's getting in the way of fresh work.

### Coach visibility into self-directed activity

Coaches see when students pin techniques, watch videos, leave comments, and suggest techniques. This is an important signal: "who's taking initiative right now" is exactly the kind of thing a coach uses to decide who to spend time with in class. If students aren't comfortable with this info being public to coaches, we can add an opt-out later (phase-2).

## Ongoing student management

A bag of features aimed at giving the coach durable signal about who's training, who's getting attention, and who's progressing, over weeks and months, not just one syllabus.

- **Rank fields on the profile** (belt/stripes/last grading date) so the coach has at-a-glance context.
- **Student-visible attendance heatmap**, same chart shape as the existing attempts heatmap, so students can see their training streak. The coach sees the same chart per student.
- **Per-coach attention marking**: after a class, the coach marks which students they personally worked with (1:1 attention). Each coach sees their own log; other coaches' logs don't leak across. This needs a notion of "this coach taught this class" which gets fuzzy with substitutes, so needs more refining before implementation.
- **Roster signals**: the existing coach-dashboard roster tabs (Initiative / Recent / Quiet) get richer signal sources, including self-directed activity, attendance patterns, and attention recency.

### The check-in integration is uncertain

Most of the friction-reducing pieces here depend on connecting to the gym's student check-in software, so we can see per class who came. We don't have that connection today and we don't know what data we'd get. Stories that depend on this integration are tagged **deferred** in the sheet: useful to have on paper but not buildable yet.

### Grading day, deferred

A "grading day" event (similar shape to a competition camp: gym-wide, students attached, assessments) is a natural extension but needs its own exploration. Not in this round.

## Privacy stance

We're holding the smallest possible amount of personally identifying information. The `users` schema today already has `email`, `first_name`, and `last_name` columns; these exist for the password-reset flow and the initial onboarding form, and we constrain their use to that purpose. Display name is what appears in coach-facing and student-facing UI for any user. Email and legal-name fields are never displayed in coach-facing UI or surfaced to other students.

The plan going forward holds this line: no opponent records, no extra contact details, no exposure of email/legal-name fields outside the auth flows that already need them. If we integrate with the check-in software, we'd ideally pull only the foreign-system user ID and the non-PII data we need (attendance counts, class enrollment), not names or contact info.
