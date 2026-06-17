#[cfg(test)]
mod tests {
    use crate::db::competitions::{create_competition, register_student};
    use crate::db::create_technique;
    use crate::db::matches::{
        can_manage_match, create_match, delete_match, get_match, link_match_technique,
        list_match_techniques, list_matches_for_registration, list_matches_for_student,
        unlink_match_technique, update_match, MatchMethod, MatchResult,
    };
    use crate::test::test_utils::TestDbBuilder;

    // -----------------------------------------------------------------------
    // Enum round-trips
    // -----------------------------------------------------------------------

    #[test]
    fn match_result_from_str_roundtrip() {
        for (s, expected) in &[
            ("win", MatchResult::Win),
            ("loss", MatchResult::Loss),
            ("draw", MatchResult::Draw),
        ] {
            let parsed = MatchResult::from_str_result(s).expect("valid result string");
            assert_eq!(parsed, *expected);
            assert_eq!(parsed.as_str(), *s);
        }
        assert!(MatchResult::from_str_result("invalid").is_none());
        assert!(MatchResult::from_str_result("WIN").is_none());
    }

    #[test]
    fn match_method_from_str_roundtrip() {
        for (s, expected) in &[
            ("submission", MatchMethod::Submission),
            ("points", MatchMethod::Points),
            ("decision", MatchMethod::Decision),
            ("dq", MatchMethod::Dq),
            ("other", MatchMethod::Other),
        ] {
            let parsed = MatchMethod::from_str_method(s).expect("valid method string");
            assert_eq!(parsed, *expected);
            assert_eq!(parsed.as_str(), *s);
        }
        assert!(MatchMethod::from_str_method("nope").is_none());
        assert!(MatchMethod::from_str_method("Submission").is_none());
    }

    // -----------------------------------------------------------------------
    // can_manage_match truth table
    // -----------------------------------------------------------------------

    #[test]
    fn can_manage_match_truth_table() {
        // Coach can always manage (regardless of student ownership).
        assert!(can_manage_match(true, 99, 1));
        assert!(can_manage_match(true, 1, 1));
        assert!(can_manage_match(true, 2, 1));

        // Student can only manage their own match.
        assert!(can_manage_match(false, 1, 1));

        // Other student cannot.
        assert!(!can_manage_match(false, 2, 1));
        assert!(!can_manage_match(false, 99, 1));
    }

    // -----------------------------------------------------------------------
    // create / get / list
    // -----------------------------------------------------------------------

    #[rocket::async_test]
    async fn create_get_list_match() {
        let db = TestDbBuilder::new()
            .coach("coach_user", Some("Coach"))
            .student("student_user", Some("Sam"))
            .build()
            .await
            .unwrap();

        let coach = db.user_id("coach_user").unwrap();
        let student = db.user_id("student_user").unwrap();

        let comp_id = create_competition(&db.pool, "Pan Ams 2026", None, coach)
            .await
            .unwrap();
        let reg_id = register_student(&db.pool, comp_id, student, coach)
            .await
            .unwrap();

        // Create a win by submission with a date.
        let match_id = create_match(
            &db.pool,
            reg_id,
            MatchResult::Win,
            Some(MatchMethod::Submission),
            Some("kimura from north-south"),
            Some("2026-06-01T10:00:00"),
            coach,
        )
        .await
        .unwrap();

        // get_match returns the row.
        let m = get_match(&db.pool, match_id).await.unwrap().unwrap();
        assert_eq!(m.id, match_id);
        assert_eq!(m.registration_id, reg_id);
        assert_eq!(m.result, MatchResult::Win);
        assert_eq!(m.method, Some(MatchMethod::Submission));
        assert_eq!(m.method_detail.as_deref(), Some("kimura from north-south"));
        assert_eq!(m.occurred_at.as_deref(), Some("2026-06-01T10:00:00"));
        assert_eq!(m.created_by_id, coach);

        // get_match returns None for unknown id.
        assert!(get_match(&db.pool, 9999).await.unwrap().is_none());

        // list_matches_for_registration shows the match.
        let list = list_matches_for_registration(&db.pool, reg_id)
            .await
            .unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, match_id);

        // Create a second match (no method, no date).
        let match_id2 = create_match(
            &db.pool,
            reg_id,
            MatchResult::Loss,
            None,
            None,
            None,
            coach,
        )
        .await
        .unwrap();

        let list = list_matches_for_registration(&db.pool, reg_id)
            .await
            .unwrap();
        assert_eq!(list.len(), 2);
        // Newest first: match_id2 was created after match_id.
        assert_eq!(list[0].id, match_id2);
    }

    // -----------------------------------------------------------------------
    // update
    // -----------------------------------------------------------------------

    #[rocket::async_test]
    async fn update_match_and_not_found() {
        let db = TestDbBuilder::new()
            .coach("coach_user", Some("Coach"))
            .student("student_user", Some("Sam"))
            .build()
            .await
            .unwrap();

        let coach = db.user_id("coach_user").unwrap();
        let student = db.user_id("student_user").unwrap();

        let comp_id = create_competition(&db.pool, "Worlds 2026", None, coach)
            .await
            .unwrap();
        let reg_id = register_student(&db.pool, comp_id, student, coach)
            .await
            .unwrap();

        let match_id = create_match(
            &db.pool,
            reg_id,
            MatchResult::Win,
            Some(MatchMethod::Points),
            None,
            None,
            coach,
        )
        .await
        .unwrap();

        // Update to draw by decision with detail.
        update_match(
            &db.pool,
            match_id,
            MatchResult::Draw,
            Some(MatchMethod::Decision),
            Some("ref decision"),
            Some("2026-06-10T09:00:00"),
        )
        .await
        .unwrap();

        let m = get_match(&db.pool, match_id).await.unwrap().unwrap();
        assert_eq!(m.result, MatchResult::Draw);
        assert_eq!(m.method, Some(MatchMethod::Decision));
        assert_eq!(m.method_detail.as_deref(), Some("ref decision"));
        assert_eq!(m.occurred_at.as_deref(), Some("2026-06-10T09:00:00"));

        // Update a non-existent id returns NotFound.
        let err = update_match(
            &db.pool,
            9999,
            MatchResult::Win,
            None,
            None,
            None,
        )
        .await;
        assert!(
            matches!(err, Err(crate::error::AppError::NotFound(_))),
            "expected NotFound, got {:?}",
            err
        );
    }

    // -----------------------------------------------------------------------
    // delete
    // -----------------------------------------------------------------------

    #[rocket::async_test]
    async fn delete_match_removes_row() {
        let db = TestDbBuilder::new()
            .coach("coach_user", Some("Coach"))
            .student("student_user", Some("Sam"))
            .build()
            .await
            .unwrap();

        let coach = db.user_id("coach_user").unwrap();
        let student = db.user_id("student_user").unwrap();

        let comp_id = create_competition(&db.pool, "Euro Open 2026", None, coach)
            .await
            .unwrap();
        let reg_id = register_student(&db.pool, comp_id, student, coach)
            .await
            .unwrap();

        let match_id = create_match(
            &db.pool,
            reg_id,
            MatchResult::Loss,
            None,
            None,
            None,
            coach,
        )
        .await
        .unwrap();

        delete_match(&db.pool, match_id).await.unwrap();

        assert!(get_match(&db.pool, match_id).await.unwrap().is_none());
    }

    // -----------------------------------------------------------------------
    // link / unlink technique
    // -----------------------------------------------------------------------

    #[rocket::async_test]
    async fn link_unlink_technique_emit_once() {
        let db = TestDbBuilder::new()
            .coach("coach_user", Some("Coach"))
            .student("student_user", Some("Sam"))
            .build()
            .await
            .unwrap();

        let coach = db.user_id("coach_user").unwrap();
        let student = db.user_id("student_user").unwrap();

        let comp_id = create_competition(&db.pool, "Gi Nats 2026", None, coach)
            .await
            .unwrap();
        let reg_id = register_student(&db.pool, comp_id, student, coach)
            .await
            .unwrap();

        let match_id = create_match(
            &db.pool,
            reg_id,
            MatchResult::Win,
            Some(MatchMethod::Submission),
            None,
            None,
            coach,
        )
        .await
        .unwrap();

        let technique_id = create_technique(
            &db.pool,
            "Kimura",
            "Kimura shoulder lock",
            coach,
            true,
        )
        .await
        .unwrap();

        // First link: should emit MatchTechniqueLinked.
        link_match_technique(&db.pool, match_id, technique_id, coach)
            .await
            .unwrap();

        let linked = list_match_techniques(&db.pool, match_id)
            .await
            .unwrap();
        assert_eq!(linked.len(), 1);
        assert_eq!(linked[0].technique_id, technique_id);
        assert_eq!(linked[0].name, "Kimura");

        // Confirm activity row was emitted.
        let activity_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM activity WHERE verb = 'match_technique_linked'",
        )
        .fetch_one(&db.pool)
        .await
        .unwrap();
        assert_eq!(activity_count, 1, "should have exactly one activity row");

        // Re-link same technique: INSERT OR IGNORE, no new activity row.
        link_match_technique(&db.pool, match_id, technique_id, coach)
            .await
            .unwrap();

        let linked = list_match_techniques(&db.pool, match_id)
            .await
            .unwrap();
        assert_eq!(linked.len(), 1, "still one link after duplicate");

        let activity_count_after: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM activity WHERE verb = 'match_technique_linked'",
        )
        .fetch_one(&db.pool)
        .await
        .unwrap();
        assert_eq!(
            activity_count_after, 1,
            "no extra activity row on duplicate link"
        );

        // Unlink.
        unlink_match_technique(&db.pool, match_id, technique_id)
            .await
            .unwrap();

        let linked = list_match_techniques(&db.pool, match_id)
            .await
            .unwrap();
        assert!(linked.is_empty(), "technique should be unlinked");
    }

    // -----------------------------------------------------------------------
    // list_matches_for_student aggregate (CC-031)
    // -----------------------------------------------------------------------

    #[rocket::async_test]
    async fn list_matches_for_student_aggregate() {
        let db = TestDbBuilder::new()
            .coach("coach_user", Some("Coach"))
            .student("student_user", Some("Sam"))
            .build()
            .await
            .unwrap();

        let coach = db.user_id("coach_user").unwrap();
        let student = db.user_id("student_user").unwrap();

        // Two competitions, two registrations.
        let comp1_id = create_competition(&db.pool, "Euro Open 2026", Some("2026-03-15"), coach)
            .await
            .unwrap();
        let comp2_id = create_competition(&db.pool, "Pan Ams 2026", Some("2026-05-01"), coach)
            .await
            .unwrap();

        let reg1_id = register_student(&db.pool, comp1_id, student, coach)
            .await
            .unwrap();
        let reg2_id = register_student(&db.pool, comp2_id, student, coach)
            .await
            .unwrap();

        // Create a camp for comp1 (linked to the competition).
        let camp_id: i64 = sqlx::query_scalar(
            "INSERT INTO camps (student_id, coach_id, name, competition_id)
             VALUES (?, ?, 'Euro prep', ?) RETURNING id",
        )
        .bind(student)
        .bind(coach)
        .bind(comp1_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        // Log matches: comp1 has one match with a date; comp2 has one without.
        let match1_id = create_match(
            &db.pool,
            reg1_id,
            MatchResult::Win,
            Some(MatchMethod::Submission),
            None,
            Some("2026-03-15T10:00:00"),
            coach,
        )
        .await
        .unwrap();

        let match2_id = create_match(
            &db.pool,
            reg2_id,
            MatchResult::Loss,
            None,
            None,
            None, // no date
            coach,
        )
        .await
        .unwrap();

        let all = list_matches_for_student(&db.pool, student)
            .await
            .unwrap();

        assert_eq!(all.len(), 2);

        // Dated match (match1) sorts before undated (match2).
        assert_eq!(all[0].id, match1_id);
        assert_eq!(all[0].competition_id, comp1_id);
        assert_eq!(all[0].competition_name, "Euro Open 2026");
        assert_eq!(all[0].camp_id, Some(camp_id));

        assert_eq!(all[1].id, match2_id);
        assert_eq!(all[1].competition_id, comp2_id);
        assert_eq!(all[1].competition_name, "Pan Ams 2026");
        assert!(all[1].camp_id.is_none());

        // Another student's match should not appear.
        let other_matches = list_matches_for_student(&db.pool, coach)
            .await
            .unwrap();
        assert!(other_matches.is_empty());
    }

    // -----------------------------------------------------------------------
    // Activity row for create_match
    // -----------------------------------------------------------------------

    #[rocket::async_test]
    async fn create_match_emits_match_logged_activity() {
        let db = TestDbBuilder::new()
            .coach("coach_user", Some("Coach"))
            .student("student_user", Some("Sam"))
            .build()
            .await
            .unwrap();

        let coach = db.user_id("coach_user").unwrap();
        let student = db.user_id("student_user").unwrap();

        let comp_id = create_competition(&db.pool, "Activity Test", None, coach)
            .await
            .unwrap();
        let reg_id = register_student(&db.pool, comp_id, student, coach)
            .await
            .unwrap();

        let match_id = create_match(
            &db.pool,
            reg_id,
            MatchResult::Win,
            None,
            None,
            None,
            coach,
        )
        .await
        .unwrap();

        let (verb, target, got_match, got_comp): (String, i64, i64, i64) = sqlx::query_as(
            "SELECT verb, target_student_id, match_id, competition_id
             FROM activity
             WHERE verb = 'match_logged'
             ORDER BY id DESC LIMIT 1",
        )
        .fetch_one(&db.pool)
        .await
        .unwrap();

        assert_eq!(verb, "match_logged");
        assert_eq!(target, student);
        assert_eq!(got_match, match_id);
        assert_eq!(got_comp, comp_id);
    }
}
