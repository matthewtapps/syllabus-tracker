#[cfg(test)]
mod tests {
    use crate::auth::{Role, User};
    use crate::db::{
        SstUpdate, add_technique_to_assignment, assign, create_syllabus,
        get_students_by_recent_updates, update_sst,
    };
    use crate::test::test_utils::TestDbBuilder;

    fn coach_actor(id: i64) -> User {
        User {
            id,
            username: "c".into(),
            role: Role::Coach,
            display_name: String::new(),
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
        }
    }
    fn student_actor(id: i64) -> User {
        let mut u = coach_actor(id);
        u.role = Role::Student;
        u
    }

    #[rocket::async_test]
    async fn counts_sum_across_active_syllabi_not_distinct() {
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

        // Two syllabi, both assigned to alice, both containing Armbar -> 2 SST rows
        // for the same technique. Counts must SUM (total 2), not dedupe to 1.
        for name in ["S1", "S2"] {
            let sid = create_syllabus(&db.pool, name, None, coach).await.unwrap();
            let aid = assign(&db.pool, coach, alice, sid).await.unwrap();
            add_technique_to_assignment(&db.pool, aid, armbar, coach)
                .await
                .unwrap();
        }

        let students = get_students_by_recent_updates(&db.pool, false, coach)
            .await
            .unwrap();
        let alice_row = students.iter().find(|u| u.id == alice).unwrap();
        assert_eq!(alice_row.total_techniques, Some(2));
        assert_eq!(alice_row.red_count, Some(2)); // default status red
    }

    #[rocket::async_test]
    async fn recent_syllabus_attempts_scoped_to_student() {
        use crate::db::{
            CreateSyllabusAttempt, create_syllabus_attempt,
            list_recent_syllabus_attempts_for_student,
        };
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
        let sid = create_syllabus(&db.pool, "S", None, coach).await.unwrap();
        let aid = assign(&db.pool, coach, alice, sid).await.unwrap();
        let sst = add_technique_to_assignment(&db.pool, aid, armbar, coach)
            .await
            .unwrap();
        create_syllabus_attempt(
            &db.pool,
            &coach_actor(coach),
            sst,
            &CreateSyllabusAttempt {
                attempted_at: chrono::Utc::now().naive_utc(),
                coach_note: None,
                student_note: None,
            },
        )
        .await
        .unwrap();

        let recent = list_recent_syllabus_attempts_for_student(&db.pool, alice, 5)
            .await
            .unwrap();
        assert_eq!(recent.len(), 1);
        assert_eq!(recent[0].technique_name, "Armbar");
    }

    #[rocket::async_test]
    async fn flat_sst_list_spans_all_active_assignments() {
        use crate::db::list_sst_flat_for_student;
        let db = TestDbBuilder::new()
            .coach("coach", None)
            .student("alice", None)
            .technique("Armbar", "", Some("coach"))
            .technique("Triangle", "", Some("coach"))
            .build()
            .await
            .unwrap();
        let coach = db.user_id("coach").unwrap();
        let alice = db.user_id("alice").unwrap();

        // Two SEPARATE syllabi, each assigned to alice, each with one technique.
        // This proves the query spans across assignments, not just techniques
        // within a single assignment.
        let sid1 = create_syllabus(&db.pool, "S1", None, coach).await.unwrap();
        let aid1 = assign(&db.pool, coach, alice, sid1).await.unwrap();
        add_technique_to_assignment(&db.pool, aid1, db.technique_id("Armbar").unwrap(), coach)
            .await
            .unwrap();

        let sid2 = create_syllabus(&db.pool, "S2", None, coach).await.unwrap();
        let aid2 = assign(&db.pool, coach, alice, sid2).await.unwrap();
        add_technique_to_assignment(&db.pool, aid2, db.technique_id("Triangle").unwrap(), coach)
            .await
            .unwrap();

        let rows = list_sst_flat_for_student(&db.pool, alice).await.unwrap();
        assert_eq!(rows.len(), 2);
        assert!(rows.iter().all(|r| r.status == "red"));

        // Both distinct syllabus IDs must appear in the result set.
        let syllabus_ids: std::collections::HashSet<i64> =
            rows.iter().map(|r| r.syllabus_id).collect();
        assert!(syllabus_ids.contains(&sid1));
        assert!(syllabus_ids.contains(&sid2));
    }

    #[rocket::async_test]
    async fn recent_syllabus_attempts_excludes_other_students() {
        use crate::db::{
            CreateSyllabusAttempt, create_syllabus_attempt,
            list_recent_syllabus_attempts_for_student,
        };
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

        // Assign the same syllabus to both students, add the technique for each.
        let sid = create_syllabus(&db.pool, "S", None, coach).await.unwrap();

        let aid_alice = assign(&db.pool, coach, alice, sid).await.unwrap();
        let sst_alice = add_technique_to_assignment(&db.pool, aid_alice, armbar, coach)
            .await
            .unwrap();

        let aid_bob = assign(&db.pool, coach, bob, sid).await.unwrap();
        let sst_bob = add_technique_to_assignment(&db.pool, aid_bob, armbar, coach)
            .await
            .unwrap();

        let now = chrono::Utc::now().naive_utc();
        let attempt_input = CreateSyllabusAttempt {
            attempted_at: now,
            coach_note: None,
            student_note: None,
        };

        // Log one attempt for alice and one for bob.
        create_syllabus_attempt(&db.pool, &coach_actor(coach), sst_alice, &attempt_input)
            .await
            .unwrap();
        create_syllabus_attempt(&db.pool, &coach_actor(coach), sst_bob, &attempt_input)
            .await
            .unwrap();

        // Alice's feed must contain exactly her own attempt.
        let alice_recent = list_recent_syllabus_attempts_for_student(&db.pool, alice, 5)
            .await
            .unwrap();
        assert_eq!(alice_recent.len(), 1, "alice should see exactly 1 attempt");

        // Bob's attempt must NOT appear in alice's results.
        assert!(
            alice_recent.iter().all(|r| r.technique_name == "Armbar"),
            "unexpected technique in alice's attempts"
        );

        // Confirm bob's attempt does NOT leak into alice's result set by
        // checking via bob's own feed.
        let bob_recent = list_recent_syllabus_attempts_for_student(&db.pool, bob, 5)
            .await
            .unwrap();
        assert_eq!(bob_recent.len(), 1, "bob should see exactly 1 attempt");
    }

    #[rocket::async_test]
    async fn library_stats_status_counts_come_from_sst() {
        use crate::db::library_technique_stats;
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
        let sid = create_syllabus(&db.pool, "S", None, coach).await.unwrap();
        let aid = assign(&db.pool, coach, alice, sid).await.unwrap();
        let sst = add_technique_to_assignment(&db.pool, aid, armbar, coach)
            .await
            .unwrap();
        update_sst(
            &db.pool,
            sst,
            &student_actor(alice),
            &SstUpdate {
                status: Some("green".into()),
                ..Default::default()
            },
        )
        .await
        .unwrap();

        let stats = library_technique_stats(&db.pool, armbar).await.unwrap();
        assert_eq!(stats.status_counts.green, 1);
        assert_eq!(stats.status_counts.red, 0);
    }

    #[rocket::async_test]
    async fn unseen_flag_set_when_student_activity_newer_than_coach() {
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
        let sid = create_syllabus(&db.pool, "S", None, coach).await.unwrap();
        let aid = assign(&db.pool, coach, alice, sid).await.unwrap();
        let sst = add_technique_to_assignment(&db.pool, aid, armbar, coach)
            .await
            .unwrap();

        // Coach writes coach notes first, then the student writes student notes
        // (student activity is now the most recent) -> unseen = true.
        // A small sleep ensures the timestamps are strictly ordered.
        update_sst(
            &db.pool,
            sst,
            &coach_actor(coach),
            &SstUpdate {
                coach_notes: Some("c".into()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(1100)).await;
        update_sst(
            &db.pool,
            sst,
            &student_actor(alice),
            &SstUpdate {
                student_notes: Some("s".into()),
                ..Default::default()
            },
        )
        .await
        .unwrap();

        let students = get_students_by_recent_updates(&db.pool, false, coach)
            .await
            .unwrap();
        let alice_row = students.iter().find(|u| u.id == alice).unwrap();
        assert_eq!(alice_row.has_unseen_activity, Some(true));
    }
}
