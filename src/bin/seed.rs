//! Idempotent demo seed. Inserts a coach, an admin, ~25 techniques, ~12
//! students, a "Blue Belt Fundamentals" collection, and a spread of
//! assignments + attempts so the UI has something to render. All seed
//! entities use `demo_` username/tag prefixes so they're easy to spot and
//! remove. Safe to re-run: existing rows are detected and left alone.
//!
//! Run with `just seed` (which runs `just migrate` first to ensure the
//! schema is in place).

use std::process::ExitCode;
use std::str::FromStr;

use anyhow::{Context, Result};
use chrono::{Duration, Utc};
use sqlx::SqlitePool;
use sqlx::sqlite::SqliteConnectOptions;
use syllabus_tracker::auth::Role;
use syllabus_tracker::db::{
    add_tag_to_technique, add_technique_to_collection, assign_technique_to_student,
    create_collection, create_tag, create_technique, create_user, find_user_by_username,
    get_tag_by_name,
};
use syllabus_tracker::env;
use syllabus_tracker::lib::seed::{ItemOutcome, SeedReporter, TerminalSeedReporter};

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

/// Distribution of (assigned_count, status_red_pct, status_amber_pct, days_since_coach_update, has_new_activity)
/// for each demo student. Tuples in the same order as STUDENT_NAMES.
const STUDENT_PROFILES: &[(usize, f64, f64, i64, bool)] = &[
    (20, 0.10, 0.30, 0, true),   // Alex — most progressed, freshly active, has new student activity
    (18, 0.20, 0.30, 1, false),  // Bianca — active yesterday
    (15, 0.25, 0.40, 3, true),   // Marcus — has new student activity since coach's last look
    (12, 0.30, 0.40, 5, false),  // Priya
    (10, 0.40, 0.30, 7, false),  // Diego
    (14, 0.30, 0.30, 10, true),  // Sarah — new activity
    (16, 0.25, 0.35, 14, false), // Hiroshi
    (8, 0.50, 0.25, 18, false),  // Maya
    (6, 0.60, 0.25, 21, false),  // Yusuf
    (4, 0.70, 0.20, 25, false),  // Camila — newer student
    (3, 0.80, 0.15, 30, false),  // Tobias — very new
    (0, 0.00, 0.00, 0, false),   // Aisha — just registered, no techniques yet
];

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
    let existing: Option<(i64,)> = sqlx::query_as("SELECT id FROM techniques WHERE name = ? LIMIT 1")
        .bind(name)
        .fetch_optional(pool)
        .await?;
    if let Some((id,)) = existing {
        return Ok((id, ItemOutcome::Existed));
    }
    let id = create_technique(pool, name, description, coach_id).await?;
    for &tag_id in tag_ids {
        add_tag_to_technique(pool, id, tag_id).await?;
    }
    Ok((id, ItemOutcome::Created))
}

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

    let url =
        std::env::var("DATABASE_URL").unwrap_or_else(|_| "sqlite://sqlite.db".to_string());
    println!("Seeding demo data into {}", url);

    let reporter = TerminalSeedReporter::new();
    let phases = [
        "Connecting to database",
        "Ensuring coach user",
        "Ensuring admin user",
        "Seeding tags",
        "Seeding techniques",
        "Seeding Blue Belt Fundamentals collection",
        "Seeding students",
        "Assigning techniques to students",
        "Generating attempts",
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

    // 1. Coach (Coach role so they can be assigned as the technique creator).
    reporter.phase_started(phases[1], Some(1));
    let (coach_id, outcome) =
        ensure_user(&pool, "demo_coach", "password", Role::Coach, "Demo Coach").await?;
    reporter.phase_item(outcome);
    reporter.phase_finished();

    reporter.phase_started(phases[2], Some(1));
    let (_admin_id, outcome) =
        ensure_user(&pool, "admin", "demo", Role::Admin, "Admin").await?;
    reporter.phase_item(outcome);
    reporter.phase_finished();

    // 2. Tags
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

    // 3. Techniques (with tags)
    reporter.phase_started(phases[4], Some(TECHNIQUES.len() as u64));
    let mut technique_ids: Vec<i64> = Vec::with_capacity(TECHNIQUES.len());
    for (name, description, tags) in TECHNIQUES {
        let tids: Vec<i64> = tags
            .iter()
            .filter_map(|t| tag_ids.get(*t).copied())
            .collect();
        let (id, outcome) = ensure_technique(&pool, name, description, coach_id, &tids).await?;
        technique_ids.push(id);
        reporter.phase_item(outcome);
    }
    reporter.phase_finished();

    // 3.5 Collection: "Blue Belt Fundamentals" with the first ~12 techniques
    reporter.phase_started(phases[5], Some(1));
    let (blue_belt_id, outcome) = {
        let existing: Option<(i64,)> =
            sqlx::query_as("SELECT id FROM collections WHERE name = ? LIMIT 1")
                .bind("Blue Belt Fundamentals")
                .fetch_optional(&pool)
                .await?;
        match existing {
            Some((id,)) => (id, ItemOutcome::Existed),
            None => {
                let id = create_collection(
                    &pool,
                    "Blue Belt Fundamentals",
                    "Core syllabus for blue belt students.",
                    coach_id,
                )
                .await?;
                for &tid in technique_ids.iter().take(12) {
                    add_technique_to_collection(&pool, id, tid).await?;
                }
                (id, ItemOutcome::Created)
            }
        }
    };
    reporter.phase_item(outcome);
    reporter.phase_finished();

    // 4. Students
    reporter.phase_started(phases[6], Some(STUDENT_NAMES.len() as u64));
    let mut student_ids: Vec<i64> = Vec::with_capacity(STUDENT_NAMES.len());
    for (username, display_name) in STUDENT_NAMES {
        let (id, outcome) =
            ensure_user(&pool, username, "demo", Role::Student, display_name).await?;
        student_ids.push(id);
        reporter.phase_item(outcome);
    }
    reporter.phase_finished();

    // 5. Assignments + status + timestamp backfill.
    // Use NaiveDateTime so sqlx encodes timestamps as "%F %T%.f" (the same
    // format `mark_seen` and `CURRENT_TIMESTAMP` use). Mixing in `DateTime<Utc>`
    // here would store RFC3339 strings with a 'T' separator and `+00:00`
    // suffix; the dashboard query then text-compares them against space-form
    // `seen_at` values and the unseen-activity flag gets stuck.
    let assignments_total: u64 = STUDENT_PROFILES.iter().map(|p| p.0 as u64).sum();
    reporter.phase_started(phases[7], Some(assignments_total));
    let now = Utc::now().naive_utc();
    for (i, &student_id) in student_ids.iter().enumerate() {
        let (count, red_pct, amber_pct, days_since_coach, has_new_activity) = STUDENT_PROFILES[i];
        if count == 0 {
            continue;
        }

        let technique_indices = pick_indices(technique_ids.len(), count, student_id as usize);

        let coach_update_time = now - Duration::days(days_since_coach);
        let student_update_time = if has_new_activity {
            Some(coach_update_time + Duration::hours(2 + (i as i64 % 12)))
        } else {
            None
        };

        // First 8 students are subscribed to Blue Belt Fundamentals.
        let on_blue_belt = i < 8;

        for (assigned_n, &tech_idx) in technique_indices.iter().enumerate() {
            let technique_id = technique_ids[tech_idx];
            // Techniques in the Blue Belt collection (indices 0-11) get
            // filed under it for subscribed students. Others are loose.
            let collection_id = if on_blue_belt && tech_idx < 12 {
                Some(blue_belt_id)
            } else {
                None
            };

            // Existence check up front so we can report Created vs Existed.
            // assign_technique_to_student is itself idempotent and returns the
            // existing id, so the call below is safe either way.
            let pre_existing: Option<(i64,)> = sqlx::query_as(
                "SELECT id FROM student_techniques WHERE student_id = ? AND technique_id = ? LIMIT 1",
            )
            .bind(student_id)
            .bind(technique_id)
            .fetch_optional(&pool)
            .await?;
            let outcome = if pre_existing.is_some() {
                ItemOutcome::Existed
            } else {
                ItemOutcome::Created
            };

            let assignment_id = assign_technique_to_student(
                &pool,
                technique_id,
                student_id,
                collection_id,
                coach_id,
            )
            .await?;

            // Status distribution
            let p = (assigned_n as f64) / (count as f64);
            let status = if p < red_pct {
                "red"
            } else if p < red_pct + amber_pct {
                "amber"
            } else {
                "green"
            };

            // Spread the coach update time over a few hours so techniques don't
            // all share an identical timestamp.
            let st_coach_time = coach_update_time - Duration::minutes(assigned_n as i64 * 7);

            // Pick a representative technique to flag with new student activity
            // (just the first one for each "active" student).
            let st_student_time = student_update_time.filter(|_| assigned_n == 0);

            let updated_at = st_student_time.unwrap_or(st_coach_time);

            sqlx::query(
                r#"UPDATE student_techniques
                   SET status = ?,
                       coach_notes = ?,
                       student_notes = ?,
                       updated_at = ?,
                       last_coach_update_at = ?,
                       last_coach_update_by_id = ?,
                       last_student_update_at = ?,
                       last_student_update_by_id = ?
                   WHERE id = ?"#,
            )
            .bind(status)
            .bind(match status {
                "green" => "Mastered. Move on to combinations.",
                "amber" => "Good progress. Drill the timing.",
                _ => "",
            })
            .bind(match status {
                "green" => "Feeling confident with this one.",
                "amber" => "",
                _ => "",
            })
            .bind(updated_at)
            .bind(st_coach_time)
            .bind(coach_id)
            .bind(st_student_time)
            .bind(st_student_time.map(|_| student_id))
            .bind(assignment_id)
            .execute(&pool)
            .await?;

            reporter.phase_item(outcome);
        }
    }
    reporter.phase_finished();

    // 6. Attempts. Spread across the last ~90 days so sparkline + heatmap
    // have something to draw. Skipped for any student_technique that
    // already has attempts so the seed remains idempotent.
    reporter.phase_started(phases[8], None);
    let student_notes = [
        "Felt smooth today.",
        "Need to drill the timing more.",
        "Coach said grip earlier next time.",
        "Hit it in sparring.",
        "Stalled on the setup, will revisit.",
        "Linked it to the previous transition.",
    ];
    let coach_notes = [
        "Clean execution.",
        "Watch the head position.",
        "Better than last week.",
        "Stay heavier on the chest.",
    ];

    for &student_id in &student_ids {
        let rows: Vec<(i64, String)> =
            sqlx::query_as("SELECT id, status FROM student_techniques WHERE student_id = ?")
                .bind(student_id)
                .fetch_all(&pool)
                .await?;

        for (idx, (st_id, status)) in rows.iter().enumerate() {
            let existing: (i64,) =
                sqlx::query_as("SELECT COUNT(*) FROM attempts WHERE student_technique_id = ?")
                    .bind(st_id)
                    .fetch_one(&pool)
                    .await?;
            if existing.0 > 0 {
                // Each pre-existing attempt counts toward the "existed" tally
                // so re-runs show the true attempt count, not the count of
                // student_techniques that happened to have attempts.
                for _ in 0..existing.0 {
                    reporter.phase_item(ItemOutcome::Existed);
                }
                continue;
            }

            // Status-driven distribution. The deterministic stride mixed
            // with the index keeps the spread different per technique.
            let target = match status.as_str() {
                "green" => 4 + ((student_id + *st_id) as usize % 5), // 4..=8
                "amber" => 1 + ((student_id + *st_id) as usize % 3), // 1..=3
                _ => {
                    if (student_id as usize + idx) % 6 == 0 {
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
                // Spread between roughly today and 90 days back, biased so
                // higher n means older.
                let days_back = ((n as i64 + 1) * 90 / target as i64).min(89);
                let hour_offset = ((*st_id + n as i64) % 12) - 6;
                let attempted_at =
                    now - Duration::days(days_back) + Duration::hours(hour_offset);

                // Alternate the recorder. Even iterations: student logged
                // it themselves. Odd: coach logged it for them.
                let recorder = if (n + idx) % 2 == 0 {
                    student_id
                } else {
                    coach_id
                };

                // ~33% of attempts get a note from whichever party logged
                // it. Sometimes both parties leave a note on the same
                // attempt, to exercise the dual-note display.
                let has_my_note = (*st_id as usize + n) % 3 == 0;
                let has_cross_note = (*st_id as usize + n) % 7 == 0;
                let student_note_text: Option<&str> = if recorder == student_id && has_my_note {
                    Some(student_notes[(*st_id as usize + n) % student_notes.len()])
                } else if recorder == coach_id && has_cross_note {
                    Some(student_notes[(*st_id as usize + n + 1) % student_notes.len()])
                } else {
                    None
                };
                let coach_note_text: Option<&str> = if recorder == coach_id && has_my_note {
                    Some(coach_notes[(*st_id as usize + n) % coach_notes.len()])
                } else if recorder == student_id && has_cross_note {
                    Some(coach_notes[(*st_id as usize + n + 1) % coach_notes.len()])
                } else {
                    None
                };

                let coach_note_by = coach_note_text.map(|_| coach_id);
                let coach_note_at = coach_note_text.map(|_| attempted_at);
                let student_note_at = student_note_text.map(|_| attempted_at);

                sqlx::query(
                    r#"INSERT INTO attempts (
                          student_technique_id, recorded_by_id, attempted_at,
                          coach_note, coach_note_by_id, coach_note_at,
                          student_note, student_note_at
                       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"#,
                )
                .bind(st_id)
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
    reporter.phase_finished();

    reporter.seed_finished();
    Ok(())
}
