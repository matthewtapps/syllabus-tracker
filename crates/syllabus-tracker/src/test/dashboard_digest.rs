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
}
