//! On-demand seed for local development.
//!
//! Run against the file-backed sqlite.db with:
//!
//!     DATABASE_URL=sqlite://sqlite.db \
//!         cargo test --bin syllabus-tracker -- --ignored --nocapture seed_demo_data
//!
//! Idempotent: re-running won't duplicate users/techniques. All seed entities
//! use `demo_` username/tag prefixes so they're easy to identify and remove.

#[cfg(test)]
mod tests {
    use crate::auth::Role;
    use crate::db::{
        add_tag_to_technique, add_technique_to_collection, assign_technique_to_student,
        create_collection, create_tag, create_technique, create_user, find_user_by_username,
        get_tag_by_name,
    };
    use chrono::{Duration, Utc};
    use sqlx::SqlitePool;

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

    /// Distribution of (assigned_count, status_red_pct, status_amber_pct, days_since_coach_update)
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
    ) -> i64 {
        if let Some(existing) = find_user_by_username(pool, username).await.expect("lookup") {
            return existing.id;
        }
        create_user(pool, username, password, role.as_str(), Some(display_name))
            .await
            .expect("create_user")
    }

    async fn ensure_tag(pool: &SqlitePool, name: &str) -> i64 {
        if let Some(tag) = get_tag_by_name(pool, name).await.expect("tag lookup") {
            return tag.id;
        }
        create_tag(pool, name).await.expect("create tag")
    }

    async fn ensure_technique(
        pool: &SqlitePool,
        name: &str,
        description: &str,
        coach_id: i64,
        tag_ids: &[i64],
    ) -> i64 {
        // Idempotency: look up by name.
        let existing: Option<(i64,)> =
            sqlx::query_as("SELECT id FROM techniques WHERE name = ? LIMIT 1")
                .bind(name)
                .fetch_optional(pool)
                .await
                .expect("technique lookup");
        if let Some((id,)) = existing {
            return id;
        }
        let id = create_technique(pool, name, description, coach_id)
            .await
            .expect("create technique");
        for &tag_id in tag_ids {
            add_tag_to_technique(pool, id, tag_id)
                .await
                .expect("add tag");
        }
        id
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

    #[rocket::async_test]
    #[ignore = "Run on demand to seed local demo data. Requires DATABASE_URL pointing at a real sqlite file."]
    async fn seed_demo_data() {
        let url = std::env::var("DATABASE_URL")
            .unwrap_or_else(|_| "sqlite://sqlite.db".to_string());
        println!("Seeding demo data into {}", url);

        let pool = SqlitePool::connect(&url).await.expect("connect to db");

        // 1. Coach (Coach role so they can be assigned as the technique creator).
        let coach_id = ensure_user(
            &pool,
            "demo_coach",
            "password",
            Role::Coach,
            "Demo Coach",
        )
        .await;
        println!("  coach id = {}", coach_id);

        // 2. Tags
        let mut tag_ids: std::collections::HashMap<&str, i64> = std::collections::HashMap::new();
        for tag in [
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
        ] {
            let id = ensure_tag(&pool, tag).await;
            tag_ids.insert(tag, id);
        }

        // 3. Techniques (with tags)
        let mut technique_ids: Vec<i64> = Vec::with_capacity(TECHNIQUES.len());
        for (name, description, tags) in TECHNIQUES {
            let tids: Vec<i64> = tags
                .iter()
                .filter_map(|t| tag_ids.get(*t).copied())
                .collect();
            let id = ensure_technique(&pool, name, description, coach_id, &tids).await;
            technique_ids.push(id);
        }
        println!("  {} techniques ready", technique_ids.len());

        // 3.5 Collection: "Blue Belt Fundamentals" with the first ~12 techniques
        let blue_belt_id = {
            let existing: Option<(i64,)> =
                sqlx::query_as("SELECT id FROM collections WHERE name = ? LIMIT 1")
                    .bind("Blue Belt Fundamentals")
                    .fetch_optional(&pool)
                    .await
                    .expect("collection lookup");
            match existing {
                Some((id,)) => id,
                None => {
                    let id = create_collection(
                        &pool,
                        "Blue Belt Fundamentals",
                        "Core syllabus for blue belt students.",
                        coach_id,
                    )
                    .await
                    .expect("create collection");
                    for &tid in technique_ids.iter().take(12) {
                        add_technique_to_collection(&pool, id, tid)
                            .await
                            .expect("add to collection");
                    }
                    id
                }
            }
        };
        println!("  Blue Belt Fundamentals collection id = {}", blue_belt_id);

        // 4. Students
        let mut student_ids: Vec<i64> = Vec::with_capacity(STUDENT_NAMES.len());
        for (username, display_name) in STUDENT_NAMES {
            let id = ensure_user(&pool, username, "demo", Role::Student, display_name).await;
            student_ids.push(id);
        }
        println!("  {} students ready", student_ids.len());

        // 5. Assignments + status + timestamp backfill
        let now = Utc::now();
        for (i, &student_id) in student_ids.iter().enumerate() {
            let (count, red_pct, amber_pct, days_since_coach, has_new_activity) =
                STUDENT_PROFILES[i];
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
                let assignment_id =
                    assign_technique_to_student(&pool, technique_id, student_id, collection_id)
                        .await
                        .expect("assign technique");

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
                let st_student_time =
                    student_update_time.filter(|_| assigned_n == 0);

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
                .await
                .expect("backfill timestamps");
            }
        }

        println!("Seed complete.");
    }
}
