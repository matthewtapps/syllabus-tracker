#[cfg(test)]
mod tests {
    use crate::db::{NewActivity, Verb, WatchEventInput, emit, ingest_watch_events, run_backfill};
    use crate::test::test_utils::TestDbBuilder;

    #[rocket::async_test]
    async fn emit_inserts_one_row() {
        let db = TestDbBuilder::new()
            .coach("coach", None)
            .student("alice", None)
            .build()
            .await
            .unwrap();
        let coach = db.user_id("coach").unwrap();
        let alice = db.user_id("alice").unwrap();

        let mut tx = db.pool.begin().await.unwrap();
        emit(
            &mut tx,
            NewActivity::new(Verb::SyllabusAssigned, coach).target_student(alice),
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();

        let row = sqlx::query!(
            r#"SELECT verb AS "verb!: String",
                      actor_user_id AS "actor_user_id!: i64",
                      target_student_id AS "target_student_id?: i64"
               FROM activity"#
        )
        .fetch_one(&db.pool)
        .await
        .unwrap();
        assert_eq!(row.verb, "syllabus_assigned");
        assert_eq!(row.actor_user_id, coach);
        assert_eq!(row.target_student_id, Some(alice));
    }

    #[rocket::async_test]
    async fn two_same_key_emits_within_window_coalesce_to_one_row() {
        let db = TestDbBuilder::new()
            .coach("coach", None)
            .student("alice", None)
            .technique("Armbar", "", Some("coach"))
            .build()
            .await
            .unwrap();
        let alice = db.user_id("alice").unwrap();
        let armbar = db.technique_id("Armbar").unwrap();

        for _ in 0..2 {
            let mut tx = db.pool.begin().await.unwrap();
            emit(
                &mut tx,
                NewActivity::new(Verb::TechniquePinned, alice)
                    .target_student(alice)
                    .technique(armbar),
            )
            .await
            .unwrap();
            tx.commit().await.unwrap();
        }

        let count = sqlx::query_scalar!(r#"SELECT COUNT(*) AS "c!: i64" FROM activity"#)
            .fetch_one(&db.pool)
            .await
            .unwrap();
        assert_eq!(count, 1, "same-key emits within 30s coalesce");
    }

    #[rocket::async_test]
    async fn different_target_does_not_coalesce() {
        let db = TestDbBuilder::new()
            .coach("coach", None)
            .student("alice", None)
            .student("bob", None)
            .technique("Armbar", "", Some("coach"))
            .build()
            .await
            .unwrap();
        let coach = db.user_id("coach").unwrap();
        let alice = db.user_id("alice").unwrap();
        let bob = db.user_id("bob").unwrap();
        let armbar = db.technique_id("Armbar").unwrap();

        for student in [alice, bob] {
            let mut tx = db.pool.begin().await.unwrap();
            emit(
                &mut tx,
                NewActivity::new(Verb::TechniqueEdited, coach)
                    .target_student(student)
                    .technique(armbar),
            )
            .await
            .unwrap();
            tx.commit().await.unwrap();
        }

        let count = sqlx::query_scalar!(r#"SELECT COUNT(*) AS "c!: i64" FROM activity"#)
            .fetch_one(&db.pool)
            .await
            .unwrap();
        assert_eq!(count, 2, "different target_student_id does not coalesce");
    }

    #[rocket::async_test]
    async fn status_change_coalesce_keeps_original_from_takes_latest_to() {
        use crate::db::payload;
        let db = TestDbBuilder::new()
            .coach("coach", None)
            .student("alice", None)
            .technique("Armbar", "", Some("coach"))
            .build()
            .await
            .unwrap();
        let alice = db.user_id("alice").unwrap();

        // Seed an SST to reference. Minimal direct insert: a syllabus + assignment + sst.
        let coach = db.user_id("coach").unwrap();
        let sid = crate::db::create_syllabus(&db.pool, "S", None, coach)
            .await
            .unwrap();
        let aid = crate::db::assign(&db.pool, coach, alice, sid)
            .await
            .unwrap();
        let armbar = db.technique_id("Armbar").unwrap();
        let sst_id = crate::db::add_technique_to_assignment(&db.pool, aid, armbar, coach)
            .await
            .unwrap();

        for (from, to) in [("red", "amber"), ("amber", "green")] {
            let mut tx = db.pool.begin().await.unwrap();
            emit(
                &mut tx,
                NewActivity::new(Verb::SstStatusChanged, alice)
                    .target_student(alice)
                    .sst(sst_id)
                    .payload(payload::status_changed(from, to)),
            )
            .await
            .unwrap();
            tx.commit().await.unwrap();
        }

        let row =
            sqlx::query!(r#"SELECT payload_json FROM activity WHERE verb = 'sst_status_changed'"#)
                .fetch_one(&db.pool)
                .await
                .unwrap();
        let v: serde_json::Value = serde_json::from_str(&row.payload_json.unwrap()).unwrap();
        assert_eq!(v["from"], "red", "keeps original from");
        assert_eq!(v["to"], "green", "takes latest to");
    }

    #[rocket::async_test]
    async fn fanout_writes_one_row_per_active_assignment_for_syllabus() {
        use crate::db::{affected_students_for_syllabus, emit_fanout};
        let db = TestDbBuilder::new()
            .coach("coach", None)
            .student("alice", None)
            .student("bob", None)
            .technique("Armbar", "", Some("coach"))
            .build()
            .await
            .unwrap();
        let coach = db.user_id("coach").unwrap();
        let alice = db.user_id("alice").unwrap();
        let bob = db.user_id("bob").unwrap();
        let armbar = db.technique_id("Armbar").unwrap();

        let sid = crate::db::create_syllabus(&db.pool, "S", None, coach)
            .await
            .unwrap();
        crate::db::add_technique_to_syllabus(
            &db.pool,
            sid,
            armbar,
            coach,
            crate::db::PropagationMode::SyllabusOnly,
        )
        .await
        .unwrap();
        crate::db::assign(&db.pool, coach, alice, sid)
            .await
            .unwrap();
        crate::db::assign(&db.pool, coach, bob, sid).await.unwrap();

        // Clear rows from setup (add_technique_to_syllabus and assigns now
        // emit activity rows themselves) so we can assert just the manual
        // emit_fanout call below.
        sqlx::query!("DELETE FROM activity")
            .execute(&db.pool)
            .await
            .unwrap();

        let mut tx = db.pool.begin().await.unwrap();
        let affected = affected_students_for_syllabus(&mut tx, sid).await.unwrap();
        emit_fanout(
            &mut tx,
            NewActivity::new(Verb::SyllabusTechniqueAdded, coach).syllabus(sid),
            &affected,
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();

        let rows = sqlx::query!(
            r#"SELECT target_student_id AS "t?: i64" FROM activity
               WHERE verb = 'syllabus_technique_added' ORDER BY target_student_id"#
        )
        .fetch_all(&db.pool)
        .await
        .unwrap();
        let targets: Vec<Option<i64>> = rows.into_iter().map(|r| r.t).collect();
        assert_eq!(targets, vec![Some(alice), Some(bob)]);
    }

    #[rocket::async_test]
    async fn fanout_empty_set_writes_one_coach_only_null_row() {
        use crate::db::emit_fanout;
        let db = TestDbBuilder::new()
            .coach("coach", None)
            .build()
            .await
            .unwrap();
        let coach = db.user_id("coach").unwrap();
        let sid = crate::db::create_syllabus(&db.pool, "Empty", None, coach)
            .await
            .unwrap();

        let mut tx = db.pool.begin().await.unwrap();
        emit_fanout(
            &mut tx,
            NewActivity::new(Verb::SyllabusTechniqueAdded, coach).syllabus(sid),
            &[],
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();

        let row = sqlx::query!(r#"SELECT target_student_id AS "t?: i64" FROM activity"#)
            .fetch_one(&db.pool)
            .await
            .unwrap();
        assert_eq!(row.t, None, "empty fan-out writes a single coach-only row");
    }

    #[rocket::async_test]
    async fn attempt_log_emits_attempt_logged() {
        use crate::auth::{Role, User};
        use chrono::Utc;

        let db = TestDbBuilder::new()
            .coach("coach", None)
            .student("alice", None)
            .technique("Armbar", "", Some("coach"))
            .build()
            .await
            .unwrap();
        let coach = db.user_id("coach").unwrap();
        let alice = db.user_id("alice").unwrap();
        let armbar = db.technique_id("Armbar").unwrap();

        let sid = crate::db::create_syllabus(&db.pool, "S", None, coach)
            .await
            .unwrap();
        let aid = crate::db::assign(&db.pool, coach, alice, sid)
            .await
            .unwrap();
        let sst_id = crate::db::add_technique_to_assignment(&db.pool, aid, armbar, coach)
            .await
            .unwrap();

        let actor = User {
            id: coach,
            username: "coach".into(),
            role: Role::Coach,
            display_name: "Coach".into(),
            archived: false,
            graduated_at: None,
            email: None,
            claimed_at: None,
            approved_at: None,
            first_name: None,
            last_name: None,
            reset_requested_at: None,
            last_update: None,
            last_coach_update_at: None,
            total_techniques: None,
            red_count: None,
            amber_count: None,
            green_count: None,
            has_unseen_activity: None,
            last_student_initiative_at: None,
            last_watch_at: None,
            last_watch_video_title: None,
            last_student_activity_at: None,
            last_coach_activity_at: None,
        };
        let attempt_id = crate::db::create_syllabus_attempt(
            &db.pool,
            &actor,
            sst_id,
            &crate::db::CreateSyllabusAttempt {
                attempted_at: Utc::now().naive_utc(),
                coach_note: None,
                student_note: None,
            },
        )
        .await
        .unwrap();

        let row = sqlx::query!(
            r#"SELECT verb AS "v!: String",
                      actor_user_id AS "a!: i64",
                      target_student_id AS "t?: i64",
                      sst_id AS "sst?: i64",
                      technique_id AS "tech?: i64",
                      syllabus_id AS "syl?: i64",
                      payload_json AS "p?"
               FROM activity
               WHERE verb = 'attempt_logged'"#
        )
        .fetch_one(&db.pool)
        .await
        .unwrap();
        assert_eq!(row.v, "attempt_logged");
        assert_eq!(row.a, coach);
        assert_eq!(row.t, Some(alice));
        assert_eq!(row.sst, Some(sst_id));
        assert_eq!(row.tech, Some(armbar));
        assert_eq!(row.syl, Some(sid));
        let payload: serde_json::Value = serde_json::from_str(&row.p.unwrap()).unwrap();
        assert_eq!(payload["attempt_id"], attempt_id);
    }

    #[rocket::async_test]
    async fn pin_emits_technique_pinned() {
        let db = TestDbBuilder::new()
            .coach("coach", None)
            .student("alice", None)
            .technique("Armbar", "", Some("coach"))
            .build()
            .await
            .unwrap();
        let alice = db.user_id("alice").unwrap();
        let armbar = db.technique_id("Armbar").unwrap();

        crate::db::pin_technique(&db.pool, alice, armbar)
            .await
            .unwrap();

        let row = sqlx::query!(
            r#"SELECT verb AS "v!: String", actor_user_id AS "a!: i64",
                      target_student_id AS "t?: i64", technique_id AS "tech?: i64"
               FROM activity"#
        )
        .fetch_one(&db.pool)
        .await
        .unwrap();
        assert_eq!(row.v, "technique_pinned");
        assert_eq!(row.a, alice);
        assert_eq!(row.t, Some(alice));
        assert_eq!(row.tech, Some(armbar));
    }

    #[rocket::async_test]
    async fn global_hide_fans_out_visibility_set() {
        let db = TestDbBuilder::new()
            .coach("coach", None)
            .student("alice", None)
            .student("bob", None)
            .technique("Armbar", "", Some("coach"))
            .build()
            .await
            .unwrap();
        let coach = db.user_id("coach").unwrap();
        let alice = db.user_id("alice").unwrap();
        let bob = db.user_id("bob").unwrap();
        let armbar = db.technique_id("Armbar").unwrap();

        // alice has the technique via an assigned syllabus
        let sid = crate::db::create_syllabus(&db.pool, "S", None, coach)
            .await
            .unwrap();
        let aid = crate::db::assign(&db.pool, coach, alice, sid)
            .await
            .unwrap();
        crate::db::add_technique_to_assignment(&db.pool, aid, armbar, coach)
            .await
            .unwrap();

        // bob has it pinned
        crate::db::pin_technique(&db.pool, bob, armbar)
            .await
            .unwrap();

        // Seed a video directly (bypass create helpers to avoid extra activity)
        let video_id: i64 = sqlx::query_scalar!(
            r#"INSERT INTO videos (technique_id, title, position, kind, processing_status, uploaded_by_id)
               VALUES (?, 'Test', 0, 'external', 'ready', ?)
               RETURNING id AS "id!: i64""#,
            armbar,
            coach,
        )
        .fetch_one(&db.pool)
        .await
        .unwrap();

        // Clear setup activity
        sqlx::query!("DELETE FROM activity")
            .execute(&db.pool)
            .await
            .unwrap();

        crate::db::set_video_hidden_globally(&db.pool, video_id, true, coach)
            .await
            .unwrap();

        let rows = sqlx::query!(
            r#"SELECT target_student_id AS "t?: i64", payload_json AS "p?"
               FROM activity WHERE verb = 'video_visibility_set'
               ORDER BY target_student_id NULLS LAST"#
        )
        .fetch_all(&db.pool)
        .await
        .unwrap();
        assert_eq!(rows.len(), 2, "one row per affected student");
        for row in &rows {
            let payload: serde_json::Value =
                serde_json::from_str(row.p.as_deref().unwrap()).unwrap();
            assert_eq!(payload["scope"], "global");
            assert_eq!(payload["visible"], false);
        }
        let targets: Vec<Option<i64>> = rows.into_iter().map(|r| r.t).collect();
        assert_eq!(targets, vec![Some(alice), Some(bob)]);
    }

    #[rocket::async_test]
    async fn update_sst_status_emits_status_changed_with_from_to() {
        use crate::auth::{Role, User};
        use crate::db::SstUpdate;

        let db = TestDbBuilder::new()
            .coach("coach", None)
            .student("alice", None)
            .technique("Armbar", "", Some("coach"))
            .build()
            .await
            .unwrap();
        let coach = db.user_id("coach").unwrap();
        let alice = db.user_id("alice").unwrap();
        let armbar = db.technique_id("Armbar").unwrap();

        let sid = crate::db::create_syllabus(&db.pool, "S", None, coach)
            .await
            .unwrap();
        let aid = crate::db::assign(&db.pool, coach, alice, sid)
            .await
            .unwrap();
        let sst_id = crate::db::add_technique_to_assignment(&db.pool, aid, armbar, coach)
            .await
            .unwrap();

        // Clear activity rows from setup so we have a clean slate.
        sqlx::query!("DELETE FROM activity")
            .execute(&db.pool)
            .await
            .unwrap();

        let actor = User {
            id: alice,
            username: "alice".into(),
            role: Role::Student,
            display_name: "Alice".into(),
            archived: false,
            graduated_at: None,
            email: None,
            claimed_at: None,
            approved_at: None,
            first_name: None,
            last_name: None,
            reset_requested_at: None,
            last_update: None,
            last_coach_update_at: None,
            total_techniques: None,
            red_count: None,
            amber_count: None,
            green_count: None,
            has_unseen_activity: None,
            last_student_initiative_at: None,
            last_watch_at: None,
            last_watch_video_title: None,
            last_student_activity_at: None,
            last_coach_activity_at: None,
        };

        crate::db::update_sst(
            &db.pool,
            sst_id,
            &actor,
            &SstUpdate {
                status: Some("green".into()),
                student_notes: None,
                coach_notes: None,
            },
        )
        .await
        .unwrap();

        let row = sqlx::query!(
            r#"SELECT verb AS "v!: String",
                      payload_json AS "p?",
                      sst_id AS "sst?: i64",
                      technique_id AS "tech?: i64",
                      syllabus_id AS "syl?: i64",
                      target_student_id AS "t?: i64"
               FROM activity WHERE verb = 'sst_status_changed'"#
        )
        .fetch_one(&db.pool)
        .await
        .unwrap();
        assert_eq!(row.v, "sst_status_changed");
        assert_eq!(row.sst, Some(sst_id));
        assert_eq!(row.tech, Some(armbar));
        assert_eq!(row.syl, Some(sid));
        assert_eq!(row.t, Some(alice));
        let payload: serde_json::Value = serde_json::from_str(&row.p.unwrap()).unwrap();
        assert_eq!(payload["from"], "red");
        assert_eq!(payload["to"], "green");
    }

    #[rocket::async_test]
    async fn assign_emits_syllabus_assigned() {
        let db = TestDbBuilder::new()
            .coach("coach", None)
            .student("alice", None)
            .build()
            .await
            .unwrap();
        let coach = db.user_id("coach").unwrap();
        let alice = db.user_id("alice").unwrap();

        let sid = crate::db::create_syllabus(&db.pool, "S", None, coach)
            .await
            .unwrap();
        crate::db::assign(&db.pool, coach, alice, sid)
            .await
            .unwrap();

        let row = sqlx::query!(
            r#"SELECT verb AS "v!: String",
                      actor_user_id AS "a!: i64",
                      target_student_id AS "t?: i64",
                      syllabus_id AS "syl?: i64"
               FROM activity WHERE verb = 'syllabus_assigned'"#
        )
        .fetch_one(&db.pool)
        .await
        .unwrap();
        assert_eq!(row.v, "syllabus_assigned");
        assert_eq!(row.a, coach);
        assert_eq!(row.t, Some(alice));
        assert_eq!(row.syl, Some(sid));
    }

    #[rocket::async_test]
    async fn syllabus_technique_added_fans_out_to_active_assignments() {
        let db = TestDbBuilder::new()
            .coach("coach", None)
            .student("alice", None)
            .student("bob", None)
            .technique("Armbar", "", Some("coach"))
            .build()
            .await
            .unwrap();
        let coach = db.user_id("coach").unwrap();
        let alice = db.user_id("alice").unwrap();
        let bob = db.user_id("bob").unwrap();
        let armbar = db.technique_id("Armbar").unwrap();

        let sid = crate::db::create_syllabus(&db.pool, "S", None, coach)
            .await
            .unwrap();
        crate::db::assign(&db.pool, coach, alice, sid)
            .await
            .unwrap();
        crate::db::assign(&db.pool, coach, bob, sid).await.unwrap();

        // Clear activity rows from setup so we can count cleanly.
        sqlx::query!("DELETE FROM activity")
            .execute(&db.pool)
            .await
            .unwrap();

        crate::db::add_technique_to_syllabus(
            &db.pool,
            sid,
            armbar,
            coach,
            crate::db::PropagationMode::Cascade,
        )
        .await
        .unwrap();

        let rows = sqlx::query!(
            r#"SELECT target_student_id AS "t?: i64" FROM activity
               WHERE verb = 'syllabus_technique_added' ORDER BY target_student_id"#
        )
        .fetch_all(&db.pool)
        .await
        .unwrap();
        let targets: Vec<Option<i64>> = rows.into_iter().map(|r| r.t).collect();
        assert_eq!(targets, vec![Some(alice), Some(bob)]);
    }

    #[rocket::async_test]
    async fn video_added_fans_out_to_union_of_assigned_and_pinned() {
        let db = TestDbBuilder::new()
            .coach("coach", None)
            .student("alice", None)
            .student("bob", None)
            .technique("Armbar", "", Some("coach"))
            .build()
            .await
            .unwrap();
        let coach = db.user_id("coach").unwrap();
        let alice = db.user_id("alice").unwrap();
        let bob = db.user_id("bob").unwrap();
        let armbar = db.technique_id("Armbar").unwrap();

        // alice has the technique via an assigned syllabus
        let sid = crate::db::create_syllabus(&db.pool, "S", None, coach)
            .await
            .unwrap();
        let aid = crate::db::assign(&db.pool, coach, alice, sid)
            .await
            .unwrap();
        crate::db::add_technique_to_assignment(&db.pool, aid, armbar, coach)
            .await
            .unwrap();

        // bob has it pinned
        crate::db::pin_technique(&db.pool, bob, armbar)
            .await
            .unwrap();

        // Clear setup activity
        sqlx::query!("DELETE FROM activity")
            .execute(&db.pool)
            .await
            .unwrap();

        crate::db::create_processing_video(&db.pool, armbar, "Test Video", None, coach)
            .await
            .unwrap();

        let rows = sqlx::query!(
            r#"SELECT target_student_id AS "t?: i64"
               FROM activity WHERE verb = 'video_added'
               ORDER BY target_student_id NULLS LAST"#
        )
        .fetch_all(&db.pool)
        .await
        .unwrap();
        let targets: Vec<Option<i64>> = rows.into_iter().map(|r| r.t).collect();
        assert_eq!(targets, vec![Some(alice), Some(bob)]);
    }

    #[rocket::async_test]
    async fn video_added_empty_set_writes_null_target_row() {
        let db = TestDbBuilder::new()
            .coach("coach", None)
            .technique("Armbar", "", Some("coach"))
            .build()
            .await
            .unwrap();
        let coach = db.user_id("coach").unwrap();
        let armbar = db.technique_id("Armbar").unwrap();

        // Clear setup activity
        sqlx::query!("DELETE FROM activity")
            .execute(&db.pool)
            .await
            .unwrap();

        crate::db::create_external_video(
            &db.pool,
            crate::db::NewExternalVideo {
                technique_id: armbar,
                title: "External Test",
                description: None,
                uploaded_by_id: coach,
                kind: crate::models::VideoKind::Youtube,
                external_url: "https://youtu.be/dQw4w9WgXcQ",
                external_host: Some("youtube"),
                external_video_id: Some("dQw4w9WgXcQ"),
            },
        )
        .await
        .unwrap();

        let row = sqlx::query!(
            r#"SELECT target_student_id AS "t?: i64" FROM activity WHERE verb = 'video_added'"#
        )
        .fetch_one(&db.pool)
        .await
        .unwrap();
        assert_eq!(row.t, None, "empty fan-out writes a single null-target row");
    }

    #[rocket::async_test]
    async fn update_technique_emits_technique_edited_with_field_delta() {
        let db = TestDbBuilder::new()
            .coach("coach", None)
            .student("alice", None)
            .technique("Armbar", "Original desc", Some("coach"))
            .build()
            .await
            .unwrap();
        let coach = db.user_id("coach").unwrap();
        let alice = db.user_id("alice").unwrap();
        let armbar = db.technique_id("Armbar").unwrap();

        // alice has the technique pinned so she is in the affected set.
        crate::db::pin_technique(&db.pool, alice, armbar)
            .await
            .unwrap();

        // Clear setup activity rows.
        sqlx::query!("DELETE FROM activity")
            .execute(&db.pool)
            .await
            .unwrap();

        // Rename the technique.
        crate::db::update_technique(&db.pool, armbar, "Armbar Renamed", "Original desc", coach)
            .await
            .unwrap();

        let row = sqlx::query!(
            r#"SELECT target_student_id AS "t?: i64",
                      payload_json AS "p?",
                      actor_user_id AS "a!: i64"
               FROM activity WHERE verb = 'technique_edited'"#
        )
        .fetch_one(&db.pool)
        .await
        .unwrap();
        assert_eq!(row.t, Some(alice), "row targets the pinned student");
        assert_eq!(row.a, coach);
        let payload: serde_json::Value = serde_json::from_str(&row.p.unwrap()).unwrap();
        assert_eq!(
            payload["fields"]["name"],
            serde_json::json!(true),
            "name flag set"
        );
        assert!(
            payload["fields"].get("description").is_none()
                || payload["fields"]["description"] == serde_json::json!(false),
            "description flag not set for unchanged description"
        );
    }

    #[rocket::async_test]
    async fn crossing_watch_threshold_emits_video_watched_once() {
        let db = TestDbBuilder::new()
            .coach("coach", None)
            .student("alice", None)
            .technique("Armbar", "", Some("coach"))
            .build()
            .await
            .unwrap();
        let coach = db.user_id("coach").unwrap();
        let alice = db.user_id("alice").unwrap();
        let armbar = db.technique_id("Armbar").unwrap();

        // Insert a video with a known duration (50s, threshold = min(10, ceil(50*0.2)) = 10).
        let video_id: i64 = sqlx::query_scalar!(
            r#"INSERT INTO videos (technique_id, title, position, kind, processing_status,
                                   uploaded_by_id, duration_seconds)
               VALUES (?, 'Test', 0, 'external', 'ready', ?, 50)
               RETURNING id AS "id!: i64""#,
            armbar,
            coach,
        )
        .fetch_one(&db.pool)
        .await
        .unwrap();

        // First batch: 5 seconds - below threshold of 10, no emit.
        ingest_watch_events(
            &db.pool,
            video_id,
            alice,
            "play-1",
            &[
                WatchEventInput {
                    event: "started".into(),
                    seconds_watched: None,
                },
                WatchEventInput {
                    event: "progress".into(),
                    seconds_watched: Some(5),
                },
            ],
        )
        .await
        .unwrap();

        let count_before = sqlx::query_scalar!(
            r#"SELECT COUNT(*) AS "c!: i64" FROM activity WHERE verb = 'video_watched'"#
        )
        .fetch_one(&db.pool)
        .await
        .unwrap();
        assert_eq!(count_before, 0, "no emit below threshold");

        // Second batch: 12 seconds - crosses threshold of 10.
        ingest_watch_events(
            &db.pool,
            video_id,
            alice,
            "play-1",
            &[WatchEventInput {
                event: "progress".into(),
                seconds_watched: Some(12),
            }],
        )
        .await
        .unwrap();

        let count_after = sqlx::query_scalar!(
            r#"SELECT COUNT(*) AS "c!: i64" FROM activity WHERE verb = 'video_watched'"#
        )
        .fetch_one(&db.pool)
        .await
        .unwrap();
        assert_eq!(
            count_after, 1,
            "one video_watched row after crossing threshold"
        );

        // Third batch: more seconds - already crossed, no new row (coalesces or no-emit).
        ingest_watch_events(
            &db.pool,
            video_id,
            alice,
            "play-1",
            &[WatchEventInput {
                event: "progress".into(),
                seconds_watched: Some(20),
            }],
        )
        .await
        .unwrap();

        let count_final = sqlx::query_scalar!(
            r#"SELECT COUNT(*) AS "c!: i64" FROM activity WHERE verb = 'video_watched'"#
        )
        .fetch_one(&db.pool)
        .await
        .unwrap();
        assert_eq!(
            count_final, 1,
            "still one row after further progress (coalesced or already crossed)"
        );
    }

    #[rocket::async_test]
    async fn backfill_is_idempotent_and_seeds_expected_counts() {
        use crate::auth::{Role, User};
        use chrono::Utc;

        let db = TestDbBuilder::new()
            .coach("coach", None)
            .student("alice", None)
            .technique("Armbar", "", Some("coach"))
            .build()
            .await
            .unwrap();
        let coach = db.user_id("coach").unwrap();
        let alice = db.user_id("alice").unwrap();
        let armbar = db.technique_id("Armbar").unwrap();

        // Seed one assignment (emits syllabus_assigned).
        let sid = crate::db::create_syllabus(&db.pool, "S", None, coach)
            .await
            .unwrap();
        let aid = crate::db::assign(&db.pool, coach, alice, sid)
            .await
            .unwrap();

        // Seed one attempt (emits attempt_logged).
        let sst_id = crate::db::add_technique_to_assignment(&db.pool, aid, armbar, coach)
            .await
            .unwrap();
        let actor = User {
            id: coach,
            username: "coach".into(),
            role: Role::Coach,
            display_name: "Coach".into(),
            archived: false,
            graduated_at: None,
            email: None,
            claimed_at: None,
            approved_at: None,
            first_name: None,
            last_name: None,
            reset_requested_at: None,
            last_update: None,
            last_coach_update_at: None,
            total_techniques: None,
            red_count: None,
            amber_count: None,
            green_count: None,
            has_unseen_activity: None,
            last_student_initiative_at: None,
            last_watch_at: None,
            last_watch_video_title: None,
            last_student_activity_at: None,
            last_coach_activity_at: None,
        };
        crate::db::create_syllabus_attempt(
            &db.pool,
            &actor,
            sst_id,
            &crate::db::CreateSyllabusAttempt {
                attempted_at: Utc::now().naive_utc(),
                coach_note: None,
                student_note: None,
            },
        )
        .await
        .unwrap();

        // Seed one pin (emits technique_pinned).
        crate::db::pin_technique(&db.pool, alice, armbar)
            .await
            .unwrap();

        // Clear all activity rows emitted by the setup helpers.
        sqlx::query!("DELETE FROM activity")
            .execute(&db.pool)
            .await
            .unwrap();

        // First call: runs the backfill.
        let counts = run_backfill(&db.pool).await.unwrap();
        assert_eq!(counts.attempts, 1, "one attempt backfilled");
        assert_eq!(counts.assignments, 1, "one assignment backfilled");
        assert_eq!(counts.pins, 1, "one pin backfilled");

        let total: i64 = sqlx::query_scalar!(r#"SELECT COUNT(*) AS "c!: i64" FROM activity"#)
            .fetch_one(&db.pool)
            .await
            .unwrap();
        assert!(total >= 3, "activity table has rows after backfill");

        // Second call: no-op because activity table is now non-empty.
        let counts2 = run_backfill(&db.pool).await.unwrap();
        assert_eq!(counts2.attempts, 0, "second run is a no-op");
        assert_eq!(counts2.assignments, 0, "second run is a no-op");
        assert_eq!(counts2.pins, 0, "second run is a no-op");

        let total2: i64 = sqlx::query_scalar!(r#"SELECT COUNT(*) AS "c!: i64" FROM activity"#)
            .fetch_one(&db.pool)
            .await
            .unwrap();
        assert_eq!(total2, total, "row count unchanged on second run");
    }

    #[rocket::async_test]
    async fn update_sst_multiple_fields_emits_one_row_per_field() {
        use crate::auth::{Role, User};
        use crate::db::SstUpdate;

        let db = TestDbBuilder::new()
            .coach("coach", None)
            .student("alice", None)
            .technique("Armbar", "", Some("coach"))
            .build()
            .await
            .unwrap();
        let coach = db.user_id("coach").unwrap();
        let alice = db.user_id("alice").unwrap();
        let armbar = db.technique_id("Armbar").unwrap();

        let sid = crate::db::create_syllabus(&db.pool, "S", None, coach)
            .await
            .unwrap();
        let aid = crate::db::assign(&db.pool, coach, alice, sid)
            .await
            .unwrap();
        let sst_id = crate::db::add_technique_to_assignment(&db.pool, aid, armbar, coach)
            .await
            .unwrap();

        // Clear activity rows from setup.
        sqlx::query!("DELETE FROM activity")
            .execute(&db.pool)
            .await
            .unwrap();

        let actor = User {
            id: alice,
            username: "alice".into(),
            role: Role::Student,
            display_name: "Alice".into(),
            archived: false,
            graduated_at: None,
            email: None,
            claimed_at: None,
            approved_at: None,
            first_name: None,
            last_name: None,
            reset_requested_at: None,
            last_update: None,
            last_coach_update_at: None,
            total_techniques: None,
            red_count: None,
            amber_count: None,
            green_count: None,
            has_unseen_activity: None,
            last_student_initiative_at: None,
            last_watch_at: None,
            last_watch_video_title: None,
            last_student_activity_at: None,
            last_coach_activity_at: None,
        };

        crate::db::update_sst(
            &db.pool,
            sst_id,
            &actor,
            &SstUpdate {
                status: Some("amber".into()),
                student_notes: Some("working on it".into()),
                coach_notes: None,
            },
        )
        .await
        .unwrap();

        let rows = sqlx::query!(r#"SELECT verb AS "v!: String" FROM activity ORDER BY verb"#)
            .fetch_all(&db.pool)
            .await
            .unwrap();
        let verbs: Vec<String> = rows.into_iter().map(|r| r.v).collect();
        assert_eq!(
            verbs,
            vec!["sst_status_changed", "sst_student_notes_edited"],
            "exactly two rows: one per present field"
        );
        let _ = sst_id;
    }
}
