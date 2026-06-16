# Navigation Scroll Restoration & URL-Encoded View State

**Date:** 2026-06-14
**Status:** Approved (design agreed in chat)
**Branch:** `roadmap/threads-07-vidstack-player`

## Problem

Navigation feels wrong in two ways:

1. **Scroll leaks across button navigation.** Page scroll is on the window and
   nothing resets it, so navigating to a tab via the bottom nav (a PUSH) lands
   on the previous scroll position (e.g. a half-scrolled dashboard) instead of
   the top. It also makes the data feel stale.
2. **Views are not shareable/restorable.** Filters (search, tags) and which row
   is expanded live in component state, lost on any navigation, and absent from
   the URL, so a view cannot be copied/sent to land someone on the same place.

The desired model (industry convention): **POP (browser/OS back+forward)
restores where you were; PUSH (link/button) gives a fresh view at the top**
([ccdatalab](https://www.ccdatalab.org/blog/automatic-scroll-restoration-single-page-applications),
[picostitch](https://picostitch.com/blog/2025/03/spa-feel1-restore-scroll/)).
Plus: the URL should encode view state so any view is shareable.

React Router's built-in `<ScrollRestoration>` only works on a data router; this
app uses the component `<BrowserRouter>` (`App.tsx`), so we implement the
behavior with a small custom manager rather than migrating the router.

## Design

### Navigation matrix

| Navigation type | Scroll | Data |
| --- | --- | --- |
| **PUSH** (link/button/breadcrumb) | reset to top | refetch (fresh) |
| **POP** (back/forward) | restore prior pixel position | use cache |
| **REPLACE** (programmatic, e.g. stripping `?focus=`) | leave as-is | no refetch |

Breadcrumbs are links (PUSH) → top, intentionally; the back button covers
"return where I was".

### Phase 1: scroll manager + freshness (foundational)

A `ScrollManager` component rendered inside `<Router>`:

- Uses `useLocation()` + `useNavigationType()`.
- Keeps an in-memory `Map<location.key, scrollY>`, updated on a debounced
  `scroll` listener.
- On location change:
  - `POP` → restore `map[key]` (rAF + one short delayed retry to account for
    async data growing the page).
  - `PUSH` → `window.scrollTo(0, 0)` and
    `queryClient.invalidateQueries({ refetchType: "active" })` so the freshly
    mounted page's queries refetch (fresh feel).
  - `REPLACE` → no-op (so internal param strips don't jump or refetch).

This alone fixes the reported pain (dashboard returns to top + fresh).

### Phase 2: URL-encoded filters + expansion (shareable views)

On each list page (library, student-pinned, student-syllabus), move filter and
expansion state into the URL query string, read on mount, written on change
with `replace` (so typing/expanding doesn't spam history):

- `q=<search>`
- `tags=<comma,separated>`
- `focus=<type>:<id>` (the expanded row; already used for deep links)

On load the page applies the filters, expands the focused row, and scrolls it
into view (reusing `useFocusTarget` + `scrollToTopWhenStable`). Because the
state is in the URL, POP restores it for free and the URL is copy-pasteable.

A shared `useUrlListState` hook centralizes the read/write so the three pages
stay consistent.

### Phase 3: URL scroll anchor (shareable scroll)

Encode the **top-most visible row** as `at=<type>:<id>`, updated as the user
scrolls (debounced, `replace`). On load, after data renders, scroll that row to
the top. An anchor (not a pixel offset) is used deliberately: a pixel `scrollY`
is viewport- and data-dependent and breaks when shared across devices or when
the underlying list changes; an anchored row lands the recipient on the same
content regardless of screen size. An `IntersectionObserver` over the row
elements tracks the topmost visible one.

Phase 1 (history-keyed pixel restore) still provides pixel-exact back/forward
within a session; Phase 3 provides the robust *shareable* approximation.

## Components

| File | Phase | Change |
| --- | --- | --- |
| `frontend/src/components/scroll-manager.tsx` | 1 | **New.** POP-restore / PUSH-top + refetch / REPLACE no-op. |
| `frontend/src/App.tsx` | 1 | Render `<ScrollManager/>` inside `<Router>`. |
| `frontend/src/lib/use-url-list-state.ts` | 2 | **New.** Read/write `q`/`tags`/`focus` in the query string. |
| `frontend/src/app/library/page.tsx` | 2/3 | Filters + focus + anchor in URL. |
| `frontend/src/app/student-pinned/page.tsx` | 2/3 | Same. |
| `frontend/src/app/student-syllabi/[syllabusId]/page.tsx` | 2/3 | Same. |
| `frontend/src/lib/use-scroll-anchor.ts` | 3 | **New.** IntersectionObserver topmost-row -> `at=` param. |

## Testing

- `ScrollManager`: pure-ish; extract the decision (`navType -> action`) and unit
  test in node. Manual: back restores, nav-button resets + refetches.
- `useUrlListState`: unit test param read/write round-trips in node.
- Existing `useFocusTarget` / deep-link tests stay green.

## Risks / Non-goals

- **Async content vs pixel restore:** POP restore is best-effort with a retry;
  if data refetches and changes height it may be slightly off. Acceptable.
- **Not** migrating to a data router (would be the "clean" `<ScrollRestoration>`
  path but a large refactor for little extra benefit here).
- Phase 1 ships first and is independently valuable; Phases 2-3 follow.
