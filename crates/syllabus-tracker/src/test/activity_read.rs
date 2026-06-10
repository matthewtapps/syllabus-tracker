#[cfg(test)]
mod tests {
    use crate::auth::Role;
    use crate::db::{
        NewActivity, Verb, advance_cursor_to, current_max_seen, emit, feed_max_id, mark_one_read,
        mark_one_unread, notifies,
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
}
