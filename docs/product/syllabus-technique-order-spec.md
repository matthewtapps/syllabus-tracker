# Syllabus technique order

## Problem

A coach works through a syllabus in a specific sequence. Today the app has no way
to record that sequence: `syllabus_techniques.position` exists and is already read
(`ORDER BY st.position ASC, t.name ASC`), but nothing writes it, so every row sits
at `0` and both the coach and the student see an alphabetical list.

## Decisions

1. The order flows through to the student. `SstRow` carries the syllabus position
   and the student's syllabus page can sort by it.
2. "Syllabus order" joins "Recently active" and "Alphabetical" on the student
   page's sort control, and becomes the default. Syllabi nobody has ordered fall
   back to alphabetical through the name tie-break.
3. Order is display order. No gating, no "up next", no progression semantics.
4. One order per syllabus, shared by every student assigned to it.
5. Techniques added straight to one student's assignment have no syllabus
   position. Under "Syllabus order" they sort after every syllabus member,
   alphabetical among themselves.
6. The coach reorders by dragging a handle on the syllabus page. Handles are
   always visible; dragging is disabled while a search term or tag filter is
   active, because a drag over a filtered list would renumber only the visible
   rows. Each drop saves immediately.
7. A technique added to a syllabus lands at the end (`MAX(position) + 1`).
8. Reordering emits no activity row.
9. The user-facing label is "Syllabus order".

No backfill migration. Positions stay at `0` until a coach drags something, and
because dragging requires cleared filters, the first drag posts the complete list
and writes `0..n-1` in one transaction.

## Data model

`config/schema.sql` is unchanged. `syllabus_techniques.position` already exists
with the index `idx_st_position (syllabus_id, position)`.

Removing a technique deletes its membership row, so its position is gone; re-adding
it appends at the end. Removals leave gaps in the numbering (`0, 1, 3`), which is
harmless because only the relative order is read.

## API

New endpoint, mirroring `POST /api/techniques/<tid>/videos/reorder`:

```
POST /api/syllabi/<sid>/techniques/reorder
{ "ordered_technique_ids": [12, 7, 30] }
-> 204
```

Requires `Permission::ManageSyllabi`. `SyllabusTechniqueRow` exposes `technique_id`
and no membership id, so the payload keys on technique ids.

`db::reorder_syllabus_techniques(pool, syllabus_id, ordered_technique_ids)` opens a
transaction and runs one `UPDATE syllabus_techniques SET position = ? WHERE
syllabus_id = ? AND technique_id = ?` per entry, following `db::reorder_videos`.
Ids that name no member of the syllabus match no row and are ignored.

`db::add_technique_to_syllabus` changes its insert to compute the position:

```sql
INSERT OR IGNORE INTO syllabus_techniques (syllabus_id, technique_id, position, added_by_id)
VALUES (?, ?, COALESCE((SELECT MAX(position) + 1 FROM syllabus_techniques WHERE syllabus_id = ?), 0), ?)
```

## Backend read path

`db::list_syllabus_techniques` already orders correctly and needs no change.

`db::list_for_assignment` gains the syllabus position. The query holds
`assignment_id`, so it reaches the membership row through the assignment:

```sql
LEFT JOIN syllabus_assignments sa ON sa.id = sst.assignment_id
LEFT JOIN syllabus_techniques st
       ON st.syllabus_id = sa.syllabus_id AND st.technique_id = sst.technique_id
```

selecting `st.position AS "syllabus_position?: i64"`. The left join yields `NULL`
for techniques added straight to the assignment, which is what decision 5 sorts on.
`SstRow` gains `syllabus_position: Option<i64>`, and `SstRow` in
`frontend/src/lib/api.ts` gains `syllabus_position: number | null`.

The SQL `ORDER BY t.name` stays as the stable base order; the student page sorts
client-side, as it does today.

## Frontend

### Student syllabus page (`/student/:id/syllabi/:syllabusId`)

`sst-view.ts`:

```ts
export type SstSort = 'syllabus' | 'recent' | 'alphabetical';
```

`sortSsts` handles the new variant: rows with a non-null `syllabus_position` sort
ascending by it with a name tie-break, then rows with `null` sort alphabetically
after them. `page.tsx` seeds `useState<SstSort>('syllabus')` and adds the
`<SelectItem value="syllabus">Syllabus order</SelectItem>` as the first entry.

### Coach syllabus page (`/syllabi/:id`)

`TechniquesSection` wraps its `<Accordion>` in `DndContext` + `SortableContext`,
copying `video-list.tsx`: `PointerSensor` with `activationConstraint: { distance: 6 }`,
`KeyboardSensor` with `sortableKeyboardCoordinates`, optimistic local order held in
state, and an error toast that drops the local override.

`TechniqueRow` gains a drag-handle render prop, matching the one `video-row.tsx`
already exposes, rendering a `GripVerticalIcon` in the row header.

Dragging is disabled when `techSearch.trim() !== '' || techTags.length > 0`. The
handles render dimmed and the list shows a hint to clear filters to reorder.

Reordering under an active filter is the one interaction this design forbids, and
the disabled handle is how a coach finds that out. Worth watching once it is on
screen.

## Out of scope

- Per-student ordering. `student_syllabus_techniques` gets no position column.
- Ordering camp techniques. `camp_techniques` has no position and is untouched.
- Any gating or "next technique" surface.

## Test plan

Backend (`src/test/syllabi.rs`):

- Reorder persists `0..n-1` against the posted order and the list endpoint returns it.
- Reorder by a student is rejected.
- Technique ids outside the syllabus are ignored and leave members untouched.
- Adding a technique to a syllabus whose members are `0, 1, 2` writes position `3`.
- Adding to an empty syllabus writes position `0`.
- `list_for_assignment` returns `syllabus_position` for members and `null` for a
  technique added straight to the assignment.

Frontend (`sst-view.unit.test.ts`):

- `sortSsts(rows, 'syllabus')` orders by position, breaks ties by name, and places
  null-position rows last in alphabetical order.
