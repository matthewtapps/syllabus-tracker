#[cfg(test)]
mod tests {
    use chrono::Utc;

    use crate::auth::User;
    use crate::db::{
        attempt_buckets_for_student, attempt_summary_for_student,
        attempt_weekly_buckets_for_technique, create_attempt, delete_attempt, get_attempt,
        get_user, list_attempts, list_recent_attempts_for_student, update_attempt_note,
        update_attempt_timestamp, AttemptSuggestion,
    };
    use crate::test::test_utils::TestDbBuilder;

    async fn fetch_user(pool: &sqlx::SqlitePool, user_id: i64) -> User {
        get_user(pool, user_id).await.expect("user")
    }

    async fn standard_setup_red() -> (crate::test::test_utils::TestDb, i64) {
        let test_db = TestDbBuilder::new()
            .admin("admin_user", Some("Admin User"))
            .coach("coach_user", Some("Coach User"))
            .student("student_user", Some("Student User"))
            .technique("Armbar", "Description of armbar", Some("coach_user"))
            .assign_technique(Some("Armbar"), Some("student_user"), "red", "", "")
            .build()
            .await
            .expect("Failed to build test database");
        let st_id = test_db
            .student_technique_id("student_user", "Armbar")
            .await
            .expect("Could not resolve student_technique_id");
        (test_db, st_id)
    }

    #[rocket::async_test]
    async fn first_attempt_on_red_returns_amber_suggestion() {
        let (db, st_id) = standard_setup_red().await;
        let student = fetch_user(&db.pool, db.user_id("student_user").unwrap()).await;

        let res = create_attempt(&db.pool, &student, st_id, Utc::now(), None)
            .await
            .expect("Create attempt");

        assert_eq!(res.suggestion, AttemptSuggestion::Amber);
        assert_eq!(res.attempt.recorded_by_id, student.id);
        assert!(res.attempt.coach_note.is_none());
        assert!(res.attempt.student_note.is_none());
    }

    #[rocket::async_test]
    async fn second_attempt_on_red_has_no_suggestion() {
        let (db, st_id) = standard_setup_red().await;
        let student = fetch_user(&db.pool, db.user_id("student_user").unwrap()).await;

        create_attempt(&db.pool, &student, st_id, Utc::now(), None)
            .await
            .unwrap();
        let res = create_attempt(&db.pool, &student, st_id, Utc::now(), None)
            .await
            .unwrap();
        assert_eq!(res.suggestion, AttemptSuggestion::None);
    }

    #[rocket::async_test]
    async fn first_attempt_on_amber_has_no_suggestion() {
        let test_db = TestDbBuilder::new()
            .coach("coach_user", Some("Coach User"))
            .student("student_user", Some("Student User"))
            .technique("Armbar", "Description of armbar", Some("coach_user"))
            .assign_technique(Some("Armbar"), Some("student_user"), "amber", "", "")
            .build()
            .await
            .unwrap();
        let st_id = test_db
            .student_technique_id("student_user", "Armbar")
            .await
            .unwrap();
        let student = fetch_user(&test_db.pool, test_db.user_id("student_user").unwrap()).await;

        let res = create_attempt(&test_db.pool, &student, st_id, Utc::now(), None)
            .await
            .unwrap();
        assert_eq!(res.suggestion, AttemptSuggestion::None);
    }

    #[rocket::async_test]
    async fn student_note_lands_in_student_slot() {
        let (db, st_id) = standard_setup_red().await;
        let student = fetch_user(&db.pool, db.user_id("student_user").unwrap()).await;

        let res = create_attempt(&db.pool, &student, st_id, Utc::now(), Some("nailed it"))
            .await
            .unwrap();

        assert_eq!(res.attempt.student_note.as_deref(), Some("nailed it"));
        assert!(res.attempt.coach_note.is_none());
        assert!(res.attempt.student_note_at.is_some());
    }

    #[rocket::async_test]
    async fn coach_note_lands_in_coach_slot_with_attribution() {
        let (db, st_id) = standard_setup_red().await;
        let coach = fetch_user(&db.pool, db.user_id("coach_user").unwrap()).await;

        let res = create_attempt(&db.pool, &coach, st_id, Utc::now(), Some("clean entry"))
            .await
            .unwrap();

        assert_eq!(res.attempt.coach_note.as_deref(), Some("clean entry"));
        assert_eq!(res.attempt.coach_note_by_id, Some(coach.id));
        assert!(res.attempt.student_note.is_none());
    }

    #[rocket::async_test]
    async fn student_cannot_create_attempt_for_someone_else() {
        let test_db = TestDbBuilder::new()
            .coach("coach_user", Some("Coach User"))
            .student("student_a", Some("A"))
            .student("student_b", Some("B"))
            .technique("Armbar", "Description", Some("coach_user"))
            .assign_technique(Some("Armbar"), Some("student_a"), "red", "", "")
            .build()
            .await
            .unwrap();
        let st_id = test_db
            .student_technique_id("student_a", "Armbar")
            .await
            .unwrap();
        let other = fetch_user(&test_db.pool, test_db.user_id("student_b").unwrap()).await;

        let res = create_attempt(&test_db.pool, &other, st_id, Utc::now(), None).await;
        assert!(res.is_err());
    }

    #[rocket::async_test]
    async fn student_can_delete_own_attempt_but_not_coach_attempt() {
        let (db, st_id) = standard_setup_red().await;
        let coach = fetch_user(&db.pool, db.user_id("coach_user").unwrap()).await;
        let student = fetch_user(&db.pool, db.user_id("student_user").unwrap()).await;

        let coach_logged = create_attempt(&db.pool, &coach, st_id, Utc::now(), None)
            .await
            .unwrap();
        let student_logged = create_attempt(&db.pool, &student, st_id, Utc::now(), None)
            .await
            .unwrap();

        // Student deletes own: ok
        delete_attempt(&db.pool, &student, student_logged.attempt.id)
            .await
            .expect("Student should delete own attempt");
        // Student tries to delete coach's: forbidden
        let forbidden = delete_attempt(&db.pool, &student, coach_logged.attempt.id).await;
        assert!(forbidden.is_err());
        // Coach deletes coach's: ok
        delete_attempt(&db.pool, &coach, coach_logged.attempt.id)
            .await
            .expect("Coach should delete own attempt");
    }

    #[rocket::async_test]
    async fn coach_can_delete_student_attempt() {
        let (db, st_id) = standard_setup_red().await;
        let coach = fetch_user(&db.pool, db.user_id("coach_user").unwrap()).await;
        let student = fetch_user(&db.pool, db.user_id("student_user").unwrap()).await;
        let res = create_attempt(&db.pool, &student, st_id, Utc::now(), None)
            .await
            .unwrap();
        delete_attempt(&db.pool, &coach, res.attempt.id)
            .await
            .expect("Coach should delete student attempt");
    }

    #[rocket::async_test]
    async fn update_note_writes_only_actor_slot() {
        let (db, st_id) = standard_setup_red().await;
        let coach = fetch_user(&db.pool, db.user_id("coach_user").unwrap()).await;
        let student = fetch_user(&db.pool, db.user_id("student_user").unwrap()).await;

        let res = create_attempt(&db.pool, &coach, st_id, Utc::now(), Some("coach saw it"))
            .await
            .unwrap();

        update_attempt_note(&db.pool, &student, res.attempt.id, Some("here's what I did"))
            .await
            .unwrap();

        let refreshed = get_attempt(&db.pool, res.attempt.id).await.unwrap();
        assert_eq!(refreshed.coach_note.as_deref(), Some("coach saw it"));
        assert_eq!(refreshed.student_note.as_deref(), Some("here's what I did"));
    }

    #[rocket::async_test]
    async fn empty_note_clears_actor_slot() {
        let (db, st_id) = standard_setup_red().await;
        let student = fetch_user(&db.pool, db.user_id("student_user").unwrap()).await;
        let res = create_attempt(&db.pool, &student, st_id, Utc::now(), Some("oops"))
            .await
            .unwrap();
        update_attempt_note(&db.pool, &student, res.attempt.id, Some(""))
            .await
            .unwrap();
        let refreshed = get_attempt(&db.pool, res.attempt.id).await.unwrap();
        assert!(refreshed.student_note.is_none());
    }

    #[rocket::async_test]
    async fn student_cannot_backdate_someone_elses_attempt() {
        let (db, st_id) = standard_setup_red().await;
        let coach = fetch_user(&db.pool, db.user_id("coach_user").unwrap()).await;
        let student = fetch_user(&db.pool, db.user_id("student_user").unwrap()).await;

        let res = create_attempt(&db.pool, &coach, st_id, Utc::now(), None)
            .await
            .unwrap();
        let earlier = Utc::now() - chrono::Duration::days(3);
        let forbidden = update_attempt_timestamp(&db.pool, &student, res.attempt.id, earlier).await;
        assert!(forbidden.is_err());
    }

    #[rocket::async_test]
    async fn coach_can_backdate_any_attempt() {
        let (db, st_id) = standard_setup_red().await;
        let coach = fetch_user(&db.pool, db.user_id("coach_user").unwrap()).await;
        let student = fetch_user(&db.pool, db.user_id("student_user").unwrap()).await;
        let res = create_attempt(&db.pool, &student, st_id, Utc::now(), None)
            .await
            .unwrap();
        let earlier = Utc::now() - chrono::Duration::days(3);
        update_attempt_timestamp(&db.pool, &coach, res.attempt.id, earlier)
            .await
            .expect("coach can backdate");
    }

    #[rocket::async_test]
    async fn list_attempts_orders_newest_first() {
        let (db, st_id) = standard_setup_red().await;
        let student = fetch_user(&db.pool, db.user_id("student_user").unwrap()).await;

        let t1 = Utc::now() - chrono::Duration::days(2);
        let t2 = Utc::now() - chrono::Duration::days(1);
        let t3 = Utc::now();

        create_attempt(&db.pool, &student, st_id, t1, Some("a"))
            .await
            .unwrap();
        create_attempt(&db.pool, &student, st_id, t3, Some("c"))
            .await
            .unwrap();
        create_attempt(&db.pool, &student, st_id, t2, Some("b"))
            .await
            .unwrap();

        let list = list_attempts(&db.pool, st_id).await.unwrap();
        assert_eq!(list.len(), 3);
        assert_eq!(list[0].student_note.as_deref(), Some("c"));
        assert_eq!(list[1].student_note.as_deref(), Some("b"));
        assert_eq!(list[2].student_note.as_deref(), Some("a"));
    }

    #[rocket::async_test]
    async fn cascade_delete_when_student_technique_removed() {
        let (db, st_id) = standard_setup_red().await;
        let student = fetch_user(&db.pool, db.user_id("student_user").unwrap()).await;
        create_attempt(&db.pool, &student, st_id, Utc::now(), None)
            .await
            .unwrap();

        sqlx::query!("DELETE FROM student_techniques WHERE id = ?", st_id)
            .execute(&db.pool)
            .await
            .unwrap();

        let after = list_attempts(&db.pool, st_id).await.unwrap();
        assert!(after.is_empty());
    }

    #[rocket::async_test]
    async fn summary_counts_within_windows() {
        let (db, st_id) = standard_setup_red().await;
        let student = fetch_user(&db.pool, db.user_id("student_user").unwrap()).await;
        let student_id = student.id;

        // Today, 3 days ago, 20 days ago, 60 days ago
        create_attempt(&db.pool, &student, st_id, Utc::now(), None)
            .await
            .unwrap();
        create_attempt(
            &db.pool,
            &student,
            st_id,
            Utc::now() - chrono::Duration::days(3),
            None,
        )
        .await
        .unwrap();
        create_attempt(
            &db.pool,
            &student,
            st_id,
            Utc::now() - chrono::Duration::days(20),
            None,
        )
        .await
        .unwrap();
        create_attempt(
            &db.pool,
            &student,
            st_id,
            Utc::now() - chrono::Duration::days(60),
            None,
        )
        .await
        .unwrap();

        let summary = attempt_summary_for_student(&db.pool, student_id)
            .await
            .unwrap();
        assert_eq!(summary.total, 4);
        assert_eq!(summary.this_week, 2);
        assert_eq!(summary.this_month, 3);
    }

    #[rocket::async_test]
    async fn recent_attempts_returns_with_technique_name() {
        let (db, st_id) = standard_setup_red().await;
        let student = fetch_user(&db.pool, db.user_id("student_user").unwrap()).await;
        create_attempt(&db.pool, &student, st_id, Utc::now(), Some("note"))
            .await
            .unwrap();
        let recent = list_recent_attempts_for_student(&db.pool, student.id, 5)
            .await
            .unwrap();
        assert_eq!(recent.len(), 1);
        assert_eq!(recent[0].technique_name, "Armbar");
        assert_eq!(recent[0].student_note.as_deref(), Some("note"));
    }

    #[rocket::async_test]
    async fn heatmap_buckets_by_day() {
        let (db, st_id) = standard_setup_red().await;
        let student = fetch_user(&db.pool, db.user_id("student_user").unwrap()).await;
        let today = Utc::now().date_naive();
        let yesterday = today - chrono::Duration::days(1);
        create_attempt(&db.pool, &student, st_id, Utc::now(), None)
            .await
            .unwrap();
        create_attempt(&db.pool, &student, st_id, Utc::now(), None)
            .await
            .unwrap();
        create_attempt(
            &db.pool,
            &student,
            st_id,
            Utc::now() - chrono::Duration::days(1),
            None,
        )
        .await
        .unwrap();

        let buckets =
            attempt_buckets_for_student(&db.pool, student.id, yesterday, today)
                .await
                .unwrap();
        assert_eq!(buckets.len(), 2);
        let map: std::collections::HashMap<_, _> =
            buckets.into_iter().map(|b| (b.date, b.count)).collect();
        assert_eq!(map.get(&today).copied(), Some(2));
        assert_eq!(map.get(&yesterday).copied(), Some(1));
    }

    #[rocket::async_test]
    async fn sparkline_buckets_by_week() {
        let (db, st_id) = standard_setup_red().await;
        let student = fetch_user(&db.pool, db.user_id("student_user").unwrap()).await;
        create_attempt(&db.pool, &student, st_id, Utc::now(), None)
            .await
            .unwrap();
        create_attempt(
            &db.pool,
            &student,
            st_id,
            Utc::now() - chrono::Duration::days(10),
            None,
        )
        .await
        .unwrap();

        let buckets = attempt_weekly_buckets_for_technique(&db.pool, st_id, 12)
            .await
            .unwrap();
        let total: i64 = buckets.iter().map(|b| b.count).sum();
        assert_eq!(total, 2);
    }

    #[rocket::async_test]
    async fn create_attempt_bumps_student_technique_activity() {
        let (db, st_id) = standard_setup_red().await;
        let student = fetch_user(&db.pool, db.user_id("student_user").unwrap()).await;
        let coach = fetch_user(&db.pool, db.user_id("coach_user").unwrap()).await;

        // Establish baselines: the test seed leaves last_*_update_at NULL for
        // this assignment, so anything non-null is an improvement.
        create_attempt(&db.pool, &student, st_id, Utc::now(), None)
            .await
            .unwrap();
        let after_student = db.get_student_technique(st_id).await.unwrap();
        assert!(after_student.last_student_update_at.is_some());
        assert_eq!(after_student.last_student_update_by_id, Some(student.id));

        create_attempt(&db.pool, &coach, st_id, Utc::now(), None)
            .await
            .unwrap();
        let after_coach = db.get_student_technique(st_id).await.unwrap();
        assert!(after_coach.last_coach_update_at.is_some());
        assert_eq!(after_coach.last_coach_update_by_id, Some(coach.id));
        // updated_at should advance (or at least be set) on the parent row so
        // the dashboard query (which orders by updated_at) sees activity.
        assert!(after_coach.updated_at >= after_student.updated_at);
    }

    #[rocket::async_test]
    async fn backdated_attempt_does_not_backdate_activity() {
        let (db, st_id) = standard_setup_red().await;
        let student = fetch_user(&db.pool, db.user_id("student_user").unwrap()).await;
        // Backdate by 10 days; the activity timestamp should still reflect now.
        let backdate = Utc::now() - chrono::Duration::days(10);
        create_attempt(&db.pool, &student, st_id, backdate, None)
            .await
            .unwrap();
        let after = db.get_student_technique(st_id).await.unwrap();
        let stamp = after.last_student_update_at.expect("activity set");
        let age = Utc::now().signed_duration_since(stamp);
        assert!(age.num_seconds() < 60, "activity should be recent, was {}s old", age.num_seconds());
    }

    #[rocket::async_test]
    async fn update_attempt_note_bumps_activity() {
        let (db, st_id) = standard_setup_red().await;
        let student = fetch_user(&db.pool, db.user_id("student_user").unwrap()).await;

        let backdate = Utc::now() - chrono::Duration::days(3);
        let res = create_attempt(&db.pool, &student, st_id, backdate, None)
            .await
            .unwrap();
        // Snapshot the parent activity timestamp after the (backdated) insert.
        let baseline = db
            .get_student_technique(st_id)
            .await
            .unwrap()
            .last_student_update_at
            .unwrap();

        // Sleep a moment so the post-update stamp is strictly newer in tests
        // that run on machines with second-resolution timestamps.
        tokio::time::sleep(std::time::Duration::from_millis(1100)).await;

        update_attempt_note(&db.pool, &student, res.attempt.id, Some("later note"))
            .await
            .unwrap();
        let after = db.get_student_technique(st_id).await.unwrap();
        assert!(after.last_student_update_at.unwrap() > baseline);
    }

    #[rocket::async_test]
    async fn get_student_techniques_includes_attempt_count() {
        let (db, st_id) = standard_setup_red().await;
        let student = fetch_user(&db.pool, db.user_id("student_user").unwrap()).await;
        let student_id = student.id;
        create_attempt(&db.pool, &student, st_id, Utc::now(), None)
            .await
            .unwrap();
        create_attempt(&db.pool, &student, st_id, Utc::now(), None)
            .await
            .unwrap();
        let techs = crate::db::get_student_techniques(&db.pool, student_id, student_id)
            .await
            .unwrap();
        let target = techs.into_iter().find(|t| t.id == st_id).unwrap();
        assert_eq!(target.attempt_count, 2);
        assert!(target.last_attempt_at.is_some());
    }
}
