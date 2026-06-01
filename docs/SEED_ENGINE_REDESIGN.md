# Seed Engine Redesign Notes

> **Status:** pinned, not actively in flight. Notes captured 2026-06-01 from a
> design exploration. Pick up here if/when there's appetite to build the
> generic seed engine.

## TL;DR

The original task was to drop the seed binary's dependency on the `.sqlx/`
query cache. That turned out to be an architectural problem, not a code-level
one, and the conversation expanded into "what should a generic, declarative
seed engine look like." The current best-shaped direction is:

1. A generic seed engine that lives inside `crates/migration-engine`, driven by
   a **declarative file** (format TBD) that encodes either literal rows or
   generation rules.
2. A first-class **SQL escape hatch** for sections that can't be expressed
   declaratively (the awkward ~30% in any real-world seed).
3. Eventually, **clients** (TUI first, web/GUI later) that exist solely to
   help authors construct the input file. The file is the contract; clients
   are convenience layers.

Round 1 of any future work is **designing that file format**. Everything else
(engine implementation, clients, scaffolding mode) follows from that decision.

## Status of current code

### Committed

- `src/bin/seed.rs` was previously refactored to use a nice terminal reporter
  (commit `2f21b4b`). The `SeedReporter` trait + `TerminalSeedReporter` live
  at `crates/syllabus-tracker/src/lib/seed/`. They would move into
  `crates/migration-engine` if the generic engine is built.

### Uncommitted (working tree)

- A partial refactor of `crates/syllabus-tracker/src/bin/seed.rs` that inlines
  raw SQL where the binary previously called `syllabus_tracker::db::*`
  helpers (which use `sqlx::query!` macros). The change does not achieve the
  original goal of dropping the `.sqlx/` cache dependency, because seed lives
  in the same crate as the macro-heavy lib, and building any binary in that
  crate triggers a lib rebuild that needs the cache. The user agreed to keep
  the change as a small self-containment win regardless. Commit or revert it
  whenever; it's independent of the bigger redesign.

## The architectural finding that drove the expansion

`crates/syllabus-tracker/src/bin/seed.rs` lives inside the
`syllabus-tracker` crate. When `cargo build --bin seed` runs, cargo builds
the `syllabus-tracker` lib too (the bin depends on it). The lib uses
`sqlx::query!` macros pervasively in `src/db/*.rs`, and those macros need
either a live DB or the `.sqlx/` cache to resolve at compile time. **You
cannot decouple seed from the cache by editing seed alone.** The decoupling
needs one of:

- Move seed to its own crate that doesn't depend on the `syllabus-tracker` lib.
- Restructure the lib to put macros behind a feature flag (complex, leaky).
- Build a generic seed engine in `migration-engine` (already cache-free) and
  let the domain-side generator feed it data via a file. **This is the
  direction we landed on.**

The third option is what this doc captures.

## Architecture proposal

```
┌─────────────────────────────────┐         ┌──────────────────────────────┐
│ syllabus-tracker (domain)       │         │ migration-engine (generic)   │
│                                 │         │                              │
│  Generator: BJJ-specific Rust   │ ──────▶ │  Seed engine:                │
│  computes status distributions, │  file   │   - parses input file        │
│  spreads attempts across 90     │         │   - reads schema.sql         │
│  days, writes input file.       │         │   - runs generators / rules  │
│                                 │         │   - inserts into DB          │
│  Has no sqlx dependency.        │         │   - reports progress         │
└─────────────────────────────────┘         └──────────────────────────────┘
```

The domain side doesn't touch the macro-heavy lib (so cache stops mattering).
The engine is project-agnostic (could be used by any sqlite project that
adopts migration-engine).

### Open: how rich is the file format?

The conversation explored everything from "raw SQL" to "structured declarative
DSL with FK refs and generators." The current best framing:

- **Declarative for the common 70%**: pinned rows, FK refs, simple generation
  rules (count, faker-style generators, weighted enums, random ranges,
  relative timestamps).
- **SQL escape hatch for the awkward 30%**: any section can opt out into a
  `sql_file = "path/to/section.sql"` and the engine just runs the SQL.
  First-class, not a fallback.

The BJJ seed itself will likely end up half declarative (users, tags,
techniques, students, student_techniques) and half SQL-escape (the attempts
generation with status-dependent counts, 90-day spreads, alternating
recorder, conditional notes).

### Clients (deferred)

User's vision: a TUI (and later web UI / GUI) that walks devs through filling
out the input file based on the declarative schema. Clients are *just* file
authoring tools — they read and write the same file the engine consumes. This
means clients can be added incrementally and the v1 engine doesn't depend on
any of them existing.

If/when clients land, **TUI first** (no server/browser complexity, accessible
over SSH, mature Rust libs like `ratatui`). Web UI and GUI are separate
projects of their own.

## Rejected approaches and why

| Approach | Why rejected |
|---|---|
| Extract seed to its own crate (`crates/seed/`) | User's view: seed is mostly domain-specific BJJ logic, not generic plumbing worth its own crate. The split between "generic engine" and "domain generator" cleaner than "extract the whole seed binary." |
| Generic data generator from schema alone | Schema tells you `TEXT NOT NULL`, not "this is a person's name." Generators that work from types alone produce useless data without semantic hints. Modern winners (drizzle-seed, Snaplet) use schema introspection *plus* per-column refinements. |
| Data migrations (seed data inline in migration files) | User's view: ugly. Confirmed in research — yes, it is. Migrations are once-and-forever-forward; seed data is reset-and-regenerate. Mixing them tangles DDL and DML and means rebuilds replay stale demo data. |
| Pre-resolved integer IDs in fixtures | Doesn't survive idempotency. Once any other writer touches a table, the JSON's `"1"` is stale. PK collisions on re-run. |
| String mini-DSL for refs (`"ref('users', 'demo_coach')"`) | Needs a parser, escape rules, error messages keyed to character offsets inside string values. Worse debuggability than any object-based form for no real syntactic savings. |
| Bare-value refs by per-table natural-key config | Needs external mapping from FK column → target table, drifts from `schema.sql`. Bare strings are easy to mistake for literal text values when reading. |
| Building three clients (TUI + web + GUI) in v1 | Each client is a substantial project. Build the engine well, ship one client (TUI), and the others become "interested party adds them over a weekend" rather than "the project is half-finished without them." |

## The FK-refs design space (for the file format)

When this resumes, the most consequential format-design question is how
foreign-key references work in the input file. Four credible options
explored; all have real tradeoffs.

### A. Fixture-local labels (`_ref` + `$ref`)

```json
{"_ref": "coach", "username": "demo_coach"}
...
{"coach_id": {"$ref": "coach"}}
```

Rows opt in by labeling themselves. Engine carries an in-memory `label → id`
map. Readable, Rails-style classic, but `_ref` is magic and labels are
invented (annoying for hand-written fixtures and for the scaffold-empty-file
use case).

### B. Lookup by unique key (`$lookup`)

```json
{"coach_id": {"$lookup": {"table": "users", "where": {"username": "demo_coach"}}}}
```

Stateless. Verbose at every callsite. One extra SELECT per FK per row (fine
at seed scale). Works naturally across files.

### E. Refs by `(table, unique_by value)` — natural keys

```json
{"table": "users", "unique_by": ["username"], "rows": [{"username": "demo_coach"}]}
...
{"coach_id": {"$ref": ["users", "demo_coach"]}}
```

Reuses the `unique_by` declaration that's already needed for idempotency.
No invented labels, no magic field. Verbose for composite keys. Currently the
recommended choice.

### H. Column-name suffix convention

```json
{"id": "coach", "username": "demo_coach"}
...
{"coach_id": "coach"}     // string → label lookup
{"rank_id": 3}            // integer → literal
```

Minimum syntactic noise. Heavy convention. Type-based dispatch (string = ref,
int = literal) is the kind of magic that surprises people every time a real
text-typed `*_id` column exists.

**Other approaches considered and dropped**: per-table natural-key config
with bare-value refs (drifts from schema), pre-resolved integer IDs (breaks
idempotency), string mini-DSL `"ref('users', 'demo_coach')"` (parser tax),
`$<table>` prefix syntax (folded into E as a possible shorthand).

**Current recommendation**: Approach E. Reasons in `Architecture proposal`
above.

## File format physics: format choice

Open question. The user paused before answering. Four candidates considered:

- **TOML**: Human-friendly to hand-edit, comments survive round-trips via
  `toml_edit`, table-of-tables maps naturally to per-table sections, mature
  Rust ecosystem. Recommended for v1.
- **JSON**: Universally parseable, trivial Rust support. No comments
  (round-trip strips author notes). Hand-editing pain.
- **YAML**: Most concise for nested data, comments preserved. Indentation
  fragility and famous edge cases (Norway problem, type coercion). Rust libs
  lag the TOML ones.
- **KDL**: Newer node-based format, comment-friendly, designed for human
  editing. Smaller ecosystem.

## Open questions for resumption

In rough priority order:

1. **Format physics** (TOML / JSON / YAML / KDL). Affects everything.
2. **DSL ambition for generation rules**. Small (literals + named generators
   + refs + weighted) vs ambitious (`foreach`, `switch_on`, expression
   language). Recommend small + SQL escape hatch.
3. **FK ref strategy** (A / B / E / H). Recommend E.
4. **One file vs per-table files**. Recommend one file in v1, optional
   `include` directive later.
5. **Generator vocabulary** for v1: `literal`, `faker.username`,
   `faker.first_name`, `faker.full_name`, `faker.email`, `faker.lorem.*`,
   `random_int{min,max}`, `random_pick{choices|from}`,
   `weighted{values:{...}}`, `ref="..."`, `now`,
   `relative_time{offset="-90d"}`, `random_time_in_range{start,end}`,
   `auto` (engine picks based on column name + type).
6. **`unique_by` semantics for idempotency**: SELECT first, capture id if
   found, skip INSERT. This is what makes re-runs safe.
7. **RNG determinism**: seed value in the file metadata. Same seed →
   same data, always.
8. **Scaffold mode (`seed --init`)**: engine reads `schema.sql`, emits one
   stub per table with column names as keys and `auto` generators. Dev
   refines.
9. **Validation**: every `tables.X` references a real table; every column
   exists; FK refs point at real tables; `unique_by` columns exist. Fail at
   parse time, not at insert time.
10. **Mid-run failure handling**: if an INSERT fails partway through, what
    does the engine do? Roll back the transaction? Continue with errors
    reported at end? Probably transactional per section.

## Prior art (from web research, 2026-05)

Modern winners in this space have all converged on **schema introspection +
typed code-based authoring**, not file-format-based authoring. Worth knowing
about before designing our own:

- **[drizzle-seed](https://orm.drizzle.team/docs/seed-overview)**: TypeScript,
  reads Drizzle ORM schema, FK detection from `references()`, inserts parents
  before children, deterministic pRNG, refinements like `f.email()`.
- **[Snaplet Seed](https://snaplet-seed.netlify.app/seed/getting-started/overview)**
  (now Supabase-community-maintained): codegen reads Postgres schema, emits
  a typed TS client. Author writes `seed.users(x => x(10, { ... }))`. Snaplet
  the company shut down in 2024; project is open source now.
- **[Seedfast](https://seedfa.st/blog/database-seeder)**: commercial Postgres
  tool. Schema-aware, resolves FK graph automatically, handles circular FKs
  when schema allows deferrable constraints.
- **[supabase-community/seed](https://github.com/supabase-community/seed)**:
  community fork of Snaplet.
- **[Copycat](https://github.com/supabase-community/copycat)**: deterministic
  fake-value generator. Building block for the above.
- **Older / file-based**: Django fixtures (JSON/YAML, label-based refs), dbt
  seeds (CSV, for lookup data only), Rails fixtures (test-only).

The fact that nobody in 2026 has built a successful "generic declarative
seed-data file format with FK refs" is itself a signal: the design space is
hard, and the tools that punted on it (drizzle-seed, Snaplet, Seedfast) by
using schema introspection + code shipped faster and got more adoption.

Our differentiator, if we build this, is **declarative file as the contract**
(so multiple authoring frontends can target it) plus **SQL escape hatch**
(so the awkward 30% always has a home). That's a real gap nobody fills.

## What to do right now

Probably nothing. The original `.sqlx/` cache friction is small enough to
live with. If the friction grows, the cheapest unblock is the partial
inlining already in the working tree plus accepting the cache is still
required for the lib build.

If the appetite returns for the bigger engine, **start with the file format
decisions in order: format physics → FK refs → DSL vocabulary**. Write the
v1 spec, validate it by hand-writing the BJJ seed in it (including which
sections fall to the SQL escape hatch), then implement.

## Conversation context

This doc captures decisions and rejected paths from a single design
conversation. Not all reasoning is here — for the full thread, see the
session transcript. Key references:

- The "why does decoupling seed from cache need a crate split" finding was
  verified empirically by moving `.sqlx/` aside and running
  `cargo clean -p syllabus-tracker && cargo build --bin seed` (failed with
  122 errors from macros in the lib).
- The file-format / FK-refs design space was explored across 8 approaches
  (A–H); only A, B, E, H were considered seriously enough to keep.
- The web research was triggered by a "what does the rest of the world do"
  prompt and surfaced the schema-introspection convergence in modern tools.
