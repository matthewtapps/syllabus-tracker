#[cfg(test)]
mod tests {
    use crate::db::{ActivityDigest, NewActivity, Verb, activity_digest, emit};
    use crate::test::test_utils::TestDbBuilder;

    fn metric<'a>(d: &'a ActivityDigest, key: &str) -> &'a crate::db::DigestMetric {
        d.metrics.iter().find(|m| m.key == key).expect("metric present")
    }

    #[rocket::async_test]
    async fn digest_counts_student_attempts_in_current_window() {
        let db = TestDbBuilder::new()
            .coach("coach", None)
            .student("alice", None)
            .technique("Armbar", "", Some("coach"))
            .build()
            .await
            .unwrap();
        let alice = db.user_id("alice").unwrap();
        let armbar = db.technique_id("Armbar").unwrap();

        for _ in 0..3 {
            let mut tx = db.pool.begin().await.unwrap();
            emit(
                &mut tx,
                NewActivity::new(Verb::AttemptLogged, alice)
                    .target_student(alice)
                    .technique(armbar),
            )
            .await
            .unwrap();
            tx.commit().await.unwrap();
        }

        let digest = activity_digest(&db.pool).await.unwrap();
        let attempts = metric(&digest, "attempts_logged");
        assert_eq!(attempts.count, 3, "3 attempts in the current 7-day window");
        assert_eq!(attempts.prev_count, 0);
        assert_eq!(attempts.delta, 3);
        assert_eq!(attempts.daily.len(), 7);
        assert_eq!(attempts.daily.iter().sum::<i64>(), 3);

        let active = metric(&digest, "active_students");
        assert_eq!(active.count, 1, "one distinct active student");
    }

    #[rocket::async_test]
    async fn digest_backdated_attempt_counts_in_previous_window() {
        let db = TestDbBuilder::new()
            .coach("coach", None)
            .student("alice", None)
            .technique("Armbar", "", Some("coach"))
            .build()
            .await
            .unwrap();
        let alice = db.user_id("alice").unwrap();
        let armbar = db.technique_id("Armbar").unwrap();

        // 10 days ago lands in the previous 7-day window, not the current one.
        sqlx::query(
            "INSERT INTO activity (occurred_at, verb, actor_user_id, target_student_id, technique_id)
             VALUES (datetime('now', '-10 days'), 'attempt_logged', ?, ?, ?)",
        )
        .bind(alice)
        .bind(alice)
        .bind(armbar)
        .execute(&db.pool)
        .await
        .unwrap();

        let digest = activity_digest(&db.pool).await.unwrap();
        let attempts = digest.metrics.iter().find(|m| m.key == "attempts_logged").unwrap();
        assert_eq!(attempts.count, 0, "10-day-old attempt is not in the current window");
        assert_eq!(attempts.prev_count, 1, "it is in the previous window");
        assert_eq!(attempts.delta, -1);
    }

    #[rocket::async_test]
    async fn digest_active_students_counts_distinct() {
        let db = TestDbBuilder::new()
            .coach("coach", None)
            .student("alice", None)
            .student("bob", None)
            .technique("Armbar", "", Some("coach"))
            .build()
            .await
            .unwrap();
        let alice = db.user_id("alice").unwrap();
        let bob = db.user_id("bob").unwrap();
        let armbar = db.technique_id("Armbar").unwrap();

        for id in [alice, bob] {
            let mut tx = db.pool.begin().await.unwrap();
            emit(
                &mut tx,
                NewActivity::new(Verb::AttemptLogged, id)
                    .target_student(id)
                    .technique(armbar),
            )
            .await
            .unwrap();
            tx.commit().await.unwrap();
        }

        let digest = activity_digest(&db.pool).await.unwrap();
        let active = metric(&digest, "active_students");
        assert_eq!(active.count, 2, "two distinct active students");
    }

    #[rocket::async_test]
    async fn digest_ignores_coach_actor_activity() {
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

        let mut tx = db.pool.begin().await.unwrap();
        emit(
            &mut tx,
            NewActivity::new(Verb::SstStatusChanged, coach)
                .target_student(alice)
                .technique(armbar),
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();

        let digest = activity_digest(&db.pool).await.unwrap();
        assert_eq!(metric(&digest, "active_students").count, 0);
    }

    /// Coach performing sst_status_changed must appear in the dashboard feed,
    /// and target_student_name must be populated from the student user record.
    #[rocket::async_test]
    async fn dashboard_feed_surfaces_coach_sst_status_changed_with_student_name() {
        use crate::db::dashboard_activity_feed;
        let db = TestDbBuilder::new()
            .coach("coach", Some("Coach Dave"))
            .student("alice", Some("Alice Smith"))
            .build()
            .await
            .unwrap();
        let coach = db.user_id("coach").unwrap();
        let alice = db.user_id("alice").unwrap();

        // Coach changes a student's SST status (simulates the prod migration pattern).
        let mut tx = db.pool.begin().await.unwrap();
        emit(
            &mut tx,
            NewActivity::new(Verb::SstStatusChanged, coach).target_student(alice),
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();

        let rows = dashboard_activity_feed(&db.pool, 30).await.unwrap();

        // The coach's sst_status_changed must appear (not filtered out).
        assert_eq!(rows.len(), 1, "coach status change appears in the dashboard feed");
        assert_eq!(rows[0].verb, "sst_status_changed");
        assert_eq!(rows[0].actor_user_id, coach, "actor is the coach");

        // target_student_name must be alice's display name.
        assert_eq!(
            rows[0].target_student_name.as_deref(),
            Some("Alice Smith"),
            "target_student_name is populated with the student display name"
        );
    }

    /// Coach undo/delete history verbs (and thread comments) stay off the glance
    /// even though the coach arm is otherwise a denylist. Guards against the
    /// excluded set silently shrinking.
    #[rocket::async_test]
    async fn dashboard_feed_excludes_coach_history_and_comment_verbs() {
        use crate::db::dashboard_activity_feed;
        let db = TestDbBuilder::new()
            .coach("coach", Some("Coach Dave"))
            .student("alice", Some("Alice Smith"))
            .technique("Armbar", "", Some("coach"))
            .build()
            .await
            .unwrap();
        let coach = db.user_id("coach").unwrap();
        let alice = db.user_id("alice").unwrap();
        let armbar = db.technique_id("Armbar").unwrap();

        let mut tx = db.pool.begin().await.unwrap();
        // An excluded history verb and a thread comment: neither belongs on the glance.
        emit(&mut tx, NewActivity::new(Verb::TechniqueUnpinned, coach).target_student(alice).technique(armbar)).await.unwrap();
        emit(&mut tx, NewActivity::new(Verb::ThreadCommentPosted, coach).target_student(alice).technique(armbar)).await.unwrap();
        // A surfacing verb so the feed is not trivially empty.
        emit(&mut tx, NewActivity::new(Verb::SstStatusChanged, coach).target_student(alice).technique(armbar)).await.unwrap();
        tx.commit().await.unwrap();

        let rows = dashboard_activity_feed(&db.pool, 30).await.unwrap();
        assert!(rows.iter().any(|r| r.verb == "sst_status_changed"), "status change surfaces");
        assert!(!rows.iter().any(|r| r.verb == "technique_unpinned"), "undo verb stays excluded");
        assert!(!rows.iter().any(|r| r.verb == "thread_comment_posted"), "thread comment stays off the glance");
    }

    #[rocket::async_test]
    async fn dashboard_feed_includes_engagement_and_coach_curation() {
        use crate::db::dashboard_activity_feed;
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

        let mut tx = db.pool.begin().await.unwrap();
        // Student engagement: should appear.
        emit(&mut tx, NewActivity::new(Verb::AttemptLogged, alice).target_student(alice).technique(armbar)).await.unwrap();
        // Coach curation (syllabus_technique_added): now surfaces on the dashboard
        // because it is a coach action not in the excluded (undo/delete) set.
        emit(&mut tx, NewActivity::new(Verb::SyllabusTechniqueAdded, coach).target_student(alice).technique(armbar)).await.unwrap();
        tx.commit().await.unwrap();

        let rows = dashboard_activity_feed(&db.pool, 30).await.unwrap();
        assert_eq!(rows.len(), 2, "both the student engagement and the coach curation row appear");
        assert!(rows.iter().any(|r| r.verb == "attempt_logged"), "student attempt is present");
        assert!(rows.iter().any(|r| r.verb == "syllabus_technique_added"), "coach curation row now surfaces");
        assert!(rows.iter().all(|r| !r.unread), "dashboard feed never sets unread");

        // syllabus_graduated surfaces regardless of actor role.
        let mut tx = db.pool.begin().await.unwrap();
        emit(&mut tx, NewActivity::new(Verb::SyllabusGraduated, coach).target_student(alice)).await.unwrap();
        tx.commit().await.unwrap();
        let rows = dashboard_activity_feed(&db.pool, 30).await.unwrap();
        assert!(rows.iter().any(|r| r.verb == "syllabus_graduated"), "coach graduation surfaces");
        assert!(rows.iter().any(|r| r.verb == "attempt_logged"), "student attempt still present");
    }
}
