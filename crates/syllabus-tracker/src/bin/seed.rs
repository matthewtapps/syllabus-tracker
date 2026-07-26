//! Idempotent demo seed for the modern syllabus stack. Inserts a coach, an
//! admin, ~25 techniques, ~14 students, five named syllabi with curated
//! membership, per-student syllabus assignments with backdated SST progress,
//! syllabus attempts, pinned techniques, external YouTube videos, video watch
//! aggregates, and a backdated activity log. On top of that it seeds the
//! social layer so every feature surface has something to look at: discussion
//! threads with replies (technique / video / video-timestamp / sst / profile
//! anchors) and camps with referenced footage.
//!
//! The core stack (users .. activity backfill) is idempotent: existing rows are
//! detected and left alone (INSERT OR IGNORE + explicit existence checks). The
//! social/camp phases run AFTER the activity backfill (so their
//! live-emitted activity rows survive the rebuild) and are made re-run safe by
//! clearing their own feature tables before recreating them. Those tables hold
//! only demo data on a seeded dev DB, so the wipe is local to the demo.
//! All seed entities use `demo_` username/tag prefixes so they're easy to spot.
//! Pure new stack: no writes to the legacy `student_techniques`, `attempts`,
//! or `collections` tables.
//!
//! Run with `just seed` (which runs `just migrate` first to ensure the schema
//! is in place).

use std::process::ExitCode;
use std::str::FromStr;

use anyhow::{Context, Result};
use chrono::{Duration, NaiveDateTime, Utc};
use sqlx::SqlitePool;
use sqlx::sqlite::SqliteConnectOptions;
use syllabus_tracker::auth::Role;
use syllabus_tracker::db;
use syllabus_tracker::db::camps::NewCamp;
use syllabus_tracker::db::{
    Anchor, AnchorKind, NewExternalVideo, NewThread, ThreadVisibility, VideoParent,
    add_tag_to_technique, create_comment, create_external_video, create_syllabus, create_tag,
    create_technique, create_thread, create_user, find_user_by_username, get_tag_by_name,
    run_backfill, run_cursor_init,
};
use syllabus_tracker::env;
use syllabus_tracker::lib::seed::{ItemOutcome, SeedReporter, TerminalSeedReporter};
use syllabus_tracker::videos::embeds;

const STUDENT_NAMES: &[(&str, &str)] = &[
    ("demo_alex", "Alex Rivera"),
    ("demo_bianca", "Bianca Chen"),
    ("demo_marcus", "Marcus Johnson"),
    ("demo_priya", "Priya Patel"),
    ("demo_diego", "Diego Santos"),
    ("demo_sarah", "Sarah O'Brien"),
    ("demo_hiroshi", "Hiroshi Tanaka"),
    ("demo_maya", "Maya Williams"),
    ("demo_yusuf", "Yusuf Ahmed"),
    ("demo_camila", "Camila Rodriguez"),
    ("demo_tobias", "Tobias Nielsen"),
    ("demo_aisha", "Aisha Khan"),
    // Queue-state demos: render in the dashboard "Things for you" panel.
    ("demo_jordan", "Jordan Pierce"),
    ("demo_robin", "Robin Lee"),
];

/// (name, description, tag names)
const TECHNIQUES: &[(&str, &str, &[&str])] = &[
    (
        "Armbar from Closed Guard",
        "Control the wrist, swing the leg up over the head, and break the elbow joint over your hip.",
        &["Guard", "Submissions"],
    ),
    (
        "Triangle Choke from Closed Guard",
        "Trap one arm in, shoot the leg over the neck, lock the figure-four, and squeeze.",
        &["Guard", "Submissions"],
    ),
    (
        "Hip Bump Sweep",
        "Post on the elbow, bump the hips up and over, finish on top in mount.",
        &["Guard", "Sweeps"],
    ),
    (
        "Scissor Sweep",
        "Off-balance the opponent, cut one leg out with a scissor motion, finish in mount.",
        &["Guard", "Sweeps"],
    ),
    (
        "Pendulum Sweep",
        "Use the swing of your free leg to lift the opponent and reverse position.",
        &["Guard", "Sweeps"],
    ),
    (
        "Kimura from Guard",
        "Trap the wrist, figure-four grip, isolate the shoulder, finish the lock.",
        &["Guard", "Submissions"],
    ),
    (
        "Cross Collar Choke from Guard",
        "Deep collar grips with thumbs in, pull down, expand the chest to finish.",
        &["Guard", "Submissions"],
    ),
    (
        "Side Control Escape (Bridge & Shrimp)",
        "Bridge hard, shrimp the hips out, recover guard or turn to knees.",
        &["Side Control", "Escapes"],
    ),
    (
        "Side Control Escape (Knee Shield)",
        "Frame on the hip, insert a knee shield, recover half guard.",
        &["Side Control", "Escapes"],
    ),
    (
        "Kimura from Side Control",
        "Trap the far arm, figure-four grip, walk around to break the shoulder.",
        &["Side Control", "Submissions"],
    ),
    (
        "Americana from Side Control",
        "Pin the wrist to the mat, figure-four grip, paint the hand down for the lock.",
        &["Side Control", "Submissions"],
    ),
    (
        "Knee on Belly Transition",
        "Transition from side control to knee on belly while maintaining pressure.",
        &["Side Control", "Passes"],
    ),
    (
        "Mount Escape (Upa / Bridge)",
        "Trap an arm and a leg, bridge explosively over the trapped side to reverse.",
        &["Mount", "Escapes"],
    ),
    (
        "Mount Escape (Elbow-Knee)",
        "Frame on the hip, elbow-knee escape to recover half guard or full guard.",
        &["Mount", "Escapes"],
    ),
    (
        "Cross Choke from Mount",
        "Deep collar grips, thumbs in or out, drop your weight to apply the choke.",
        &["Mount", "Submissions"],
    ),
    (
        "Armbar from Mount",
        "Isolate the arm, swing the leg around, fall back into the armbar.",
        &["Mount", "Submissions"],
    ),
    (
        "Arm Triangle from Mount",
        "Trap the head and arm together, dismount to side, squeeze to finish.",
        &["Mount", "Submissions"],
    ),
    (
        "Rear Naked Choke",
        "Hooks in, chin-strap, snake the arm under the chin, finish with the figure-four.",
        &["Back", "Submissions"],
    ),
    (
        "Bow and Arrow Choke",
        "Collar grip from the back, control the leg, fall to the side and arch.",
        &["Back", "Submissions"],
    ),
    (
        "Back Escape",
        "Hand-fight the choking arm, slide down, escape the hooks to the floor.",
        &["Back", "Escapes"],
    ),
    (
        "Old School Sweep (Half Guard)",
        "Underhook, control the far ankle, kick out to come up on top.",
        &["Half Guard", "Sweeps"],
    ),
    (
        "Underhook Sweep (Half Guard)",
        "Establish the underhook, lift the opponent, dump them to the open side.",
        &["Half Guard", "Sweeps"],
    ),
    (
        "Knee Slice Pass",
        "Drive the slicing knee across the thigh, hand fight, settle into side control.",
        &["Passes"],
    ),
    (
        "Single Leg Takedown",
        "Penetration step, capture the leg, finish by running the pipe or dump.",
        &["Standing"],
    ),
    (
        "Double Leg Takedown",
        "Level change, penetration step, drive through to finish on top.",
        &["Standing"],
    ),
];

/// Syllabus definitions: (name, description, technique name slices).
/// Indices here map into TECHNIQUES by name lookup at runtime.
const SYLLABUS_DEFS: &[(&str, &str, &[&str])] = &[
    (
        "White Belt Fundamentals",
        "Core escapes and basics every white belt needs to build on.",
        &[
            "Side Control Escape (Bridge & Shrimp)",
            "Side Control Escape (Knee Shield)",
            "Mount Escape (Upa / Bridge)",
            "Mount Escape (Elbow-Knee)",
            "Back Escape",
            "Armbar from Closed Guard",
            "Triangle Choke from Closed Guard",
            "Kimura from Guard",
            "Scissor Sweep",
            "Hip Bump Sweep",
            "Cross Collar Choke from Guard",
            "Kimura from Side Control",
        ],
    ),
    (
        "Guard Game",
        "Attacks and sweeps from closed guard.",
        &[
            "Armbar from Closed Guard",
            "Triangle Choke from Closed Guard",
            "Kimura from Guard",
            "Cross Collar Choke from Guard",
            "Hip Bump Sweep",
            "Scissor Sweep",
            "Pendulum Sweep",
        ],
    ),
    (
        "Top Pressure",
        "Passing, pressure, and finishing from top positions.",
        &[
            "Side Control Escape (Bridge & Shrimp)",
            "Kimura from Side Control",
            "Americana from Side Control",
            "Knee on Belly Transition",
            "Cross Choke from Mount",
            "Armbar from Mount",
            "Arm Triangle from Mount",
            "Knee Slice Pass",
        ],
    ),
    (
        "Back Attacks",
        "Taking and finishing from back control.",
        &["Rear Naked Choke", "Bow and Arrow Choke", "Back Escape"],
    ),
    (
        "Competition Prep",
        "High-percentage techniques for the competition mat.",
        &[
            "Single Leg Takedown",
            "Double Leg Takedown",
            "Knee Slice Pass",
            "Armbar from Closed Guard",
            "Rear Naked Choke",
            "Triangle Choke from Closed Guard",
        ],
    ),
];

/// Per-student plan:
///   (syllabus_indices, red_pct, amber_pct, days_since_coach, has_new_activity,
///    days_since_last_attempt)
///
/// Ordered to match STUDENT_NAMES. Empty syllabus_indices means not yet assigned.
///
/// Triage bucket intent (triage reads last_student_activity_at vs last_coach_activity_at,
/// both within 14 days = "recent"):
///
///   Student-led  -- recent student attempt (days_since_last_attempt <= 10) AND
///                   no recent coach activity (days_since_coach > 14):
///                   Alex, Marcus, Sarah.
///
///   Both-active  -- recent student attempt (days_since_last_attempt <= 10) AND
///                   recent coach activity (days_since_coach <= 14):
///                   Bianca, Priya, Diego.
///
///   Coach-led    -- old student attempt (days_since_last_attempt > 16) AND
///                   recent coach activity (days_since_coach < 10):
///                   Hiroshi, Maya, Robin.
///
///   Quiet        -- old student attempt (days_since_last_attempt > 16) AND
///                   old coach activity (days_since_coach > 20):
///                   Yusuf, Camila, Tobias.
///
/// days_since_last_attempt controls the most-recent attempt timestamp; older
/// attempts spread backwards from there in equal steps.
type StudentPlan = (&'static [usize], f64, f64, i64, bool, i64);
const STUDENT_PLANS: &[StudentPlan] = &[
    // Alex -- Student-led: recent attempt (2 days), coach quiet (25 days).
    (&[0, 1, 2], 0.10, 0.30, 25, true, 2),
    // Bianca -- Both-active: recent attempt (1 day), recent coach (3 days).
    (&[0, 1], 0.20, 0.30, 3, false, 1),
    // Marcus -- Student-led: recent attempt (4 days), coach hasn't checked (18 days).
    // Has new student activity since coach's last look.
    (&[0, 2], 0.25, 0.40, 18, true, 4),
    // Priya -- Both-active: recent attempt (6 days), recent coach (8 days).
    (&[0, 4], 0.30, 0.40, 8, false, 6),
    // Diego -- Both-active: recent attempt (9 days), recent coach (5 days).
    (&[0], 0.40, 0.30, 5, false, 9),
    // Sarah -- Student-led: recent attempt (3 days), coach absent (20 days).
    // New activity flag marks an open thread.
    (&[0, 1], 0.30, 0.30, 20, true, 3),
    // Hiroshi -- Coach-led: old attempt (22 days), coach recently checked (7 days).
    (&[0, 2], 0.25, 0.35, 7, false, 22),
    // Maya -- Coach-led: old attempt (28 days), coach recently checked (4 days).
    (&[0], 0.50, 0.25, 4, false, 28),
    // Yusuf -- Quiet: old attempt (35 days), old coach (30 days).
    (&[0], 0.60, 0.25, 30, false, 35),
    // Camila -- Quiet: old attempt (45 days), old coach (28 days).
    (&[0], 0.70, 0.20, 28, false, 45),
    // Tobias -- Quiet: old attempt (60 days), old coach (35 days).
    (&[0], 0.80, 0.15, 35, false, 60),
    // Aisha -- just registered, no syllabi.
    (&[], 0.00, 0.00, 0, false, 0),
    // Jordan -- pending approval (claimed but unapproved).
    (&[], 0.00, 0.00, 0, false, 0),
    // Robin -- Coach-led: old attempt (19 days), coach recently engaged (6 days).
    // Active student who requested a password reset.
    (&[0, 3], 0.40, 0.40, 6, false, 19),
];

/// Deterministic "shuffle by stride" so the seed is reproducible without
/// pulling in a real RNG dependency.
fn pick_indices(total: usize, n: usize, seed: usize) -> Vec<usize> {
    let n = n.min(total);
    let mut taken: Vec<usize> = Vec::with_capacity(n);
    let mut idx = seed % total.max(1);
    let step = 7;
    while taken.len() < n {
        if !taken.contains(&idx) {
            taken.push(idx);
        }
        idx = (idx + step) % total;
        if taken.len() == total {
            break;
        }
    }
    taken
}

async fn ensure_user(
    pool: &SqlitePool,
    username: &str,
    password: &str,
    role: Role,
    display_name: &str,
) -> Result<(i64, ItemOutcome)> {
    let (id, outcome) = match find_user_by_username(pool, username).await? {
        Some(existing) => (existing.id, ItemOutcome::Existed),
        None => (
            create_user(pool, username, password, role.as_str(), Some(display_name)).await?,
            ItemOutcome::Created,
        ),
    };

    // Backfill credentials so demo accounts are usable end-to-end without
    // the invite/claim flow. We only overwrite empty fields so a developer
    // who changed their password won't have it reset on the next seed.
    let hashed = bcrypt::hash(password, bcrypt::DEFAULT_COST)?;
    sqlx::query(
        r#"UPDATE users
           SET password = CASE WHEN password = '' THEN ? ELSE password END,
               display_name = CASE WHEN COALESCE(display_name, '') = '' THEN ? ELSE display_name END,
               claimed_at = COALESCE(claimed_at, CURRENT_TIMESTAMP),
               approved_at = COALESCE(approved_at, CURRENT_TIMESTAMP)
           WHERE id = ?"#,
    )
    .bind(hashed)
    .bind(display_name)
    .bind(id)
    .execute(pool)
    .await?;

    Ok((id, outcome))
}

async fn ensure_tag(pool: &SqlitePool, name: &str) -> Result<(i64, ItemOutcome)> {
    if let Some(tag) = get_tag_by_name(pool, name).await? {
        return Ok((tag.id, ItemOutcome::Existed));
    }
    Ok((create_tag(pool, name).await?, ItemOutcome::Created))
}

async fn ensure_technique(
    pool: &SqlitePool,
    name: &str,
    description: &str,
    coach_id: i64,
    tag_ids: &[i64],
) -> Result<(i64, ItemOutcome)> {
    // Idempotency: look up by name.
    let existing: Option<(i64,)> =
        sqlx::query_as("SELECT id FROM techniques WHERE name = ? LIMIT 1")
            .bind(name)
            .fetch_optional(pool)
            .await?;
    if let Some((id,)) = existing {
        return Ok((id, ItemOutcome::Existed));
    }
    let id = create_technique(pool, name, description, coach_id, true).await?;
    for &tag_id in tag_ids {
        add_tag_to_technique(pool, id, tag_id, coach_id).await?;
    }
    Ok((id, ItemOutcome::Created))
}

/// Ensure a syllabus exists by name; return (id, outcome).
async fn ensure_syllabus(
    pool: &SqlitePool,
    name: &str,
    description: &str,
    coach_id: i64,
) -> Result<(i64, ItemOutcome)> {
    let existing: Option<(i64,)> = sqlx::query_as("SELECT id FROM syllabi WHERE name = ? LIMIT 1")
        .bind(name)
        .fetch_optional(pool)
        .await?;
    if let Some((id,)) = existing {
        return Ok((id, ItemOutcome::Existed));
    }
    let id = create_syllabus(pool, name, Some(description), coach_id).await?;
    Ok((id, ItemOutcome::Created))
}

/// Backdate the most-recently emitted activity row to `ts`. The live thread /
/// camp helpers stamp `now()` on the row they emit; the demo wants historical
/// spread so the feed orders believably.
/// Call immediately after the helper, before any other emit, so `MAX(id)` is
/// still the row we just wrote.
async fn backdate_last_activity(pool: &SqlitePool, ts: NaiveDateTime) -> Result<()> {
    sqlx::query("UPDATE activity SET occurred_at = ? WHERE id = (SELECT MAX(id) FROM activity)")
        .bind(ts)
        .execute(pool)
        .await?;
    Ok(())
}

/// Create one thread plus its (top-level) replies via the live helpers, then
/// backdate the thread row, every comment row, and each emitted activity row so
/// the conversation sits at `started` and steps forward by the per-reply hour
/// offsets. Returns the new thread id (cameos in camp references). `replies` is
/// `(author_id, body, hours_after_start)`.
#[allow(clippy::too_many_arguments)]
async fn seed_thread_with_replies(
    pool: &SqlitePool,
    reporter: &TerminalSeedReporter,
    author_id: i64,
    anchor: Anchor,
    visibility: ThreadVisibility,
    scope_student_id: Option<i64>,
    body: &str,
    started: NaiveDateTime,
    replies: &[(i64, &str, i64)],
) -> Result<i64> {
    let thread_id = create_thread(
        pool,
        NewThread {
            author_id,
            anchor,
            visibility,
            scope_student_id,
            body: body.to_string(),
            attached_video_id: None,
            attached_video_is_reference: false,
            attached_video_title: None,
        },
    )
    .await?;
    sqlx::query("UPDATE threads SET created_at = ?, last_activity_at = ? WHERE id = ?")
        .bind(started)
        .bind(started)
        .bind(thread_id)
        .execute(pool)
        .await?;
    backdate_last_activity(pool, started).await?;
    reporter.phase_item(ItemOutcome::Created);

    let mut last = started;
    for (reply_author, reply_body, hours_after) in replies {
        let comment_id = create_comment(pool, thread_id, None, *reply_author, reply_body, None, None, false).await?;
        let comment_time = started + Duration::hours(*hours_after);
        sqlx::query("UPDATE thread_comments SET created_at = ? WHERE id = ?")
            .bind(comment_time)
            .bind(comment_id)
            .execute(pool)
            .await?;
        backdate_last_activity(pool, comment_time).await?;
        last = comment_time;
        reporter.phase_item(ItemOutcome::Created);
    }
    // Bump the thread's last-activity to the final reply so the read side orders
    // it by genuine recency rather than the now() each comment stamped.
    sqlx::query("UPDATE threads SET last_activity_at = ? WHERE id = ?")
        .bind(last)
        .bind(thread_id)
        .execute(pool)
        .await?;
    Ok(thread_id)
}

#[tokio::main]
async fn main() -> ExitCode {
    if let Err(e) = run().await {
        eprintln!("Error: {:#}", e);
        return ExitCode::from(1);
    }
    ExitCode::SUCCESS
}

async fn run() -> Result<()> {
    env::load_environment().ok();

    let url = std::env::var("DATABASE_URL").unwrap_or_else(|_| "sqlite://sqlite.db".to_string());
    println!("Seeding demo data into {}", url);

    let reporter = TerminalSeedReporter::new();
    let phases = [
        "Connecting to database",       // 0
        "Ensuring coach user",          // 1
        "Ensuring admin user",          // 2
        "Seeding tags",                 // 3
        "Seeding techniques",           // 4
        "Seeding syllabi",              // 5
        "Seeding students",             // 6
        "Assigning syllabi + SSTs",     // 7
        "Graduating assignments",       // 8
        "Hiding SST rows",              // 9
        "Generating syllabus attempts", // 10
        "Pinning techniques",           // 11
        "Attaching external videos",    // 12
        "Seeding video watch data",     // 13
        "Rebuilding activity log",      // 14
        "Seeding discussion threads",   // 15
        "Seeding camps",                // 16
        "Refreshing activity cursors",  // 17
    ];
    reporter.seed_started(&phases);

    // 0. Connect to the database.
    reporter.phase_started(phases[0], Some(1));
    let opts = SqliteConnectOptions::from_str(&url)
        .with_context(|| format!("Invalid DATABASE_URL: {}", url))?
        .create_if_missing(true);
    let pool = SqlitePool::connect_with(opts)
        .await
        .context("Failed to connect to database")?;
    reporter.phase_finished();

    // Use NaiveDateTime so sqlx encodes timestamps as "%F %T%.f" (the same
    // format CURRENT_TIMESTAMP and mark_seen use). Mixing DateTime<Utc> would
    // store RFC3339 strings with a 'T' separator; the dashboard query then
    // text-compares them against space-form values and the unread flag breaks.
    let now: NaiveDateTime = Utc::now().naive_utc();

    // 1. Coach
    reporter.phase_started(phases[1], Some(1));
    let (coach_id, outcome) =
        ensure_user(&pool, "demo_coach", "password", Role::Coach, "Demo Coach").await?;
    reporter.phase_item(outcome);
    reporter.phase_finished();

    // 2. Admin
    reporter.phase_started(phases[2], Some(1));
    let (_admin_id, outcome) = ensure_user(&pool, "admin", "demo", Role::Admin, "Admin").await?;
    reporter.phase_item(outcome);
    reporter.phase_finished();

    // 3. Tags
    const TAGS: &[&str] = &[
        "Guard",
        "Side Control",
        "Mount",
        "Back",
        "Half Guard",
        "Standing",
        "Submissions",
        "Sweeps",
        "Escapes",
        "Passes",
    ];
    reporter.phase_started(phases[3], Some(TAGS.len() as u64));
    let mut tag_ids: std::collections::HashMap<&str, i64> = std::collections::HashMap::new();
    for tag in TAGS {
        let (id, outcome) = ensure_tag(&pool, tag).await?;
        tag_ids.insert(tag, id);
        reporter.phase_item(outcome);
    }
    reporter.phase_finished();

    // 4. Techniques (with tags)
    reporter.phase_started(phases[4], Some(TECHNIQUES.len() as u64));
    let mut technique_ids: Vec<i64> = Vec::with_capacity(TECHNIQUES.len());
    // Also build a name -> id map for syllabus membership lookups.
    let mut technique_by_name: std::collections::HashMap<&str, i64> =
        std::collections::HashMap::new();
    for (name, description, tags) in TECHNIQUES {
        let tids: Vec<i64> = tags
            .iter()
            .filter_map(|t| tag_ids.get(*t).copied())
            .collect();
        let (id, outcome) = ensure_technique(&pool, name, description, coach_id, &tids).await?;
        technique_ids.push(id);
        technique_by_name.insert(name, id);
        reporter.phase_item(outcome);
    }
    reporter.phase_finished();

    // 5. Syllabi + membership
    reporter.phase_started(phases[5], Some(SYLLABUS_DEFS.len() as u64));
    let mut syllabus_ids: Vec<i64> = Vec::with_capacity(SYLLABUS_DEFS.len());
    for (name, description, member_names) in SYLLABUS_DEFS {
        let (syllabus_id, outcome) = ensure_syllabus(&pool, name, description, coach_id).await?;
        syllabus_ids.push(syllabus_id);

        // Add technique members via direct INSERT OR IGNORE (bypasses the live
        // add_technique_to_syllabus which fans out activity -- we'll do a clean
        // backfill at the end instead).
        for (pos, tech_name) in member_names.iter().enumerate() {
            if let Some(&tid) = technique_by_name.get(*tech_name) {
                sqlx::query(
                    "INSERT OR IGNORE INTO syllabus_techniques
                         (syllabus_id, technique_id, position, added_by_id)
                     VALUES (?, ?, ?, ?)",
                )
                .bind(syllabus_id)
                .bind(tid)
                .bind(pos as i64)
                .bind(coach_id)
                .execute(&pool)
                .await?;
            }
        }

        reporter.phase_item(outcome);
    }
    reporter.phase_finished();

    // 6. Students
    reporter.phase_started(phases[6], Some(STUDENT_NAMES.len() as u64));
    let mut student_ids: Vec<i64> = Vec::with_capacity(STUDENT_NAMES.len());
    for (username, display_name) in STUDENT_NAMES {
        let (id, outcome) =
            ensure_user(&pool, username, "demo", Role::Student, display_name).await?;
        student_ids.push(id);
        reporter.phase_item(outcome);
    }
    // Force queue-state demos into the shapes the dashboard expects.
    sqlx::query("UPDATE users SET approved_at = NULL WHERE username = 'demo_jordan'")
        .execute(&pool)
        .await?;
    sqlx::query(
        "UPDATE users SET reset_requested_at = CURRENT_TIMESTAMP WHERE username = 'demo_robin'",
    )
    .execute(&pool)
    .await?;
    reporter.phase_finished();

    // 7. Assign syllabi + materialize SSTs with backdated timestamps.
    //
    // For each (student, syllabus) in the per-student plan we:
    //   a) INSERT OR IGNORE into syllabus_assignments (backdated assigned_at).
    //   b) INSERT OR IGNORE into student_syllabus_techniques for every member.
    //   c) UPDATE the SST row with status, notes, and backdated timestamps.
    //
    // Direct SQL throughout so we control every timestamp. The live db helpers
    // (assign, update_sst) stamp now(); we want backdated data for the demo.
    let student_notes_pool = [
        "Felt smooth today.",
        "Need to drill the timing more.",
        "Coach said grip earlier next time.",
        "Hit it in sparring.",
        "Stalled on the setup, will revisit.",
        "Linked it to the previous transition.",
    ];
    let coach_notes_pool = [
        "Clean execution.",
        "Watch the head position.",
        "Better than last week.",
        "Stay heavier on the chest.",
    ];

    // Count total SST rows for the progress bar.
    let total_ssts: u64 = STUDENT_PLANS
        .iter()
        .flat_map(|(syllabus_indices, ..)| syllabus_indices.iter())
        .map(|&si| SYLLABUS_DEFS.get(si).map(|(_, _, m)| m.len()).unwrap_or(0) as u64)
        .sum();
    reporter.phase_started(phases[7], Some(total_ssts));

    // Track (student_id, assignment_id) pairs for later steps.
    let mut assignment_map: std::collections::HashMap<(i64, usize), i64> =
        std::collections::HashMap::new();

    for (student_idx, &student_id) in student_ids.iter().enumerate() {
        let &(syllabus_indices, red_pct, amber_pct, days_since_coach, has_new_activity, _days_since_last_attempt) =
            &STUDENT_PLANS[student_idx];

        let coach_update_time = now - Duration::days(days_since_coach);
        let student_update_time = if has_new_activity {
            Some(coach_update_time + Duration::hours(2 + (student_idx as i64 % 12)))
        } else {
            None
        };

        for (syl_order, &syl_idx) in syllabus_indices.iter().enumerate() {
            let syllabus_id = syllabus_ids[syl_idx];
            let (_, _, member_names) = SYLLABUS_DEFS[syl_idx];

            // Backdate the assignment: older students have older assignments.
            let assigned_at = now - Duration::days(days_since_coach + 30 + syl_order as i64 * 14);

            // INSERT OR IGNORE so re-runs skip existing assignments.
            sqlx::query(
                "INSERT OR IGNORE INTO syllabus_assignments
                     (student_id, syllabus_id, assigned_at, assigned_by_id)
                 VALUES (?, ?, ?, ?)",
            )
            .bind(student_id)
            .bind(syllabus_id)
            .bind(assigned_at)
            .bind(coach_id)
            .execute(&pool)
            .await?;

            let assignment_id: i64 = sqlx::query_as::<_, (i64,)>(
                "SELECT id FROM syllabus_assignments WHERE student_id = ? AND syllabus_id = ?",
            )
            .bind(student_id)
            .bind(syllabus_id)
            .fetch_one(&pool)
            .await?
            .0;

            assignment_map.insert((student_id, syl_idx), assignment_id);

            // Materialize SSTs for every technique in this syllabus.
            let total_count = member_names.len();
            for (tech_pos, tech_name) in member_names.iter().enumerate() {
                let Some(&technique_id) = technique_by_name.get(*tech_name) else {
                    continue;
                };

                // INSERT OR IGNORE: idempotent.
                let created_at = assigned_at + Duration::minutes(tech_pos as i64);
                sqlx::query(
                    "INSERT OR IGNORE INTO student_syllabus_techniques
                         (assignment_id, technique_id, created_at, updated_at)
                     VALUES (?, ?, ?, ?)",
                )
                .bind(assignment_id)
                .bind(technique_id)
                .bind(created_at)
                .bind(created_at)
                .execute(&pool)
                .await?;

                // Determine status by position fraction.
                let p = if total_count > 1 {
                    tech_pos as f64 / (total_count - 1) as f64
                } else {
                    0.0
                };
                let status = if p < red_pct {
                    "red"
                } else if p < red_pct + amber_pct {
                    "amber"
                } else {
                    "green"
                };

                // Spread coach update times so techniques don't share a timestamp.
                let st_coach_time = coach_update_time - Duration::minutes(tech_pos as i64 * 7);

                // Flag the first technique of the first syllabus for active students.
                let st_student_time =
                    student_update_time.filter(|_| tech_pos == 0 && syl_order == 0);

                let updated_at = st_student_time.unwrap_or(st_coach_time);

                let coach_note = match status {
                    "green" => Some("Mastered. Move on to combinations."),
                    "amber" => Some("Good progress. Drill the timing."),
                    _ => None,
                };
                let student_note = match status {
                    "green" => Some("Feeling confident with this one."),
                    _ => None,
                };

                sqlx::query(
                    r#"UPDATE student_syllabus_techniques
                       SET status = ?,
                           coach_notes = ?,
                           student_notes = ?,
                           updated_at = ?,
                           last_coach_update_at = ?,
                           last_coach_update_by_id = ?,
                           last_student_update_at = ?,
                           last_student_update_by_id = ?
                       WHERE assignment_id = ? AND technique_id = ?"#,
                )
                .bind(status)
                .bind(coach_note)
                .bind(student_note)
                .bind(updated_at)
                .bind(st_coach_time)
                .bind(coach_id)
                .bind(st_student_time)
                .bind(st_student_time.map(|_| student_id))
                .bind(assignment_id)
                .bind(technique_id)
                .execute(&pool)
                .await?;

                reporter.phase_item(ItemOutcome::Created);
            }
        }
    }
    reporter.phase_finished();

    // 8. Graduations: graduate Alex's first syllabus (White Belt Fundamentals)
    // and Bianca's first syllabus. Both are well-progressed enough to merit it.
    reporter.phase_started(phases[8], Some(2));
    for &student_idx in &[0usize, 1usize] {
        let student_id = student_ids[student_idx];
        let syl_idx = 0usize; // White Belt Fundamentals
        if let Some(&assignment_id) = assignment_map.get(&(student_id, syl_idx)) {
            let grad_time = now - Duration::days(10 + student_idx as i64 * 5);
            // Only graduate if not already graduated.
            let already: i64 = sqlx::query_as::<_, (i64,)>(
                "SELECT COUNT(*) FROM syllabus_assignments WHERE id = ? AND graduated_at IS NOT NULL",
            )
            .bind(assignment_id)
            .fetch_one(&pool)
            .await?
            .0;
            if already == 0 {
                sqlx::query(
                    "UPDATE syllabus_assignments
                     SET graduated_at = ?, graduated_by_id = ?
                     WHERE id = ?",
                )
                .bind(grad_time)
                .bind(coach_id)
                .bind(assignment_id)
                .execute(&pool)
                .await?;
                reporter.phase_item(ItemOutcome::Created);
            } else {
                reporter.phase_item(ItemOutcome::Existed);
            }
        } else {
            reporter.phase_item(ItemOutcome::Existed);
        }
    }
    reporter.phase_finished();

    // 9. Hide a couple of SST rows to exercise the soft-hide path.
    // Hide the first technique in Diego's White Belt Fundamentals and
    // Hiroshi's White Belt Fundamentals.
    reporter.phase_started(phases[9], Some(2));
    for &student_idx in &[4usize, 6usize] {
        let student_id = student_ids[student_idx];
        let syl_idx = 0usize;
        if let Some(&assignment_id) = assignment_map.get(&(student_id, syl_idx)) {
            let (_, _, member_names) = SYLLABUS_DEFS[syl_idx];
            if let Some(first_name) = member_names.first() {
                if let Some(&tid) = technique_by_name.get(*first_name) {
                    let hidden_time = now - Duration::days(5);
                    // Only hide if not already hidden.
                    let already: i64 = sqlx::query_as::<_, (i64,)>(
                        "SELECT COUNT(*) FROM student_syllabus_techniques
                         WHERE assignment_id = ? AND technique_id = ? AND hidden_at IS NOT NULL",
                    )
                    .bind(assignment_id)
                    .bind(tid)
                    .fetch_one(&pool)
                    .await?
                    .0;
                    if already == 0 {
                        sqlx::query(
                            "UPDATE student_syllabus_techniques
                             SET hidden_at = ?, hidden_by_id = ?, updated_at = ?
                             WHERE assignment_id = ? AND technique_id = ?",
                        )
                        .bind(hidden_time)
                        .bind(coach_id)
                        .bind(hidden_time)
                        .bind(assignment_id)
                        .bind(tid)
                        .execute(&pool)
                        .await?;
                        reporter.phase_item(ItemOutcome::Created);
                    } else {
                        reporter.phase_item(ItemOutcome::Existed);
                    }
                    continue;
                }
            }
        }
        reporter.phase_item(ItemOutcome::Existed);
    }
    reporter.phase_finished();

    // 10. Syllabus attempts: most-recent attempt anchored to days_since_last_attempt
    //     per student, older attempts spreading back from there. Status drives count.
    //     Skip SSTs that already have attempts (idempotency).
    reporter.phase_started(phases[10], None);
    for (student_idx, &student_id) in student_ids.iter().enumerate() {
        let (syllabus_indices, .., days_since_last_attempt) = STUDENT_PLANS[student_idx];

        for &syl_idx in syllabus_indices {
            let Some(&assignment_id) = assignment_map.get(&(student_id, syl_idx)) else {
                continue;
            };

            let sst_rows: Vec<(i64, String)> = sqlx::query_as(
                "SELECT id, status FROM student_syllabus_techniques WHERE assignment_id = ?",
            )
            .bind(assignment_id)
            .fetch_all(&pool)
            .await?;

            for (row_idx, (sst_id, status)) in sst_rows.iter().enumerate() {
                let existing: (i64,) =
                    sqlx::query_as("SELECT COUNT(*) FROM syllabus_attempts WHERE student_syllabus_technique_id = ?")
                        .bind(sst_id)
                        .fetch_one(&pool)
                        .await?;
                if existing.0 > 0 {
                    for _ in 0..existing.0 {
                        reporter.phase_item(ItemOutcome::Existed);
                    }
                    continue;
                }

                let target = match status.as_str() {
                    "green" => 4 + ((student_id + sst_id) as usize % 5), // 4..=8
                    "amber" => 1 + ((student_id + sst_id) as usize % 3), // 1..=3
                    _ => {
                        if (student_id as usize + row_idx) % 6 == 0 {
                            1
                        } else {
                            0
                        }
                    }
                };
                if target == 0 {
                    continue;
                }

                for n in 0..target {
                    // Most-recent attempt (n=0) is days_since_last_attempt ago;
                    // earlier attempts (n=1,2,...) spread back an additional
                    // ~7 days each so the history is plausible but not bunched.
                    let days_back =
                        days_since_last_attempt + (n as i64 * 7);
                    let hour_offset = ((sst_id + n as i64) % 12) - 6;
                    let attempted_at =
                        now - Duration::days(days_back) + Duration::hours(hour_offset);

                    // Alternate recorder: even = student, odd = coach.
                    let recorder = if (n + row_idx) % 2 == 0 {
                        student_id
                    } else {
                        coach_id
                    };

                    let has_my_note = (*sst_id as usize + n) % 3 == 0;
                    let has_cross_note = (*sst_id as usize + n) % 7 == 0;

                    let student_note_text: Option<&str> = if recorder == student_id && has_my_note {
                        Some(student_notes_pool[(*sst_id as usize + n) % student_notes_pool.len()])
                    } else if recorder == coach_id && has_cross_note {
                        Some(
                            student_notes_pool
                                [(*sst_id as usize + n + 1) % student_notes_pool.len()],
                        )
                    } else {
                        None
                    };
                    let coach_note_text: Option<&str> = if recorder == coach_id && has_my_note {
                        Some(coach_notes_pool[(*sst_id as usize + n) % coach_notes_pool.len()])
                    } else if recorder == student_id && has_cross_note {
                        Some(coach_notes_pool[(*sst_id as usize + n + 1) % coach_notes_pool.len()])
                    } else {
                        None
                    };

                    let coach_note_by = coach_note_text.map(|_| coach_id);
                    let coach_note_at = coach_note_text.map(|_| attempted_at);
                    let student_note_at = student_note_text.map(|_| attempted_at);

                    sqlx::query(
                        r#"INSERT INTO syllabus_attempts (
                              student_syllabus_technique_id, recorded_by_id, attempted_at,
                              coach_note, coach_note_by_id, coach_note_at,
                              student_note, student_note_at
                           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"#,
                    )
                    .bind(sst_id)
                    .bind(recorder)
                    .bind(attempted_at)
                    .bind(coach_note_text)
                    .bind(coach_note_by)
                    .bind(coach_note_at)
                    .bind(student_note_text)
                    .bind(student_note_at)
                    .execute(&pool)
                    .await?;
                    reporter.phase_item(ItemOutcome::Created);
                }
            }
        }
    }
    reporter.phase_finished();

    // 11. Pinned techniques: active students pin 2-4 library techniques.
    reporter.phase_started(phases[11], None);
    for (student_idx, &student_id) in student_ids.iter().enumerate() {
        // Skip Aisha (11), Jordan (12) -- not yet active.
        if student_idx >= 11 {
            continue;
        }
        let pin_count = 2 + (student_id as usize % 3); // 2, 3, or 4
        let indices = pick_indices(technique_ids.len(), pin_count, student_id as usize + 3);
        let pinned_at = now - Duration::days(student_idx as i64 * 3 + 1);
        for &ti in &indices {
            let technique_id = technique_ids[ti];
            sqlx::query(
                "INSERT OR IGNORE INTO student_pinned_techniques
                     (student_id, technique_id, pinned_at)
                 VALUES (?, ?, ?)",
            )
            .bind(student_id)
            .bind(technique_id)
            .bind(pinned_at)
            .execute(&pool)
            .await?;
            reporter.phase_item(ItemOutcome::Created);
        }
    }
    reporter.phase_finished();

    // 12. External videos: attach real YouTube URLs to specific techniques.
    //     Use embeds::parse to extract kind / host / video_id exactly as the
    //     add-external-video route does.
    let video_map: &[(&str, &[&str])] = &[
        (
            "Armbar from Mount",
            &["https://www.youtube.com/watch?v=rsKQtAlHy2k"],
        ),
        (
            "Armbar from Closed Guard",
            &["https://www.youtube.com/watch?v=6R4hlTfrFKA"],
        ),
        (
            "Rear Naked Choke",
            &[
                "https://www.youtube.com/watch?v=l8-JI7NND3E",
                "https://www.youtube.com/watch?v=P2RBbWHz0Bs",
            ],
        ),
        (
            "Back Escape",
            &[
                "https://www.youtube.com/watch?v=LNh4mneBgf0",
                "https://www.youtube.com/watch?v=sGSI4sk-oxc",
            ],
        ),
        (
            "Scissor Sweep",
            &["https://www.youtube.com/watch?v=RStk1znIVOs"],
        ),
        (
            "Mount Escape (Upa / Bridge)",
            &["https://www.youtube.com/watch?v=OV97TfC73HY"],
        ),
        (
            "Kimura from Guard",
            &["https://www.youtube.com/watch?v=WveRLOwZl2U"],
        ),
    ];

    reporter.phase_started(phases[12], None);
    // technique_name -> vec of video_ids (for the watch-aggregate step).
    let mut video_ids_by_technique: std::collections::HashMap<&str, Vec<i64>> =
        std::collections::HashMap::new();

    for &(technique_name, urls) in video_map {
        let Some(&technique_id) = technique_by_name.get(technique_name) else {
            eprintln!(
                "  warn: technique '{}' not found, skipping videos",
                technique_name
            );
            continue;
        };

        for &url in urls {
            // Idempotent: skip if a video with this URL already exists.
            let exists: Option<(i64,)> = sqlx::query_as(
                "SELECT id FROM videos WHERE external_url = ? AND deleted_at IS NULL LIMIT 1",
            )
            .bind(url)
            .fetch_optional(&pool)
            .await?;
            if let Some((vid,)) = exists {
                video_ids_by_technique
                    .entry(technique_name)
                    .or_default()
                    .push(vid);
                reporter.phase_item(ItemOutcome::Existed);
                continue;
            }

            let parsed = embeds::parse(url);
            let title = format!("{} (video)", technique_name);
            let vid = create_external_video(
                &pool,
                NewExternalVideo {
                    parent: VideoParent::Technique(technique_id),
                    title: &title,
                    description: None,
                    uploaded_by_id: coach_id,
                    kind: parsed.kind,
                    external_url: &parsed.canonical_url,
                    external_host: Some(parsed.host.as_str()),
                    external_video_id: parsed.video_id.as_deref(),
                },
            )
            .await?;
            video_ids_by_technique
                .entry(technique_name)
                .or_default()
                .push(vid);
            reporter.phase_item(ItemOutcome::Created);
        }
    }
    reporter.phase_finished();

    // 13. Video watch aggregates: seed watch history for active students who
    //     have the technique in their syllabus or pinned.
    reporter.phase_started(phases[13], None);
    for (student_idx, &student_id) in student_ids.iter().enumerate() {
        // Only students with syllabi.
        if student_idx >= 11 {
            continue;
        }
        let (syllabus_indices, ..) = STUDENT_PLANS[student_idx];

        for &syl_idx in syllabus_indices {
            let (_, _, member_names) = SYLLABUS_DEFS[syl_idx];
            for tech_name in member_names.iter() {
                let Some(vids) = video_ids_by_technique.get(*tech_name) else {
                    continue;
                };
                // Only ~every-other student watches each video, for variety.
                if (student_idx + tech_name.len()) % 3 == 0 {
                    continue;
                }
                for (v_idx, &video_id) in vids.iter().enumerate() {
                    // Spread watches across 0-25 days so a healthy number
                    // land within the 7-day digest window while keeping some
                    // older for a prior-week baseline. Modulus prevents
                    // clustering and keeps the result deterministic.
                    let days_ago =
                        ((student_idx * 3 + v_idx * 5) % 26) as i64;
                    let first_watched = now - Duration::days(days_ago);
                    // last_watched must not exceed now; add up to 3 days but
                    // clamp so future dates are impossible.
                    let last_watched = (first_watched + Duration::days(3)).min(now);
                    let play_count = 1 + (student_idx + v_idx) as i64 % 4;
                    let completed_count = (play_count / 2).max(1);
                    let total_seconds = play_count * 180;

                    sqlx::query(
                        "INSERT OR IGNORE INTO video_watch_aggregates
                             (video_id, user_id, play_count, completed_count,
                              total_seconds_watched, first_watched_at, last_watched_at)
                         VALUES (?, ?, ?, ?, ?, ?, ?)",
                    )
                    .bind(video_id)
                    .bind(student_id)
                    .bind(play_count)
                    .bind(completed_count)
                    .bind(total_seconds)
                    .bind(first_watched)
                    .bind(last_watched)
                    .execute(&pool)
                    .await?;
                    reporter.phase_item(ItemOutcome::Created);
                }
            }
        }
    }
    reporter.phase_finished();

    // 14. Activity log: clear any inline rows that helpers emitted during
    //     seeding, then run the canonical backfill from source timestamps.
    reporter.phase_started(phases[14], Some(3));

    sqlx::query("DELETE FROM activity_seen_overrides")
        .execute(&pool)
        .await?;
    sqlx::query("DELETE FROM activity_cursors")
        .execute(&pool)
        .await?;
    sqlx::query("DELETE FROM activity").execute(&pool).await?;
    reporter.phase_item(ItemOutcome::Created); // cleared

    let counts = run_backfill(&pool).await?;
    reporter.phase_item(ItemOutcome::Created); // backfilled

    run_cursor_init(&pool).await?;
    reporter.phase_item(ItemOutcome::Created); // cursors initialised

    // Give the coach ~15 unread so the badge shows something on first login.
    sqlx::query(
        "UPDATE activity_cursors
         SET max_seen_id = MAX(0, (SELECT COALESCE(MAX(id), 0) FROM activity) - 15)
         WHERE viewer_user_id = ?",
    )
    .bind(coach_id)
    .execute(&pool)
    .await?;
    reporter.phase_finished();

    println!(
        "  Activity backfill: {} attempts, {} student notes, {} coach notes, \
         {} watches, {} assignments, {} graduations, {} pins",
        counts.attempts,
        counts.student_notes,
        counts.coach_notes,
        counts.watches,
        counts.assignments,
        counts.graduations,
        counts.pins,
    );

    // ------------------------------------------------------------------
    // Social / camp layer.
    //
    // These run AFTER the activity rebuild (phase 14) so their live-emitted
    // activity rows are not wiped by the backfill's DELETE. Each phase clears
    // its own feature tables first, so re-running the seed replaces rather than
    // duplicates. The live helpers stamp `now()` on the activity they emit;
    // `backdate_last_activity` / `seed_thread_with_replies` push those back to a
    // realistic spread so the feed orders believably.
    // ------------------------------------------------------------------

    // Resolve a few ids the social content hangs off. `.get(..).copied()` keeps
    // the seed resilient if a technique/video is renamed out from under it.
    let tid_of = |name: &str| technique_by_name.get(name).copied();
    let first_video = |name: &str| {
        video_ids_by_technique
            .get(name)
            .and_then(|v| v.first())
            .copied()
    };

    // 15. Discussion threads (with replies). Broadcast threads on shared library
    //     nouns drive the gym-wide comment tiles; private threads scoped to a
    //     student show on that student's feed.
    reporter.phase_started(phases[15], None);
    sqlx::query("DELETE FROM thread_comments")
        .execute(&pool)
        .await?;
    sqlx::query("DELETE FROM threads").execute(&pool).await?;

    // Broadcast: video-timestamp thread on the Armbar from Mount footage.
    if let Some(vid) = first_video("Armbar from Mount") {
        seed_thread_with_replies(
            &pool,
            &reporter,
            coach_id,
            Anchor {
                kind: AnchorKind::VideoTimestamp,
                id: vid,
                video_ts_seconds: Some(45),
                pinned_student_id: None,
                camp_id: None,
            },
            ThreadVisibility::Broadcast,
            None,
            "Right here the hips drive up into the armbar before the leg swings over. \
             Watch the timing, most people reach for the leg too early.",
            now - Duration::days(9) + Duration::hours(19),
            &[
                (student_ids[2], "Oh, that's the bit I keep missing.", 2),
                (student_ids[3], "Drilled it tonight, felt way tighter.", 14),
            ],
        )
        .await?;
    }

    // Broadcast: whole-video thread on the Rear Naked Choke footage.
    let rnc_thread = if let Some(vid) = first_video("Rear Naked Choke") {
        Some(
            seed_thread_with_replies(
                &pool,
                &reporter,
                coach_id,
                Anchor {
                    kind: AnchorKind::Video,
                    id: vid,
                    video_ts_seconds: None,
                    pinned_student_id: None,
                    camp_id: None,
                },
                ThreadVisibility::Broadcast,
                None,
                "Classic finish. Get the chin strap locked before you feed the second hand \
                 or they will tuck and defend.",
                now - Duration::days(6) + Duration::hours(20),
                &[(student_ids[4], "Hand position makes all the difference.", 3)],
            )
            .await?,
        )
    } else {
        None
    };

    // Broadcast: technique-anchored thread (no video) on the triangle.
    if let Some(tid) = tid_of("Triangle Choke from Closed Guard") {
        seed_thread_with_replies(
            &pool,
            &reporter,
            coach_id,
            Anchor {
                kind: AnchorKind::Technique,
                id: tid,
                video_ts_seconds: None,
                pinned_student_id: None,
                camp_id: None,
            },
            ThreadVisibility::Broadcast,
            None,
            "Common question in class: cut the angle off before you finish the triangle. \
             Square on and it stalls every time.",
            now - Duration::days(4) + Duration::hours(18),
            &[
                (student_ids[1], "This finally clicked for me last week.", 5),
                (student_ids[0], "Cutting the angle is everything.", 26),
            ],
        )
        .await?;
    }

    // Broadcast: another video-timestamp thread on the scissor sweep.
    if let Some(vid) = first_video("Scissor Sweep") {
        seed_thread_with_replies(
            &pool,
            &reporter,
            coach_id,
            Anchor {
                kind: AnchorKind::VideoTimestamp,
                id: vid,
                video_ts_seconds: Some(70),
                pinned_student_id: None,
                camp_id: None,
            },
            ThreadVisibility::Broadcast,
            None,
            "The off-balance comes from the collar pull, not the legs. Notice how the lean \
             happens before the scissor.",
            now - Duration::days(2) + Duration::hours(21),
            &[],
        )
        .await?;
    }

    // Private: SST-anchored coaching thread scoped to Alex on his armbar.
    if let Some(armbar_tid) = tid_of("Armbar from Closed Guard") {
        let alex_armbar_sst: Option<i64> = sqlx::query_as::<_, (i64,)>(
            "SELECT sst.id
             FROM student_syllabus_techniques sst
             JOIN syllabus_assignments a ON a.id = sst.assignment_id
             WHERE a.student_id = ? AND sst.technique_id = ?
             LIMIT 1",
        )
        .bind(student_ids[0])
        .bind(armbar_tid)
        .fetch_optional(&pool)
        .await?
        .map(|r| r.0);

        if let Some(sst_id) = alex_armbar_sst {
            seed_thread_with_replies(
                &pool,
                &reporter,
                coach_id,
                Anchor {
                    kind: AnchorKind::Sst,
                    id: sst_id,
                    video_ts_seconds: None,
                    pinned_student_id: None,
                    camp_id: None,
                },
                ThreadVisibility::Private,
                Some(student_ids[0]),
                "Saw your reps tonight Alex. Pinch the knees on the finish and you have got it.",
                now - Duration::days(3) + Duration::hours(20),
                &[(
                    student_ids[0],
                    "Thanks coach, the knee pinch was the missing piece.",
                    15,
                )],
            )
            .await?;
        }
    }

    // Private: student-profile thread scoped to Bianca (broadcast is not allowed
    // on profile anchors, so this stays private to her feed).
    seed_thread_with_replies(
        &pool,
        &reporter,
        coach_id,
        Anchor {
            kind: AnchorKind::StudentProfile,
            id: student_ids[1],
            video_ts_seconds: None,
            pinned_student_id: None,
            camp_id: None,
        },
        ThreadVisibility::Private,
        Some(student_ids[1]),
        "Great month of consistency Bianca. Let's start layering combinations onto the basics.",
        now - Duration::days(5) + Duration::hours(17),
        &[(
            student_ids[1],
            "Appreciate it, feeling much more confident on top.",
            20,
        )],
    )
    .await?;
    reporter.phase_finished();

    // 16. Camps: per-student technique blocks with referenced footage.
    reporter.phase_started(phases[16], None);
    sqlx::query("DELETE FROM camp_referenced_threads")
        .execute(&pool)
        .await?;
    sqlx::query("DELETE FROM camps").execute(&pool).await?;

    // (student_idx, name, description, days_ago)
    type CampPlan = (usize, &'static str, &'static str, i64);
    let camp_plan: &[CampPlan] = &[
        (
            0,
            "Winter Classic Prep",
            "Eight week block sharpening takedowns and the armbar series for the Winter Classic.",
            21,
        ),
        (
            1,
            "Top Pressure Block",
            "Passing and pinning camp built around heavy top pressure.",
            14,
        ),
        (
            4,
            "Back Attack Camp",
            "Taking the back and finishing the choke, plus the escape when it goes the other way.",
            10,
        ),
    ];

    let mut camp_by_student: std::collections::HashMap<usize, i64> =
        std::collections::HashMap::new();
    for (student_idx, name, description, days_ago) in camp_plan {
        let created = now - Duration::days(*days_ago);
        let camp_id = db::camps::create_camp(
            &pool,
            NewCamp {
                student_id: student_ids[*student_idx],
                coach_id,
                name: name.to_string(),
                description: Some(description.to_string()),
            },
        )
        .await?;
        sqlx::query("UPDATE camps SET created_at = ? WHERE id = ?")
            .bind(created)
            .bind(camp_id)
            .execute(&pool)
            .await?;
        backdate_last_activity(&pool, created).await?;
        camp_by_student.insert(*student_idx, camp_id);
        reporter.phase_item(ItemOutcome::Created);

        // Private camp-anchored discussion thread.
        seed_thread_with_replies(
            &pool,
            &reporter,
            coach_id,
            Anchor {
                kind: AnchorKind::Camp,
                id: camp_id,
                video_ts_seconds: None,
                pinned_student_id: None,
                camp_id: None,
            },
            ThreadVisibility::Private,
            Some(student_ids[*student_idx]),
            "Kicking off the camp. Footage review Thursday, come with questions on the gaps \
             you have spotted.",
            created + Duration::hours(2),
            &[(
                student_ids[*student_idx],
                "On it, reviewing my last comp footage now.",
                26,
            )],
        )
        .await?;
    }

    // Referenced footage links (pure join rows; no helper, so raw INSERT).
    // Alex's camp references the RNC discussion thread.
    if let Some(&alex_camp) = camp_by_student.get(&0) {
        if let Some(thread_id) = rnc_thread {
            sqlx::query(
                "INSERT OR IGNORE INTO camp_referenced_threads (camp_id, thread_id) VALUES (?, ?)",
            )
            .bind(alex_camp)
            .bind(thread_id)
            .execute(&pool)
            .await?;
            reporter.phase_item(ItemOutcome::Created);
        }
    }
    reporter.phase_finished();

    // 17. Refresh cursors so the new social activity is accounted for: mark all
    //     viewers caught up, then hand the coach ~15 unread for the badge.
    reporter.phase_started(phases[17], Some(1));
    run_cursor_init(&pool).await?;
    sqlx::query("UPDATE activity_cursors SET max_seen_id = (SELECT COALESCE(MAX(id), 0) FROM activity)")
        .execute(&pool)
        .await?;
    sqlx::query(
        "UPDATE activity_cursors
         SET max_seen_id = MAX(0, (SELECT COALESCE(MAX(id), 0) FROM activity) - 15)
         WHERE viewer_user_id = ?",
    )
    .bind(coach_id)
    .execute(&pool)
    .await?;
    reporter.phase_item(ItemOutcome::Created);
    reporter.phase_finished();

    reporter.seed_finished();
    Ok(())
}
