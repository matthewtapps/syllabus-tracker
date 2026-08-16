# Context

Glossary for the Sillybus domain. Terms only. Implementation notes belong in
`docs/`, product concepts in `docs/product/`.

## Syllabus

A coach-owned, reusable, named collection of techniques. A syllabus exists
independently of any student; assigning it is a separate act.

## Syllabus technique

A technique's membership in a syllabus. The technique itself lives in the global
library and can belong to many syllabi; the membership is a separate fact that
records one such belonging.

## Syllabus order

The sequence a coach teaches a syllabus in, held on the syllabus and shared by
every student assigned to it. It is display order and carries no progression
meaning: nothing is locked, gated, or marked "up next" by it. A technique added
straight to one student's assignment has no place in the syllabus order.

## Assignment

The fact that a particular student has been given a particular syllabus. An
assignment can be unassigned or graduated without being destroyed, so its history
survives.

## Student syllabus technique

One student's progress against one technique within one assignment: status, notes,
attempts, and per-student visibility. Where [[syllabus-technique]] records that a
technique belongs to a syllabus, this records how one student is doing at it.
