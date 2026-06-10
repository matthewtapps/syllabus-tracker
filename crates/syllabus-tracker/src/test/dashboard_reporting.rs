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
