#[cfg(test)]
mod tests {
    use crate::db::{NewActivity, Verb, emit};
    use crate::test::test_utils::TestDbBuilder;

    #[rocket::async_test]
    async fn emit_inserts_one_row() {
        let db = TestDbBuilder::new()
            .coach("coach", None)
            .student("alice", None)
            .build()
            .await
            .unwrap();
        let coach = db.user_id("coach").unwrap();
        let alice = db.user_id("alice").unwrap();

        let mut tx = db.pool.begin().await.unwrap();
        emit(
            &mut tx,
            NewActivity::new(Verb::SyllabusAssigned, coach).target_student(alice),
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();

        let row = sqlx::query!(
            r#"SELECT verb AS "verb!: String",
                      actor_user_id AS "actor_user_id!: i64",
                      target_student_id AS "target_student_id?: i64"
               FROM activity"#
        )
        .fetch_one(&db.pool)
        .await
        .unwrap();
        assert_eq!(row.verb, "syllabus_assigned");
        assert_eq!(row.actor_user_id, coach);
        assert_eq!(row.target_student_id, Some(alice));
    }

    #[rocket::async_test]
    async fn two_same_key_emits_within_window_coalesce_to_one_row() {
        let db = TestDbBuilder::new()
            .coach("coach", None)
            .student("alice", None)
            .technique("Armbar", "", Some("coach"))
            .build()
            .await
            .unwrap();
        let alice = db.user_id("alice").unwrap();
        let armbar = db.technique_id("Armbar").unwrap();

        for _ in 0..2 {
            let mut tx = db.pool.begin().await.unwrap();
            emit(
                &mut tx,
                NewActivity::new(Verb::TechniquePinned, alice)
                    .target_student(alice)
                    .technique(armbar),
            )
            .await
            .unwrap();
            tx.commit().await.unwrap();
        }

        let count = sqlx::query_scalar!(r#"SELECT COUNT(*) AS "c!: i64" FROM activity"#)
            .fetch_one(&db.pool)
            .await
            .unwrap();
        assert_eq!(count, 1, "same-key emits within 30s coalesce");
    }

    #[rocket::async_test]
    async fn different_target_does_not_coalesce() {
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

        for student in [alice, bob] {
            let mut tx = db.pool.begin().await.unwrap();
            emit(
                &mut tx,
                NewActivity::new(Verb::TechniqueEdited, coach)
                    .target_student(student)
                    .technique(armbar),
            )
            .await
            .unwrap();
            tx.commit().await.unwrap();
        }

        let count = sqlx::query_scalar!(r#"SELECT COUNT(*) AS "c!: i64" FROM activity"#)
            .fetch_one(&db.pool)
            .await
            .unwrap();
        assert_eq!(count, 2, "different target_student_id does not coalesce");
    }

    #[rocket::async_test]
    async fn status_change_coalesce_keeps_original_from_takes_latest_to() {
        use crate::db::payload;
        let db = TestDbBuilder::new()
            .coach("coach", None)
            .student("alice", None)
            .technique("Armbar", "", Some("coach"))
            .build()
            .await
            .unwrap();
        let alice = db.user_id("alice").unwrap();

        // Seed an SST to reference. Minimal direct insert: a syllabus + assignment + sst.
        let coach = db.user_id("coach").unwrap();
        let sid = crate::db::create_syllabus(&db.pool, "S", None, coach)
            .await
            .unwrap();
        let aid = crate::db::assign(&db.pool, coach, alice, sid)
            .await
            .unwrap();
        let armbar = db.technique_id("Armbar").unwrap();
        let sst_id = crate::db::add_technique_to_assignment(&db.pool, aid, armbar)
            .await
            .unwrap();

        for (from, to) in [("red", "amber"), ("amber", "green")] {
            let mut tx = db.pool.begin().await.unwrap();
            emit(
                &mut tx,
                NewActivity::new(Verb::SstStatusChanged, alice)
                    .target_student(alice)
                    .sst(sst_id)
                    .payload(payload::status_changed(from, to)),
            )
            .await
            .unwrap();
            tx.commit().await.unwrap();
        }

        let row =
            sqlx::query!(r#"SELECT payload_json FROM activity WHERE verb = 'sst_status_changed'"#)
                .fetch_one(&db.pool)
                .await
                .unwrap();
        let v: serde_json::Value = serde_json::from_str(&row.payload_json.unwrap()).unwrap();
        assert_eq!(v["from"], "red", "keeps original from");
        assert_eq!(v["to"], "green", "takes latest to");
    }
}
