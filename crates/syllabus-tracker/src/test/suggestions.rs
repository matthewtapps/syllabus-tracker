#[cfg(test)]
mod tests {
    use crate::db::camps::{create_camp, NewCamp};
    use crate::db::suggestions::{
        create_suggestion, decide_suggestion, list_pending_suggestions,
        list_suggestions_for_student, SuggestionDecision,
    };
    use crate::error::AppError;
    use crate::test::test_utils::TestDbBuilder;
    use sqlx::Pool;
    use sqlx::Sqlite;

    /// Insert a technique directly (no builder shortcut for ad-hoc techniques).
    async fn insert_technique(pool: &Pool<Sqlite>, name: &str, coach_id: i64) -> i64 {
        sqlx::query_scalar!(
            r#"INSERT INTO techniques (name, description, coach_id)
               VALUES (?, '', ?) RETURNING id AS "id!: i64""#,
            name,
            coach_id
        )
        .fetch_one(pool)
        .await
        .unwrap()
    }

    // -----------------------------------------------------------------------
    // create_suggestion
    // -----------------------------------------------------------------------

    #[rocket::async_test]
    async fn create_suggestion_emits_activity() {
        let db = TestDbBuilder::new()
            .coach("coach", Some("Coach"))
            .student("student", Some("Sam"))
            .build()
            .await
            .unwrap();

        let coach = db.user_id("coach").unwrap();
        let student = db.user_id("student").unwrap();
        let tech = insert_technique(&db.pool, "armbar", coach).await;

        let id = create_suggestion(&db.pool, student, tech, None, None)
            .await
            .unwrap();

        // Row exists with status=pending.
        let status: String =
            sqlx::query_scalar("SELECT status FROM technique_suggestions WHERE id = ?")
                .bind(id)
                .fetch_one(&db.pool)
                .await
                .unwrap();
        assert_eq!(status, "pending");

        // Activity row was emitted.
        let (verb, target, got_tech): (String, i64, i64) = sqlx::query_as(
            "SELECT verb, target_student_id, technique_id FROM activity
             WHERE verb = 'technique_suggested' ORDER BY id DESC LIMIT 1",
        )
        .fetch_one(&db.pool)
        .await
        .unwrap();

        assert_eq!(verb, "technique_suggested");
        assert_eq!(target, student);
        assert_eq!(got_tech, tech);
    }

    #[rocket::async_test]
    async fn create_suggestion_with_anchor() {
        let db = TestDbBuilder::new()
            .coach("coach", Some("Coach"))
            .student("student", Some("Sam"))
            .build()
            .await
            .unwrap();

        let coach = db.user_id("coach").unwrap();
        let student = db.user_id("student").unwrap();
        let tech = insert_technique(&db.pool, "triangle", coach).await;

        // Insert a camp and a video anchored to it for the suggestion anchor.
        let camp_id: i64 = sqlx::query_scalar(
            "INSERT INTO camps (student_id, coach_id, name) VALUES (?, ?, 'test') RETURNING id",
        )
        .bind(student)
        .bind(coach)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        let video_id: i64 = sqlx::query_scalar(
            "INSERT INTO videos (parent_kind, camp_id, title, kind, processing_status, uploaded_by_id)
             VALUES ('camp', ?, 'Match vid', 'external', 'ready', ?) RETURNING id",
        )
        .bind(camp_id)
        .bind(coach)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        let id = create_suggestion(&db.pool, student, tech, Some(video_id), Some(42))
            .await
            .unwrap();

        let (anchor_vid, anchor_secs): (i64, i64) = sqlx::query_as(
            "SELECT anchor_video_id, anchor_seconds FROM technique_suggestions WHERE id = ?",
        )
        .bind(id)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        assert_eq!(anchor_vid, video_id);
        assert_eq!(anchor_secs, 42);
    }

    // -----------------------------------------------------------------------
    // list_pending_suggestions
    // -----------------------------------------------------------------------

    #[rocket::async_test]
    async fn list_pending_returns_only_pending() {
        let db = TestDbBuilder::new()
            .coach("coach", Some("Coach"))
            .student("student", Some("Sam"))
            .build()
            .await
            .unwrap();

        let coach = db.user_id("coach").unwrap();
        let student = db.user_id("student").unwrap();
        let tech1 = insert_technique(&db.pool, "guard pass", coach).await;
        let tech2 = insert_technique(&db.pool, "sweep", coach).await;

        let id1 = create_suggestion(&db.pool, student, tech1, None, None)
            .await
            .unwrap();
        let _id2 = create_suggestion(&db.pool, student, tech2, None, None)
            .await
            .unwrap();

        // Dismiss the first one so only tech2 is pending.
        sqlx::query("UPDATE technique_suggestions SET status = 'dismissed' WHERE id = ?")
            .bind(id1)
            .execute(&db.pool)
            .await
            .unwrap();

        let pending = list_pending_suggestions(&db.pool).await.unwrap();
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].technique_id, tech2);
        assert_eq!(pending[0].student_name.as_deref(), Some("Sam"));
        assert_eq!(pending[0].technique_name, "sweep");
    }

    // -----------------------------------------------------------------------
    // approve
    // -----------------------------------------------------------------------

    #[rocket::async_test]
    async fn approve_adds_technique_to_camp_and_sets_status() {
        let db = TestDbBuilder::new()
            .coach("coach", Some("Coach"))
            .student("student", Some("Sam"))
            .build()
            .await
            .unwrap();

        let coach = db.user_id("coach").unwrap();
        let student = db.user_id("student").unwrap();
        let tech = insert_technique(&db.pool, "kimura", coach).await;

        let camp_id = create_camp(
            &db.pool,
            NewCamp {
                student_id: student,
                coach_id: coach,
                name: "Worlds prep".into(),
                description: None,
                references_camp_id: None,
            },
        )
        .await
        .unwrap();

        let sug_id = create_suggestion(&db.pool, student, tech, None, None)
            .await
            .unwrap();

        decide_suggestion(
            &db.pool,
            sug_id,
            coach,
            SuggestionDecision::Approve { camp_id },
        )
        .await
        .unwrap();

        // Status updated.
        let status: String =
            sqlx::query_scalar("SELECT status FROM technique_suggestions WHERE id = ?")
                .bind(sug_id)
                .fetch_one(&db.pool)
                .await
                .unwrap();
        assert_eq!(status, "approved");

        // decided_by_id + decided_camp_id set.
        let (by, camp): (i64, i64) = sqlx::query_as(
            "SELECT decided_by_id, decided_camp_id FROM technique_suggestions WHERE id = ?",
        )
        .bind(sug_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();
        assert_eq!(by, coach);
        assert_eq!(camp, camp_id);

        // Technique was added to the camp.
        let in_camp: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM camp_techniques WHERE camp_id = ? AND technique_id = ?",
        )
        .bind(camp_id)
        .bind(tech)
        .fetch_one(&db.pool)
        .await
        .unwrap();
        assert_eq!(in_camp, 1);

        // suggestion_decided activity emitted.
        let (verb, target): (String, i64) = sqlx::query_as(
            "SELECT verb, target_student_id FROM activity
             WHERE verb = 'suggestion_decided' ORDER BY id DESC LIMIT 1",
        )
        .fetch_one(&db.pool)
        .await
        .unwrap();
        assert_eq!(verb, "suggestion_decided");
        assert_eq!(target, student);
    }

    // -----------------------------------------------------------------------
    // replace
    // -----------------------------------------------------------------------

    #[rocket::async_test]
    async fn replace_adds_replacement_technique_to_camp() {
        let db = TestDbBuilder::new()
            .coach("coach", Some("Coach"))
            .student("student", Some("Sam"))
            .build()
            .await
            .unwrap();

        let coach = db.user_id("coach").unwrap();
        let student = db.user_id("student").unwrap();
        let tech = insert_technique(&db.pool, "buggy choke", coach).await;
        let replacement = insert_technique(&db.pool, "darce choke", coach).await;

        let camp_id = create_camp(
            &db.pool,
            NewCamp {
                student_id: student,
                coach_id: coach,
                name: "Comp prep".into(),
                description: None,
                references_camp_id: None,
            },
        )
        .await
        .unwrap();

        let sug_id = create_suggestion(&db.pool, student, tech, None, None)
            .await
            .unwrap();

        decide_suggestion(
            &db.pool,
            sug_id,
            coach,
            SuggestionDecision::Replace {
                replacement_technique_id: replacement,
                camp_id,
            },
        )
        .await
        .unwrap();

        // Status is "replaced".
        let status: String =
            sqlx::query_scalar("SELECT status FROM technique_suggestions WHERE id = ?")
                .bind(sug_id)
                .fetch_one(&db.pool)
                .await
                .unwrap();
        assert_eq!(status, "replaced");

        // replacement_technique_id stored.
        let stored_rep: i64 = sqlx::query_scalar(
            "SELECT replacement_technique_id FROM technique_suggestions WHERE id = ?",
        )
        .bind(sug_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();
        assert_eq!(stored_rep, replacement);

        // Replacement technique (not original) added to camp.
        let orig_in_camp: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM camp_techniques WHERE camp_id = ? AND technique_id = ?",
        )
        .bind(camp_id)
        .bind(tech)
        .fetch_one(&db.pool)
        .await
        .unwrap();
        assert_eq!(
            orig_in_camp, 0,
            "original technique must NOT be in camp on replace"
        );

        let rep_in_camp: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM camp_techniques WHERE camp_id = ? AND technique_id = ?",
        )
        .bind(camp_id)
        .bind(replacement)
        .fetch_one(&db.pool)
        .await
        .unwrap();
        assert_eq!(rep_in_camp, 1, "replacement technique must be in camp");
    }

    // -----------------------------------------------------------------------
    // dismiss
    // -----------------------------------------------------------------------

    #[rocket::async_test]
    async fn dismiss_sets_status_and_emits_no_camp_change() {
        let db = TestDbBuilder::new()
            .coach("coach", Some("Coach"))
            .student("student", Some("Sam"))
            .build()
            .await
            .unwrap();

        let coach = db.user_id("coach").unwrap();
        let student = db.user_id("student").unwrap();
        let tech = insert_technique(&db.pool, "wristlock", coach).await;

        let sug_id = create_suggestion(&db.pool, student, tech, None, None)
            .await
            .unwrap();

        decide_suggestion(&db.pool, sug_id, coach, SuggestionDecision::Dismiss)
            .await
            .unwrap();

        let status: String =
            sqlx::query_scalar("SELECT status FROM technique_suggestions WHERE id = ?")
                .bind(sug_id)
                .fetch_one(&db.pool)
                .await
                .unwrap();
        assert_eq!(status, "dismissed");

        // No camp_techniques rows created.
        let camp_rows: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM camp_techniques")
            .fetch_one(&db.pool)
            .await
            .unwrap();
        assert_eq!(camp_rows, 0);

        // suggestion_decided activity still emitted.
        let verb: String = sqlx::query_scalar(
            "SELECT verb FROM activity WHERE verb = 'suggestion_decided' ORDER BY id DESC LIMIT 1",
        )
        .fetch_one(&db.pool)
        .await
        .unwrap();
        assert_eq!(verb, "suggestion_decided");
    }

    // -----------------------------------------------------------------------
    // double-decide guard
    // -----------------------------------------------------------------------

    #[rocket::async_test]
    async fn deciding_already_decided_suggestion_returns_error() {
        let db = TestDbBuilder::new()
            .coach("coach", Some("Coach"))
            .student("student", Some("Sam"))
            .build()
            .await
            .unwrap();

        let coach = db.user_id("coach").unwrap();
        let student = db.user_id("student").unwrap();
        let tech = insert_technique(&db.pool, "heel hook", coach).await;

        let sug_id = create_suggestion(&db.pool, student, tech, None, None)
            .await
            .unwrap();

        // First decision succeeds.
        decide_suggestion(&db.pool, sug_id, coach, SuggestionDecision::Dismiss)
            .await
            .unwrap();

        // Second decision on the same suggestion must fail.
        let err = decide_suggestion(&db.pool, sug_id, coach, SuggestionDecision::Dismiss).await;
        assert!(
            matches!(err, Err(AppError::NotFound(_))),
            "expected NotFound for already-decided suggestion, got {:?}",
            err
        );
    }

    // -----------------------------------------------------------------------
    // list_suggestions_for_student
    // -----------------------------------------------------------------------

    #[rocket::async_test]
    async fn list_suggestions_for_student_returns_all_statuses() {
        let db = TestDbBuilder::new()
            .coach("coach", Some("Coach"))
            .student("student", Some("Sam"))
            .build()
            .await
            .unwrap();

        let coach = db.user_id("coach").unwrap();
        let student = db.user_id("student").unwrap();
        let tech1 = insert_technique(&db.pool, "omo plata", coach).await;
        let tech2 = insert_technique(&db.pool, "berimbolo", coach).await;

        let id1 = create_suggestion(&db.pool, student, tech1, None, None)
            .await
            .unwrap();
        let _id2 = create_suggestion(&db.pool, student, tech2, None, None)
            .await
            .unwrap();

        // Dismiss id1 so we have a mix of statuses.
        decide_suggestion(&db.pool, id1, coach, SuggestionDecision::Dismiss)
            .await
            .unwrap();

        let list = list_suggestions_for_student(&db.pool, student).await.unwrap();
        assert_eq!(list.len(), 2);
        // Newest first: id2 (pending) then id1 (dismissed).
        assert_eq!(list[0].status, "pending");
        assert_eq!(list[1].status, "dismissed");
    }
}
