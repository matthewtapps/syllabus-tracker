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
}
