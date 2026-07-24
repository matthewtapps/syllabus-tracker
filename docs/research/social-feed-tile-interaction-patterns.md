# Social feed tile interaction patterns

Wayfinder ticket #103. Research date: 2026-07-25.

**Research question.** What interaction patterns do mature social/media feeds (Instagram, Twitter/X, YouTube, TikTok, Reddit, Strava) use for displaying and expanding rich items (video, threaded comments) in a scrolling feed, and which 2-3 candidates fit our tile kinds?

**Our tile kinds** (from `frontend/src/components/activity-feed/`):

| Kind | Component today | Current behavior |
| --- | --- | --- |
| `video` | `VideoTile` wrapping `VideoReviewPanel` (feed presentation) | Player always visible; focus thread above the fold; composer plus remaining threads behind a "N more comments" toggle that is an instant conditional render, no animation |
| `technique` | `TechniqueTile` (Accordion) via `TechniqueSubjectTile` | Collapsed `TechniqueRow`, expand-in-place; expanding hides the sibling `CommentTile` below it (`activity-tile.tsx` line 45), which is the jank being fixed |
| `thread` | `CommentTile` wrapping `ThreadView` | Always expanded: full thread, all replies, composer; no collapse affordance |
| `none` | Header only | Assignment, graduation, gated camp; nothing to expand |

**Source discipline.** Primary docs are cited where they exist (Material 3, Apple HIG, YouTube Help, Strava Support, Reddit Help, NN/g). Product behaviors with no owning spec are marked **observed behavior** and cited to the best available secondary source. The m3.material.io and developer.apple.com pages are JS-rendered; where the page itself would not serve static content, values were verified against the Material team's own mirror (the `material-components-android` Motion doc) and Apple's HIG JSON content endpoints, and the canonical URL is cited.

---

## 1. Expand-in-place vs tap-to-detail vs always-expanded

The mature feeds split into three camps, and the split tracks how heavy the item's "full" form is:

| Product | Feed item model | Where the full item lives |
| --- | --- | --- |
| Instagram | **Always-expanded media, capped text.** Full media renders in the feed; caption truncated with "more"; comments capped with a "View all N comments" link. | Comments open in a bottom sheet over the feed; the post itself never navigates away on mobile. (Observed behavior; no owning spec. Autoplay/sound side corroborated by [TechCrunch coverage](https://techcrunch.com/2017/09/16/%E2%80%AAinstagram-now-autoplays-video-sound-once-turned-on-until-you-close-the-app).) |
| Twitter/X | **Always-expanded media, tap-to-detail for conversation.** Media plays inline; tapping the tweet navigates to the tweet detail page for replies; tapping the video goes fullscreen. ([X Help: autoplay](https://help.x.com/en/using-x/how-to-autoplay), page robot-blocked, behavior corroborated by [TechCrunch launch coverage](https://techcrunch.com/2015/06/16/twitter-now-autoplays-video-and-gifs); detail-page navigation is observed behavior.) |
| YouTube | **Preview in feed, tap-to-detail to consume.** Home feed tiles play a muted inline preview; tapping opens the watch page. ([YouTube Help: inline player](https://support.google.com/youtube/answer/7640367)) |
| TikTok | **Always-expanded, one item per screen.** The feed item *is* the detail view; comments overlay in a bottom sheet, the video keeps playing behind it. (Observed behavior; no official spec. Best secondary: [Accio guide to TikTok comments](https://www.accio.com/blog/guide-on-how-to-see-comments-on-tiktok).) |
| Reddit | **Preview card, tap-to-detail.** Cards show title plus inline media; tapping navigates to the post detail page where comments live. (Observed behavior; media autoplay setting documented at [Reddit Help: Reduce Motion & Autoplay](https://support.reddithelp.com/hc/en-us/articles/38312409545492-Accessibility-Guides-Reduce-Motion-Autoplay).) |
| Strava | **Always-expanded summary card.** Activity cards show the map, stats, photos/video inline; tapping opens the activity detail page; kudos and a comment count are on the card, the comment thread is on the detail page. (Observed behavior; video-in-feed autoplay documented at [Strava Support: Adding Videos and Photos](https://support.strava.com/hc/en-us/articles/216917387-Adding-Videos-and-Photos-to-Your-Activity).) |

**Notable: none of the six uses accordion-style expand-in-place for feed items.** Expand-in-place in these products is reserved for settings, FAQs, and long-form article sections, not feed tiles. When a feed item has more to show, mature feeds either (a) overlay it (sheet, fullscreen player) or (b) navigate to a detail surface, in both cases leaving the feed itself untouched underneath. Our `technique` tile's Accordion is the outlier pattern, which is fine (it is a library row reused in a feed), but it explains why there is no product precedent for "expanding one part collapses a sibling": nothing in these feeds collapses anything else when an item opens.

**Why the split falls where it does.** NN/g's accordion research explains the trade: expand-in-place is "one of the most useful design elements" for fitting content into small screens and it keeps the user in place, but it breaks down when the expanded content spans multiple screenfuls, and when expansion visually shifts the page users mistakenly reach for Back and leave entirely ([NN/g: Accordions on Mobile](https://www.nngroup.com/articles/mobile-accordions/)). Feed items with unbounded content (a full comment thread, a watch page) exceed that budget, so products push them to overlays or detail views. NN/g's progressive disclosure guidance backs the middle ground: show the essential subset up front, defer the rest behind a clearly labeled control with strong information scent ([NN/g: Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/)).

**Verdict on the user hypothesis ("nothing currently visible should disappear on interaction").** The evidence supports it, with one nuance. No surveyed product removes or collapses visible sibling content when an item is expanded; disclosure is strictly additive (Instagram "View all N comments" adds, YouTube's preview persists until you leave the feed, TikTok's comment sheet slides over a still-playing video). The nuance: tap-to-detail and fullscreen patterns do *cover* the feed temporarily (sheet or navigation), and users accept that because it is a modal layer with an obvious Back path, not an in-place mutation of the feed. So the hypothesis stands as stated for in-feed interactions; covering the feed with a dismissible layer is a separate, well-accepted move and does not violate it.

## 2. Inline video presentation

The industry norm is settled: **autoplay muted in the feed, sound and immersion on explicit tap, user-controllable via settings.**

- **YouTube**: Home feed and search results autoplay muted with captions auto-enabled ("inline player" / "playback in feeds"); user setting offers Always on / Wi-Fi only / Off; tapping opens the watch page. ([YouTube Help](https://support.google.com/youtube/answer/7640367))
- **Twitter/X**: timeline video autoplays muted; tapping switches to a fullscreen view and unmutes; settings offer Wi-Fi-only and full disable. ([X Help](https://help.x.com/en/using-x/how-to-autoplay), robot-blocked; corroborated by [TechCrunch, June 2015](https://techcrunch.com/2015/06/16/twitter-now-autoplays-video-and-gifs).)
- **Instagram**: feed videos autoplay with sound off; tapping sound on for one video turns sound on for subsequent videos that session, resetting when the app closes. (Observed behavior; [TechCrunch, Sept 2017](https://techcrunch.com/2017/09/16/%E2%80%AAinstagram-now-autoplays-video-sound-once-turned-on-until-you-close-the-app).)
- **TikTok**: autoplay with sound on, full screen, one video per viewport; the feed is the player. (Observed behavior.)
- **Reddit**: feed media autoplays muted by default with an Always / Only on Wi-Fi / Never setting under accessibility. ([Reddit Help](https://support.reddithelp.com/hc/en-us/articles/38312409545492-Accessibility-Guides-Reduce-Motion-Autoplay))
- **Strava**: feed videos (max 30s) autoplay; a global "Autoplay Video" toggle exists in settings and syncs across app and web. ([Strava Support](https://support.strava.com/hc/en-us/articles/216917387-Adding-Videos-and-Photos-to-Your-Activity))

Poster-plus-tap-to-play (no autoplay at all) survives mainly where videos are long-form and data-heavy, or as the fallback state of an autoplay setting. Every product that autoplays offers an off switch, and Reddit files its switch under accessibility, which is worth copying.

Implications for us: our `VideoTile` currently renders the real player with a poster, no autoplay. That is a legitimate conservative position (our clips are training footage, often with coach audio that matters, and PWAs pay for bandwidth like everyone else). If we ever adopt muted autoplay previews it must come with a user setting, and captions-on-mute only makes sense once we have captions. Tap-to-fullscreen is already handled by the full-screen video Dialog plus rotate-to-fullscreen in `VideoReviewPanel`; that matches the X/YouTube norm of "tap for immersion".

## 3. Progressive disclosure of comment threads

Norms across the surveyed products:

- **Instagram**: shows the caption plus at most a couple of preview comments under a post, then "View all N comments"; the full thread opens in a bottom sheet over the feed, composer at the bottom of the sheet. (Observed behavior.)
- **TikTok**: zero comments visible in the feed; a comment-bubble count badge opens the full thread in a bottom sheet over the still-playing video, with sort controls and a composer in the sheet. (Observed behavior; [secondary guide](https://www.accio.com/blog/guide-on-how-to-see-comments-on-tiktok).)
- **Twitter/X**: zero replies inline in the timeline (only a reply count); the conversation lives on the tweet detail page. (Observed behavior.)
- **Reddit**: zero comments inline in the feed (count only); comments live on the post detail page, with "View more comments" pagination and collapsed deep branches inside the thread itself. (Observed behavior.)
- **Strava**: comment count on the activity card; thread on the activity detail page. (Observed behavior.)
- **YouTube**: zero comments in the Home feed; on the watch page mobile, comments are a collapsed strip showing one teaser comment that expands into a bottom sheet. (Observed behavior.)

Pattern summary: **inline comment budget in mature feeds is 0 to ~2**, always additive ("view more" adds a layer, never rearranges the feed), and the full thread lives either in a bottom sheet over the feed (Instagram, TikTok, YouTube watch page) or on a detail page (Reddit, X, Strava). Sheets are winning on mobile because they preserve the feed context underneath and dismiss with a swipe or Back. This matches NN/g progressive disclosure: the initial view carries the high-frequency subset (the comment the feed event is about), the control ("N more comments") carries strong information scent, and the mechanics of getting the rest are one tap ([NN/g](https://www.nngroup.com/articles/progressive-disclosure/)).

Our current state against the norm: `CommentTile` renders the *entire* thread, all replies plus a composer, always expanded, which is over budget for feeds (fine for single-thread events, heavy for long threads). `VideoReviewPanel` feed mode is already the closest thing we have to the Instagram pattern: focus thread above the fold, "N more comments" toggle, rest below. Its two gaps versus the norm: expansion is inline growth rather than an overlay (acceptable, see candidates) and the toggle is an instant conditional render with no motion.

## 4. Motion guidance for container expansion

### Material 3

- **Container transform** is M3's named pattern for exactly our case: it "creates a visible connection between two UI elements" by transforming the bounding container of a start view into an end view, with contents swapped during the transition; listed use cases include "a card into a details page" and "a list item into a details page". ([M3: transition patterns](https://m3.material.io/styles/motion/transitions/transition-patterns); values verified via the Material team's [Motion doc in material-components-android](https://github.com/material-components/material-components-android/blob/master/docs/theming/Motion.md).)
- **Easing tokens** (cubic-bezier): standard `0.2, 0, 0, 1`; standard-decelerate `0, 0, 0, 1`; standard-accelerate `0.3, 0, 1, 1`; emphasized-decelerate `0.05, 0.7, 0.1, 1`; emphasized-accelerate `0.3, 0, 0.8, 0.15`. Emphasized is the set for large, expressive transitions; standard for utilitarian component motion. ([M3: easing and duration tokens](https://m3.material.io/styles/motion/easing-and-duration/tokens-specs), verified via the same Motion doc.)
- **Duration tokens**: short1-4 = 50/100/150/200ms, medium1-4 = 250/300/350/400ms, long1-4 = 450/500/550/600ms, extra-long1-4 = 700/800/900/1000ms. Guidance: duration scales with the area of the animation; container transforms of card-to-detail scale use long durations (~450-600ms) with emphasized easing, while small in-card reveals sit in the medium band (250-400ms). ([M3 tokens spec](https://m3.material.io/styles/motion/easing-and-duration/tokens-specs), values verified via the Motion doc.)
- **M3 Expressive (springs)**: the current Motion guidance adds a physics system; the rule of thumb from the Material team is that "small component animations like switches should use the fast spring, full screen animations or transitions should use the slow spring, and everything in between should use the default spring". ([Motion doc, material-components-android](https://github.com/material-components/material-components-android/blob/master/docs/theming/Motion.md))

Practical web translation for us: Radix Accordion height animation with `emphasized-decelerate` (`cubic-bezier(0.05, 0.7, 0.1, 1)`) at ~300-400ms for in-tile expansion; if we ever do a true tile-to-sheet container transform, budget ~450-500ms with emphasized easing. Our `TechniqueRow` already animates via `AccordionContent` (the `useDelayedFalse(open, 250)` keeps content mounted through a ~250ms close), so the technique tile is on-pattern today; the video tile's discussion toggle is the one that renders instantly with no motion.

### Apple HIG

- **Motion**: "Add motion purposefully, supporting the experience without overshadowing it... Gratuitous or excessive animation can distract people and may make them feel disconnected or physically uncomfortable." Brief, precise feedback animation "tends to feel lightweight and unobtrusive". "Let people cancel motion", avoid animating high-frequency interactions, respect Reduce Motion, and never make motion the only carrier of information. ([Apple HIG: Motion](https://developer.apple.com/design/human-interface-guidelines/motion))
- **Sheets**: sheets are for scoped, simple tasks in context; use **full-screen presentation instead for "displaying videos, photos, or camera views"** and for complex or prolonged flows. iOS sheets support detents (medium ~50%, large) for progressive disclosure, a grabber to signal resizability, and swipe-to-dismiss. One sheet at a time; closing a sheet returns to the parent view. ([Apple HIG: Sheets](https://developer.apple.com/design/human-interface-guidelines/sheets))

Two HIG points bear directly on us: (a) full-screen, not a sheet, is Apple's recommendation for video consumption, which endorses our existing full-screen video Dialog; (b) sheets with detents are Apple's sanctioned progressive-disclosure surface for supplementary content like a comment thread, which endorses the Instagram/TikTok comment-sheet pattern on iOS-style platforms. Both align with our modal policy: full-screen Sheet and full-screen video Dialog hijack Back via `useHistoryDismiss`; centered dialogs do not.

---

## Candidate patterns

Constraints every candidate is scored against:

1. **Nothing visible disappears on in-feed interaction** (hypothesis upheld by the evidence; disclosure must be additive, though covering the feed with a dismissible modal layer is acceptable).
2. **Mobile-first standalone PWA**: full-screen Sheet and full-screen video Dialog may hijack Back (`useHistoryDismiss`); centered dialogs must not.
3. Reuse of the shared `TechniqueRow` and existing thread/video components; note any API change.

### Candidate A: Additive in-place expansion (fix the collapse, animate everything)

The minimal-delta candidate: keep today's shapes, make all disclosure additive and animated.

- **video**: unchanged layout (player, focus thread, toggle). The "N more comments" region animates open below the toggle (grid-rows or measured-height transition, `emphasized-decelerate` at ~300ms) instead of popping in. Nothing above the toggle moves.
- **technique**: `TechniqueRow` Accordion expands as today. The sibling `CommentTile` **stays mounted** (delete the `!expanded` gate at `activity-tile.tsx` line 45). Duplication is resolved the way `VideoReviewPanel` already does it: pass the focus thread id into the expanded panel's discussion block and have it exclude that thread from its own list, so the thread renders exactly once, in the stable position the user already saw it in.
- **thread**: cap the always-expanded `ThreadView` at the root post plus the latest 1-2 replies, with an "N more replies" control that expands the rest in place, animated the same way. Composer stays visible (it is the feed's engagement hook).
- **none**: unchanged, header only.

Trade-offs. Best fit with the hypothesis (literally nothing disappears, ever) and with NN/g's "keep the user in place". Cheapest build; no navigation, no Back semantics to add, zero risk to the modal policy. Motion is small-area so the medium duration band applies; Radix Accordion machinery already exists for the technique tile. The cost: long threads and big expanded panels still inflate feed height (NN/g's multi-screenful accordion warning), and the technique tile's expanded panel plus a still-visible sibling thread is a lot of card. **TechniqueRow API change: one additive optional prop** (an `excludeThreadId` or `focusThread` hint threaded to the discussion block), nothing structural; `embedded` already exists.

### Candidate B: Feed preview + full-screen detail sheet (the Instagram/TikTok move)

Tiles become fixed-budget previews; depth lives in a full-screen Sheet layered over the feed.

- **video**: tile keeps the inline player and the focus thread. "N more comments" opens a full-screen Sheet containing the full `VideoReviewPanel` (non-feed layout: composer plus all threads). Video position could hand off via the shared player context; Back or swipe dismisses (Sheet already runs `useHistoryDismiss`).
- **technique**: tapping the row opens the Sheet with the fully expanded `TechniqueRow` panel (its real surface presentation) instead of accordion-expanding in the feed. The sibling `CommentTile` never hides because the feed never changes. This matches HIG "full-screen for complex flows" and M3 "list item into a details page".
- **thread**: tile shows root post plus latest reply plus count; tap opens the Sheet with the full `ThreadView` and composer.
- **none**: unchanged.

Trade-offs. Strongest precedent (five of six products put full threads in a sheet or detail surface) and the feed stays byte-identical under the overlay, so the hypothesis is honored in the modal-layer sense. Scales to arbitrarily long threads without feed inflation. Costs: it demotes the feed from "do everything here" to "preview here, act in the sheet", which loses the current one-tap inline reply; and the ideal motion (M3 container transform, tile morphs into sheet, ~450-500ms emphasized) is genuinely hard on the web, so realistically we ship the Sheet's slide-up and accept a weaker spatial link. **TechniqueRow API change: real.** The expanded panel needs to render outside an Accordion (extract `ExpandedPanel` hosting, or accept a forced-open standalone mode), and a sheet host component is new.

### Candidate C: Capped inline preview with animated reveal, sheet only for overflow (hybrid, recommended starting point)

A follows the feed norm for budgets, B only where content is unbounded. Per NN/g progressive disclosure: essentials inline, everything else one labeled tap away.

- **video**: as Candidate A (animated inline reveal of composer plus remaining threads) while thread count is small; above a threshold (say 5 threads) the toggle becomes "View all N comments" and opens the full-screen Sheet instead. Player and tap-to-fullscreen Dialog unchanged.
- **technique**: as Candidate A: additive Accordion expansion, sibling `CommentTile` stays, focus-thread dedup inside the panel. The technique surface is bounded (it is a row panel, not a thread), so it never needs the sheet.
- **thread**: root plus latest 1-2 replies plus composer inline; "N more replies" expands in place when small, opens the Sheet when the thread is long.
- **none**: unchanged.

Trade-offs. Matches the observed norm most closely (Instagram: capped inline, sheet for the rest) and satisfies the hypothesis everywhere: in-feed disclosure is additive, and the sheet is an accepted modal layer. Keeps the inline composer for the common short-thread case, which B loses. Costs: two disclosure paths to maintain and a threshold to tune; slightly more motion surface to build (inline height animation now, sheet reuse later). **TechniqueRow API change: same single additive prop as Candidate A.** The sheet piece can ship as a later increment, so this decomposes into "A now, B's sheet for overflow when thread length demands it".

### Recommendation order

C, then A, then B. A is strictly contained in C and is the right first PR (kill the line-45 collapse, add the missing animation to the video tile toggle). B alone over-rotates: it fixes a jank we can fix additively by giving up the feed's current inline-engagement strength, and its signature motion is the one piece we cannot cheaply build.

---

## Source list

Primary:

- Material 3, Transition patterns (container transform): https://m3.material.io/styles/motion/transitions/transition-patterns
- Material 3, Easing and duration tokens: https://m3.material.io/styles/motion/easing-and-duration/tokens-specs
- Material Components Android, Motion doc (Material team's own mirror of pattern and token values; fetched directly): https://github.com/material-components/material-components-android/blob/master/docs/theming/Motion.md
- Apple HIG, Sheets: https://developer.apple.com/design/human-interface-guidelines/sheets
- Apple HIG, Motion: https://developer.apple.com/design/human-interface-guidelines/motion
- YouTube Help, Use the inline player (playback in feeds): https://support.google.com/youtube/answer/7640367
- X Help, How to autoplay (robot-blocked at fetch time; cited for existence of the setting): https://help.x.com/en/using-x/how-to-autoplay
- Strava Support, Adding Videos and Photos to Your Activity: https://support.strava.com/hc/en-us/articles/216917387-Adding-Videos-and-Photos-to-Your-Activity
- Reddit Help, Accessibility Guides: Reduce Motion & Autoplay: https://support.reddithelp.com/hc/en-us/articles/38312409545492-Accessibility-Guides-Reduce-Motion-Autoplay
- NN/g, Progressive Disclosure: https://www.nngroup.com/articles/progressive-disclosure/
- NN/g, Accordions on Mobile: https://www.nngroup.com/articles/mobile-accordions/
- NN/g, Accordion Icons: https://www.nngroup.com/articles/accordion-icons/

Secondary (observed product behavior with no owning spec):

- TechCrunch, "Twitter now autoplays video and GIFs" (June 2015): https://techcrunch.com/2015/06/16/twitter-now-autoplays-video-and-gifs
- TechCrunch, "Instagram now autoplays video sound once turned on until you close the app" (Sept 2017): https://techcrunch.com/2017/09/16/%E2%80%AAinstagram-now-autoplays-video-sound-once-turned-on-until-you-close-the-app
- Accio, guide to TikTok comments (comment bottom sheet behavior): https://www.accio.com/blog/guide-on-how-to-see-comments-on-tiktok
- Instagram "View all N comments", Reddit and Strava tap-to-detail, X reply-count-only timelines, YouTube watch-page comment strip: directly observed product behavior as of 2026-07, no citable spec.
