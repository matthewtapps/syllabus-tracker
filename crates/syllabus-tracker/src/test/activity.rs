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
}
