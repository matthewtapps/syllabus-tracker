#[cfg(test)]
mod tests {
    use crate::auth::Role;
    use crate::db::{
        NewActivity, Verb, advance_cursor_to, current_max_seen, emit, feed, feed_max_id,
        mark_one_read, mark_one_unread, notifies, unread_count,
    };
    use crate::test::test_utils::TestDbBuilder;

    #[test]
    fn own_action_never_notifies() {
        // actor == viewer => false even for a notifiable verb in the feed.
        assert!(!notifies(Verb::AttemptLogged.as_str(), 5, 5, true));
    }

    #[test]
    fn non_notifiable_verb_never_notifies() {
        assert!(!notifies(Verb::AttemptDeleted.as_str(), 9, 5, true));
    }

    #[test]
    fn notifiable_other_actor_in_feed_notifies() {
        assert!(notifies(Verb::AttemptLogged.as_str(), 9, 5, true));
    }

    #[test]
    fn not_in_feed_never_notifies() {
        assert!(!notifies(Verb::AttemptLogged.as_str(), 9, 5, false));
    }

    #[rocket::async_test]
    async fn cursor_advance_on_view_sets_max_seen_to_snapshot_top_id() {
        let db = TestDbBuilder::new()
            .coach("coach", None)
            .student("alice", None)
            .build()
            .await
            .unwrap();
        let coach = db.user_id("coach").unwrap();
        let alice = db.user_id("alice").unwrap();

        // Emit rows targeting alice. No entity FK so no setup needed.
        let mut tx = db.pool.begin().await.unwrap();
        emit(
            &mut tx,
            NewActivity::new(Verb::SyllabusAssigned, coach).target_student(alice),
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();

        let mut tx = db.pool.begin().await.unwrap();
        emit(
            &mut tx,
            NewActivity::new(Verb::SyllabusGraduated, coach).target_student(alice),
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();

        // Snapshot the feed max id (student: target_student_id = alice).
        let top_id = feed_max_id(&db.pool, alice, Role::Student).await.unwrap();
        assert!(top_id > 0, "feed_max_id should be positive");

        // Advance the cursor.
        advance_cursor_to(&db.pool, alice, top_id).await.unwrap();

        // Verify activity_cursors row.
        let max_seen = current_max_seen(&db.pool, alice).await.unwrap();
        assert_eq!(max_seen, top_id);
    }

    #[rocket::async_test]
    async fn orphaned_video_activity_is_hidden_from_feed() {
        use crate::db::{create_processing_video, delete_video};

        let db = TestDbBuilder::new()
            .coach("coach", None)
            .student("alice", None)
            .technique("Armbar", "arm lock", Some("coach"))
            .build()
            .await
            .unwrap();
        let coach = db.user_id("coach").unwrap();
        let alice = db.user_id("alice").unwrap();
        let tech = db.technique_id("Armbar").unwrap();

        // A real video on the technique, plus a watch activity targeting alice.
        let video_id = create_processing_video(&db.pool, tech, "Armbar detail", None, coach)
            .await
            .unwrap();
        let mut tx = db.pool.begin().await.unwrap();
        emit(
            &mut tx,
            NewActivity::new(Verb::VideoWatched, alice)
                .target_student(alice)
                .technique(tech)
                .video(video_id),
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();

        // While the video exists, the watch row is in the feed with its title.
        let before = feed(&db.pool, alice, Role::Student, None, 50).await.unwrap();
        let watched = before
            .iter()
            .find(|r| r.video_id == Some(video_id))
            .expect("watch row present while the video exists");
        assert_eq!(watched.video_title.as_deref(), Some("Armbar detail"));

        // Soft-delete the video: its activity row must drop out of the feed
        // rather than render as a dead "watched a video" line.
        assert!(delete_video(&db.pool, video_id).await.unwrap());
        let after = feed(&db.pool, alice, Role::Student, None, 50).await.unwrap();
        assert!(
            !after.iter().any(|r| r.video_id == Some(video_id)),
            "orphaned video activity must be hidden once the video is deleted"
        );
    }

    #[rocket::async_test]
    async fn mark_one_read_keeps_older_unread() {
        let db = TestDbBuilder::new()
            .coach("coach", None)
            .student("alice", None)
            .build()
            .await
            .unwrap();
        let coach = db.user_id("coach").unwrap();
        let alice = db.user_id("alice").unwrap();

        // Emit two rows targeting alice with different verbs (avoid coalescing).
        let mut tx = db.pool.begin().await.unwrap();
        emit(
            &mut tx,
            NewActivity::new(Verb::SyllabusAssigned, coach).target_student(alice),
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();

        let id1 = sqlx::query_scalar!(r#"SELECT MAX(id) AS "id!: i64" FROM activity"#)
            .fetch_one(&db.pool)
            .await
            .unwrap();

        let mut tx = db.pool.begin().await.unwrap();
        emit(
            &mut tx,
            NewActivity::new(Verb::SyllabusGraduated, coach).target_student(alice),
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();

        let id2 = sqlx::query_scalar!(r#"SELECT MAX(id) AS "id!: i64" FROM activity"#)
            .fetch_one(&db.pool)
            .await
            .unwrap();

        assert!(id2 > id1, "two distinct activity rows expected");

        // Mark only the second row read via override.
        mark_one_read(&db.pool, alice, id2).await.unwrap();

        // id1 should still have no override (remains unread).
        let override_count = sqlx::query_scalar!(
            r#"SELECT COUNT(*) AS "c!: i64" FROM activity_seen_overrides
               WHERE viewer_user_id = ? AND activity_id = ?"#,
            alice,
            id1
        )
        .fetch_one(&db.pool)
        .await
        .unwrap();
        assert_eq!(override_count, 0, "id1 should have no override");

        // id2 should have a seen=1 override.
        let seen = sqlx::query_scalar!(
            r#"SELECT seen AS "s!: bool" FROM activity_seen_overrides
               WHERE viewer_user_id = ? AND activity_id = ?"#,
            alice,
            id2
        )
        .fetch_one(&db.pool)
        .await
        .unwrap();
        assert!(seen, "id2 should be marked seen=1");
    }

    #[rocket::async_test]
    async fn mark_one_unread_on_below_cursor_row_makes_it_unread() {
        let db = TestDbBuilder::new()
            .coach("coach", None)
            .student("alice", None)
            .build()
            .await
            .unwrap();
        let coach = db.user_id("coach").unwrap();
        let alice = db.user_id("alice").unwrap();

        // Emit a row targeting alice.
        let mut tx = db.pool.begin().await.unwrap();
        emit(
            &mut tx,
            NewActivity::new(Verb::SyllabusAssigned, coach).target_student(alice),
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();

        let act_id = sqlx::query_scalar!(r#"SELECT MAX(id) AS "id!: i64" FROM activity"#)
            .fetch_one(&db.pool)
            .await
            .unwrap();

        // Advance cursor past the row (marks it as "seen by cursor").
        advance_cursor_to(&db.pool, alice, act_id).await.unwrap();

        let max_seen = current_max_seen(&db.pool, alice).await.unwrap();
        assert_eq!(max_seen, act_id);

        // Now mark it unread: since id <= cursor, this must write a seen=0 override.
        mark_one_unread(&db.pool, alice, act_id).await.unwrap();

        let seen_val = sqlx::query_scalar!(
            r#"SELECT seen AS "s!: bool" FROM activity_seen_overrides
               WHERE viewer_user_id = ? AND activity_id = ?"#,
            alice,
            act_id
        )
        .fetch_one(&db.pool)
        .await
        .unwrap();
        assert!(!seen_val, "override should be seen=0 (unread)");
    }

    #[rocket::async_test]
    async fn gc_deletes_redundant_seen1_overrides_keeps_seen0() {
        let db = TestDbBuilder::new()
            .coach("coach", None)
            .student("alice", None)
            .build()
            .await
            .unwrap();
        let coach = db.user_id("coach").unwrap();
        let alice = db.user_id("alice").unwrap();

        // Emit two rows.
        let mut tx = db.pool.begin().await.unwrap();
        emit(
            &mut tx,
            NewActivity::new(Verb::SyllabusAssigned, coach).target_student(alice),
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();

        let id1 = sqlx::query_scalar!(r#"SELECT MAX(id) AS "id!: i64" FROM activity"#)
            .fetch_one(&db.pool)
            .await
            .unwrap();

        let mut tx = db.pool.begin().await.unwrap();
        emit(
            &mut tx,
            NewActivity::new(Verb::SyllabusGraduated, coach).target_student(alice),
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();

        let id2 = sqlx::query_scalar!(r#"SELECT MAX(id) AS "id!: i64" FROM activity"#)
            .fetch_one(&db.pool)
            .await
            .unwrap();

        // Mark id1 seen (seen=1 override) and id2 unread via seen=0 override.
        mark_one_read(&db.pool, alice, id1).await.unwrap();
        // Manually insert a seen=0 override for id2 to simulate a user marking it unread
        // before any cursor advance.
        sqlx::query!(
            "INSERT OR REPLACE INTO activity_seen_overrides (viewer_user_id, activity_id, seen)
             VALUES (?, ?, 0)",
            alice,
            id2
        )
        .execute(&db.pool)
        .await
        .unwrap();

        // Advance cursor to id1: GC should delete the seen=1 override for id1
        // but keep the seen=0 override for id2.
        advance_cursor_to(&db.pool, alice, id1).await.unwrap();

        // seen=1 override for id1 should be GC'd (redundant: id1 <= cursor).
        let id1_override = sqlx::query_scalar!(
            r#"SELECT COUNT(*) AS "c!: i64" FROM activity_seen_overrides
               WHERE viewer_user_id = ? AND activity_id = ?"#,
            alice,
            id1
        )
        .fetch_one(&db.pool)
        .await
        .unwrap();
        assert_eq!(
            id1_override, 0,
            "seen=1 override at/below cursor should be GC'd"
        );

        // seen=0 override for id2 should remain (id2 > cursor, so it's above the cursor boundary).
        let id2_override = sqlx::query_scalar!(
            r#"SELECT COUNT(*) AS "c!: i64" FROM activity_seen_overrides
               WHERE viewer_user_id = ? AND activity_id = ?"#,
            alice,
            id2
        )
        .fetch_one(&db.pool)
        .await
        .unwrap();
        assert_eq!(
            id2_override, 1,
            "seen=0 override above cursor should be kept"
        );
    }

    #[rocket::async_test]
    async fn mark_one_unread_above_cursor_is_noop() {
        let db = TestDbBuilder::new()
            .coach("coach", None)
            .student("alice", None)
            .build()
            .await
            .unwrap();
        let coach = db.user_id("coach").unwrap();
        let alice = db.user_id("alice").unwrap();

        // Emit a row.
        let mut tx = db.pool.begin().await.unwrap();
        emit(
            &mut tx,
            NewActivity::new(Verb::SyllabusAssigned, coach).target_student(alice),
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();

        let act_id = sqlx::query_scalar!(r#"SELECT MAX(id) AS "id!: i64" FROM activity"#)
            .fetch_one(&db.pool)
            .await
            .unwrap();

        // No cursor advance: cursor is 0, act_id > 0, so act_id > cursor => already unread.
        // mark_one_unread should be a no-op (no override row written).
        mark_one_unread(&db.pool, alice, act_id).await.unwrap();

        let override_count = sqlx::query_scalar!(
            r#"SELECT COUNT(*) AS "c!: i64" FROM activity_seen_overrides
               WHERE viewer_user_id = ? AND activity_id = ?"#,
            alice,
            act_id
        )
        .fetch_one(&db.pool)
        .await
        .unwrap();
        assert_eq!(
            override_count, 0,
            "no override should be written when row is already unread"
        );
    }

    // Task 21 tests

    /// Own actions and non-notifiable verbs are excluded from unread_count but
    /// still appear in the feed.
    #[rocket::async_test]
    async fn notifies_excludes_own_and_non_notifiable_from_count_but_feed_lists_them() {
        let db = TestDbBuilder::new()
            .coach("coach", None)
            .student("alice", None)
            .build()
            .await
            .unwrap();
        let coach = db.user_id("coach").unwrap();
        let alice = db.user_id("alice").unwrap();

        // alice performs a non-notifiable action targeting herself.
        let mut tx = db.pool.begin().await.unwrap();
        emit(
            &mut tx,
            NewActivity::new(Verb::AttemptDeleted, alice).target_student(alice),
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();

        // coach performs a notifiable action targeting alice.
        let mut tx = db.pool.begin().await.unwrap();
        emit(
            &mut tx,
            NewActivity::new(Verb::SyllabusAssigned, coach).target_student(alice),
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();

        // alice's feed (student role) should include both rows.
        let rows = feed(&db.pool, alice, Role::Student, None, 50)
            .await
            .unwrap();
        assert_eq!(rows.len(), 2, "both rows appear in alice's feed");

        // But unread_count must be 1: only the notifiable coach action counts.
        // alice's own action (actor == viewer) and the non-notifiable verb both
        // exclude themselves.
        let count = unread_count(&db.pool, alice, Role::Student).await.unwrap();
        assert_eq!(count, 1, "only the notifiable coach row is unread");

        // Verify the notifiable row is flagged unread and the own/non-notifiable
        // row is not.
        let notifiable_row = rows.iter().find(|r| r.verb == "syllabus_assigned").unwrap();
        assert!(
            notifiable_row.unread,
            "syllabus_assigned by coach is unread"
        );

        let own_row = rows.iter().find(|r| r.verb == "attempt_deleted").unwrap();
        assert!(!own_row.unread, "own non-notifiable action is not unread");
    }

    /// Pages are stable and non-overlapping across keyset cursor boundaries.
    #[rocket::async_test]
    async fn keyset_pagination_returns_stable_non_overlapping_pages() {
        let db = TestDbBuilder::new()
            .coach("coach", None)
            .student("alice", None)
            .build()
            .await
            .unwrap();
        let coach = db.user_id("coach").unwrap();
        let alice = db.user_id("alice").unwrap();

        // Emit 5 rows targeting alice using distinct verbs to avoid coalescing.
        let verbs = [
            Verb::SyllabusAssigned,
            Verb::SyllabusGraduated,
            Verb::TechniquePinned,
            Verb::SstAdded,
            Verb::AttemptLogged,
        ];
        for verb in verbs {
            let mut tx = db.pool.begin().await.unwrap();
            emit(&mut tx, NewActivity::new(verb, coach).target_student(alice))
                .await
                .unwrap();
            tx.commit().await.unwrap();
        }

        // Page 1: limit 3, no before.
        let page1 = feed(&db.pool, alice, Role::Student, None, 3).await.unwrap();
        assert_eq!(page1.len(), 3, "page 1 has 3 rows");

        // Extract the keyset cursor from the last row of page 1.
        // SQLite stores timestamps with nanosecond precision; try with and
        // without fractional seconds.
        let last = page1.last().unwrap();
        let before_ts =
            chrono::NaiveDateTime::parse_from_str(&last.occurred_at, "%Y-%m-%d %H:%M:%S%.f")
                .or_else(|_| {
                    chrono::NaiveDateTime::parse_from_str(&last.occurred_at, "%Y-%m-%d %H:%M:%S")
                })
                .unwrap_or_else(|e| {
                    panic!("failed to parse occurred_at {:?}: {}", last.occurred_at, e)
                });
        let before_id = last.id;

        // Page 2: limit 3, before = last of page 1.
        let page2 = feed(
            &db.pool,
            alice,
            Role::Student,
            Some((before_ts, before_id)),
            3,
        )
        .await
        .unwrap();
        assert_eq!(page2.len(), 2, "page 2 has the remaining 2 rows");

        // No overlap: all ids in page2 must be absent from page1.
        let page1_ids: Vec<i64> = page1.iter().map(|r| r.id).collect();
        for row in &page2 {
            assert!(
                !page1_ids.contains(&row.id),
                "page 2 row {} overlaps with page 1",
                row.id
            );
        }

        // Combined ids must match the 5 inserted rows (order desc by id).
        let all_ids: Vec<i64> = page1.iter().chain(page2.iter()).map(|r| r.id).collect();
        assert_eq!(all_ids.len(), 5, "both pages cover all 5 rows");
        // Must be strictly descending.
        for w in all_ids.windows(2) {
            assert!(w[0] > w[1], "ids must be strictly descending across pages");
        }
    }

    /// Coach feed excludes the coach's own rows but includes rows by other actors.
    #[rocket::async_test]
    async fn coach_feed_excludes_own_rows_includes_other_actors() {
        let db = TestDbBuilder::new()
            .coach("coach", None)
            .student("alice", None)
            .build()
            .await
            .unwrap();
        let coach = db.user_id("coach").unwrap();
        let alice = db.user_id("alice").unwrap();

        // Coach emits a row (own action).
        let mut tx = db.pool.begin().await.unwrap();
        emit(
            &mut tx,
            NewActivity::new(Verb::SyllabusAssigned, coach).target_student(alice),
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();

        // Alice emits a row (other actor).
        let mut tx = db.pool.begin().await.unwrap();
        emit(
            &mut tx,
            NewActivity::new(Verb::TechniquePinned, alice).target_student(alice),
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();

        let rows = feed(&db.pool, coach, Role::Coach, None, 50).await.unwrap();

        // Only alice's row should appear in the coach feed.
        assert_eq!(rows.len(), 1, "coach feed excludes own rows");
        assert_eq!(
            rows[0].actor_user_id, alice,
            "the visible row is alice's action"
        );
        assert_eq!(rows[0].verb, "technique_pinned");
    }

    // Task 22 tests

    /// Seeding cursors marks all pre-existing activity as seen for every user,
    /// and a second run is a no-op (idempotent).
    #[rocket::async_test]
    async fn cursor_init_seeds_existing_users_to_current_max_and_is_idempotent() {
        use crate::db::run_cursor_init;

        let db = TestDbBuilder::new()
            .coach("coach", None)
            .student("alice", None)
            .student("bob", None)
            .build()
            .await
            .unwrap();
        let coach = db.user_id("coach").unwrap();
        let alice = db.user_id("alice").unwrap();
        let bob = db.user_id("bob").unwrap();

        // Emit some activity rows so MAX(activity.id) > 0.
        let mut tx = db.pool.begin().await.unwrap();
        emit(
            &mut tx,
            NewActivity::new(Verb::SyllabusAssigned, coach).target_student(alice),
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();

        let mut tx = db.pool.begin().await.unwrap();
        emit(
            &mut tx,
            NewActivity::new(Verb::SyllabusGraduated, coach).target_student(bob),
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();

        let max_activity_id =
            sqlx::query_scalar!(r#"SELECT COALESCE(MAX(id), 0) AS "m!: i64" FROM activity"#)
                .fetch_one(&db.pool)
                .await
                .unwrap();
        assert!(max_activity_id > 0);

        // First run: should seed all 3 users.
        let inserted = run_cursor_init(&db.pool).await.unwrap();
        assert_eq!(inserted, 3, "all three users get a cursor row");

        // Every user's cursor should equal the current MAX activity id.
        for user_id in [coach, alice, bob] {
            let max_seen = sqlx::query_scalar!(
                r#"SELECT max_seen_id AS "m!: i64" FROM activity_cursors
                   WHERE viewer_user_id = ?"#,
                user_id
            )
            .fetch_one(&db.pool)
            .await
            .unwrap();
            assert_eq!(
                max_seen, max_activity_id,
                "user {} cursor should equal max activity id",
                user_id
            );
        }

        // Second run: idempotent, no new rows inserted (INSERT OR IGNORE skips existing).
        let inserted_again = run_cursor_init(&db.pool).await.unwrap();
        assert_eq!(inserted_again, 0, "second run inserts nothing (idempotent)");

        // Cursor values unchanged.
        for user_id in [coach, alice, bob] {
            let max_seen = sqlx::query_scalar!(
                r#"SELECT max_seen_id AS "m!: i64" FROM activity_cursors
                   WHERE viewer_user_id = ?"#,
                user_id
            )
            .fetch_one(&db.pool)
            .await
            .unwrap();
            assert_eq!(
                max_seen, max_activity_id,
                "cursor unchanged after second run for user {}",
                user_id
            );
        }

        // No duplicate cursor rows.
        let cursor_count =
            sqlx::query_scalar!(r#"SELECT COUNT(*) AS "c!: i64" FROM activity_cursors"#)
                .fetch_one(&db.pool)
                .await
                .unwrap();
        assert_eq!(cursor_count, 3, "exactly 3 cursor rows, no duplicates");
    }

    /// Student feed only includes rows where target_student_id = viewer.
    #[rocket::async_test]
    async fn student_feed_only_targets_self() {
        let db = TestDbBuilder::new()
            .coach("coach", None)
            .student("alice", None)
            .student("bob", None)
            .build()
            .await
            .unwrap();
        let coach = db.user_id("coach").unwrap();
        let alice = db.user_id("alice").unwrap();
        let bob = db.user_id("bob").unwrap();

        // One row targeting alice, one targeting bob.
        let mut tx = db.pool.begin().await.unwrap();
        emit(
            &mut tx,
            NewActivity::new(Verb::SyllabusAssigned, coach).target_student(alice),
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();

        let mut tx = db.pool.begin().await.unwrap();
        emit(
            &mut tx,
            NewActivity::new(Verb::SyllabusGraduated, coach).target_student(bob),
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();

        let alice_rows = feed(&db.pool, alice, Role::Student, None, 50)
            .await
            .unwrap();
        assert_eq!(alice_rows.len(), 1, "alice sees only her own row");
        assert_eq!(alice_rows[0].verb, "syllabus_assigned");

        let bob_rows = feed(&db.pool, bob, Role::Student, None, 50).await.unwrap();
        assert_eq!(bob_rows.len(), 1, "bob sees only his own row");
        assert_eq!(bob_rows[0].verb, "syllabus_graduated");
    }

    // Task 23 route tests

    /// GET /api/activity/feed returns rows and advances the cursor to the
    /// snapshot max, without marking rows that arrived AFTER the snapshot.
    #[rocket::async_test]
    async fn feed_endpoint_returns_rows_and_advances_cursor() {
        use crate::db::{advance_cursor_to, current_max_seen};
        use crate::test::test_utils::{login_test_user, setup_test_client};

        let db = TestDbBuilder::new()
            .coach("coach", None)
            .student("alice", None)
            .build()
            .await
            .unwrap();
        let coach = db.user_id("coach").unwrap();
        let alice = db.user_id("alice").unwrap();

        // Emit two rows targeting alice before the request.
        for verb in [Verb::SyllabusAssigned, Verb::SyllabusGraduated] {
            let mut tx = db.pool.begin().await.unwrap();
            emit(&mut tx, NewActivity::new(verb, coach).target_student(alice))
                .await
                .unwrap();
            tx.commit().await.unwrap();
        }

        let snapshot_max_id =
            sqlx::query_scalar!(r#"SELECT COALESCE(MAX(id), 0) AS "m!: i64" FROM activity"#)
                .fetch_one(&db.pool)
                .await
                .unwrap();

        let (client, db) = setup_test_client(db).await;
        let _ = login_test_user(&client, "alice", "password123").await;

        // Call the feed endpoint.
        let resp = client.get("/api/activity/feed").dispatch().await;
        assert_eq!(resp.status(), rocket::http::Status::Ok, "feed returns 200");
        let body: Vec<serde_json::Value> =
            serde_json::from_str(&resp.into_string().await.unwrap()).unwrap();
        assert_eq!(body.len(), 2, "both pre-request rows returned");

        // Cursor must have advanced to the snapshot max.
        let max_seen = current_max_seen(&db.pool, alice).await.unwrap();
        assert_eq!(max_seen, snapshot_max_id, "cursor advanced to snapshot max");

        // Emit a new row AFTER the request snapshot was taken. The new row
        // must NOT be inside the cursor (i.e., cursor < new_row_id).
        let mut tx = db.pool.begin().await.unwrap();
        emit(
            &mut tx,
            NewActivity::new(Verb::TechniquePinned, coach).target_student(alice),
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();

        let new_row_id =
            sqlx::query_scalar!(r#"SELECT COALESCE(MAX(id), 0) AS "m!: i64" FROM activity"#)
                .fetch_one(&db.pool)
                .await
                .unwrap();

        assert!(
            new_row_id > max_seen,
            "row inserted after snapshot is above cursor (not silently marked seen)"
        );

        // Advance the cursor manually past the snapshot (as-if a second page
        // load) and verify it would not exceed the new row.
        advance_cursor_to(&db.pool, alice, snapshot_max_id)
            .await
            .unwrap();
        let still_max = current_max_seen(&db.pool, alice).await.unwrap();
        assert_eq!(
            still_max, snapshot_max_id,
            "advance to same value is idempotent"
        );
    }

    /// GET /api/activity/unread_count returns a JSON count.
    #[rocket::async_test]
    async fn unread_count_endpoint() {
        use crate::test::test_utils::{login_test_user, setup_test_client};

        let db = TestDbBuilder::new()
            .coach("coach", None)
            .student("alice", None)
            .build()
            .await
            .unwrap();
        let coach = db.user_id("coach").unwrap();
        let alice = db.user_id("alice").unwrap();

        // Coach emits a notifiable row targeting alice.
        let mut tx = db.pool.begin().await.unwrap();
        emit(
            &mut tx,
            NewActivity::new(Verb::SyllabusAssigned, coach).target_student(alice),
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();

        let (client, _db) = setup_test_client(db).await;
        let _ = login_test_user(&client, "alice", "password123").await;

        let resp = client.get("/api/activity/unread_count").dispatch().await;
        assert_eq!(
            resp.status(),
            rocket::http::Status::Ok,
            "unread_count returns 200"
        );
        let body: serde_json::Value =
            serde_json::from_str(&resp.into_string().await.unwrap()).unwrap();
        assert_eq!(body["count"].as_i64(), Some(1), "one unread row for alice");
    }

    /// POST /api/activity/mark_all_read zeroes the unread count.
    #[rocket::async_test]
    async fn mark_all_read_zeroes_unread_count() {
        use crate::test::test_utils::{login_test_user, setup_test_client};

        let db = TestDbBuilder::new()
            .coach("coach", None)
            .student("alice", None)
            .build()
            .await
            .unwrap();
        let coach = db.user_id("coach").unwrap();
        let alice = db.user_id("alice").unwrap();

        // Emit a notifiable row for alice.
        let mut tx = db.pool.begin().await.unwrap();
        emit(
            &mut tx,
            NewActivity::new(Verb::SyllabusAssigned, coach).target_student(alice),
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();

        let (client, db) = setup_test_client(db).await;
        let _ = login_test_user(&client, "alice", "password123").await;

        // Confirm there is one unread before.
        let count_before = unread_count(&db.pool, alice, Role::Student).await.unwrap();
        assert_eq!(count_before, 1, "one unread before mark_all_read");

        // Call mark_all_read.
        let resp = client.post("/api/activity/mark_all_read").dispatch().await;
        assert_eq!(
            resp.status(),
            rocket::http::Status::NoContent,
            "mark_all_read returns 204"
        );

        // Unread count must now be 0.
        let count_after = unread_count(&db.pool, alice, Role::Student).await.unwrap();
        assert_eq!(count_after, 0, "unread count is zero after mark_all_read");
    }

    // Task 25 route tests (mark-one read/unread + partial cursor rejection)

    /// POST /api/activity/<id>/read marks the row seen and drops the unread
    /// count by one.
    #[rocket::async_test]
    async fn mark_one_read_route_marks_row_seen() {
        use crate::test::test_utils::{login_test_user, setup_test_client};

        let db = TestDbBuilder::new()
            .coach("coach", None)
            .student("alice", None)
            .build()
            .await
            .unwrap();
        let coach = db.user_id("coach").unwrap();
        let alice = db.user_id("alice").unwrap();

        // Coach emits a notifiable row targeting alice.
        let mut tx = db.pool.begin().await.unwrap();
        emit(
            &mut tx,
            NewActivity::new(Verb::SyllabusAssigned, coach).target_student(alice),
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();

        let act_id = sqlx::query_scalar!(r#"SELECT MAX(id) AS "id!: i64" FROM activity"#)
            .fetch_one(&db.pool)
            .await
            .unwrap();

        let (client, _db) = setup_test_client(db).await;
        let _ = login_test_user(&client, "alice", "password123").await;

        // Confirm at least one unread row.
        let count_resp = client.get("/api/activity/unread_count").dispatch().await;
        assert_eq!(count_resp.status(), rocket::http::Status::Ok);
        let body: serde_json::Value =
            serde_json::from_str(&count_resp.into_string().await.unwrap()).unwrap();
        let count_before = body["count"].as_i64().unwrap();
        assert!(count_before >= 1, "expected at least one unread row");

        // Mark the specific row read.
        let url = format!("/api/activity/{}/read", act_id);
        let resp = client.post(url).dispatch().await;
        assert_eq!(
            resp.status(),
            rocket::http::Status::NoContent,
            "mark-one-read returns 204"
        );

        // Unread count must have dropped by one.
        let count_resp2 = client.get("/api/activity/unread_count").dispatch().await;
        assert_eq!(count_resp2.status(), rocket::http::Status::Ok);
        let body2: serde_json::Value =
            serde_json::from_str(&count_resp2.into_string().await.unwrap()).unwrap();
        let count_after = body2["count"].as_i64().unwrap();
        assert_eq!(
            count_after,
            count_before - 1,
            "unread count should drop by one after mark-one-read"
        );
    }

    /// POST /api/activity/<id>/unread re-flags a previously-seen row as unread.
    #[rocket::async_test]
    async fn mark_one_unread_route_marks_row_unseen() {
        use crate::test::test_utils::{login_test_user, setup_test_client};

        let db = TestDbBuilder::new()
            .coach("coach", None)
            .student("alice", None)
            .build()
            .await
            .unwrap();
        let coach = db.user_id("coach").unwrap();
        let alice = db.user_id("alice").unwrap();

        // Coach emits a notifiable row targeting alice.
        let mut tx = db.pool.begin().await.unwrap();
        emit(
            &mut tx,
            NewActivity::new(Verb::SyllabusAssigned, coach).target_student(alice),
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();

        let act_id = sqlx::query_scalar!(r#"SELECT MAX(id) AS "id!: i64" FROM activity"#)
            .fetch_one(&db.pool)
            .await
            .unwrap();

        let (client, db) = setup_test_client(db).await;
        let _ = login_test_user(&client, "alice", "password123").await;

        // Mark all read first so count is 0.
        let resp = client.post("/api/activity/mark_all_read").dispatch().await;
        assert_eq!(resp.status(), rocket::http::Status::NoContent);

        let count_resp = client.get("/api/activity/unread_count").dispatch().await;
        let body: serde_json::Value =
            serde_json::from_str(&count_resp.into_string().await.unwrap()).unwrap();
        assert_eq!(
            body["count"].as_i64(),
            Some(0),
            "count should be 0 after mark_all_read"
        );

        // Now mark that row unread again (it is now below the cursor).
        let url = format!("/api/activity/{}/unread", act_id);
        let resp = client.post(url).dispatch().await;
        assert_eq!(
            resp.status(),
            rocket::http::Status::NoContent,
            "mark-one-unread returns 204"
        );

        // Unread count must be 1 again.
        let count_resp2 = client.get("/api/activity/unread_count").dispatch().await;
        let body2: serde_json::Value =
            serde_json::from_str(&count_resp2.into_string().await.unwrap()).unwrap();
        assert_eq!(
            body2["count"].as_i64(),
            Some(1),
            "unread count should be 1 after mark-one-unread"
        );

        // Verify the override row exists with seen=0.
        let seen_val = sqlx::query_scalar!(
            r#"SELECT seen AS "s!: bool" FROM activity_seen_overrides
               WHERE viewer_user_id = ? AND activity_id = ?"#,
            alice,
            act_id
        )
        .fetch_one(&db.pool)
        .await
        .unwrap();
        assert!(!seen_val, "override should be seen=0 after mark-one-unread");
    }

    /// GET /api/activity/feed with only before_id (missing before_ts) returns 400.
    #[rocket::async_test]
    async fn feed_partial_cursor_is_rejected() {
        use crate::test::test_utils::{login_test_user, setup_test_client};

        let db = TestDbBuilder::new()
            .coach("coach", None)
            .student("alice", None)
            .build()
            .await
            .unwrap();

        let (client, _db) = setup_test_client(db).await;
        let _ = login_test_user(&client, "alice", "password123").await;

        // Provide only before_id, no before_ts — must be rejected.
        let resp = client
            .get("/api/activity/feed?before_id=42")
            .dispatch()
            .await;
        assert_eq!(
            resp.status(),
            rocket::http::Status::BadRequest,
            "partial cursor (before_id only) must return 400"
        );
    }

    // Bug 1 fix tests: student-scoped activity feed route

    /// GET /api/student/<sid>/activity_feed returns only rows targeting that
    /// student, even when requested by a coach (not gym-wide feed).
    #[rocket::async_test]
    async fn student_scoped_feed_returns_only_target_student_rows() {
        use crate::test::test_utils::{login_test_user, setup_test_client};

        let db = TestDbBuilder::new()
            .coach("coach", None)
            .student("alice", None)
            .student("bob", None)
            .build()
            .await
            .unwrap();
        let coach = db.user_id("coach").unwrap();
        let alice = db.user_id("alice").unwrap();
        let bob = db.user_id("bob").unwrap();

        // Emit a row targeting alice and one targeting bob.
        let mut tx = db.pool.begin().await.unwrap();
        emit(
            &mut tx,
            NewActivity::new(Verb::SyllabusAssigned, coach).target_student(alice),
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();

        let mut tx = db.pool.begin().await.unwrap();
        emit(
            &mut tx,
            NewActivity::new(Verb::SyllabusGraduated, coach).target_student(bob),
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();

        // Coach requests alice's scoped feed.
        let (client, _db) = setup_test_client(db).await;
        let _ = login_test_user(&client, "coach", "password123").await;

        let url = format!("/api/student/{}/activity_feed", alice);
        let resp = client.get(url).dispatch().await;
        assert_eq!(
            resp.status(),
            rocket::http::Status::Ok,
            "student scoped feed returns 200 for coach"
        );
        let body: Vec<serde_json::Value> =
            serde_json::from_str(&resp.into_string().await.unwrap()).unwrap();

        assert_eq!(body.len(), 1, "only alice's row returned");
        assert_eq!(
            body[0]["verb"].as_str(),
            Some("syllabus_assigned"),
            "alice's row has the correct verb"
        );
        assert_eq!(
            body[0]["target_student_id"].as_i64(),
            Some(alice),
            "target_student_id is alice"
        );
    }

    /// A student requesting another student's scoped feed gets 403.
    #[rocket::async_test]
    async fn student_scoped_feed_forbidden_for_other_student() {
        use crate::test::test_utils::{login_test_user, setup_test_client};

        let db = TestDbBuilder::new()
            .coach("coach", None)
            .student("alice", None)
            .student("bob", None)
            .build()
            .await
            .unwrap();
        let coach = db.user_id("coach").unwrap();
        let alice = db.user_id("alice").unwrap();

        // Emit a row targeting alice.
        let mut tx = db.pool.begin().await.unwrap();
        emit(
            &mut tx,
            NewActivity::new(Verb::SyllabusAssigned, coach).target_student(alice),
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();

        // bob tries to read alice's scoped feed.
        let (client, _db) = setup_test_client(db).await;
        let _ = login_test_user(&client, "bob", "password123").await;

        let url = format!("/api/student/{}/activity_feed", alice);
        let resp = client.get(url).dispatch().await;
        assert_eq!(
            resp.status(),
            rocket::http::Status::Forbidden,
            "another student requesting the feed gets 403"
        );
    }

}
