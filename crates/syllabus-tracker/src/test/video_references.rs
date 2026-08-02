#[cfg(test)]
mod tests {
    use crate::db::{
        add_video_reference, create_processing_video, delete_video, get_video,
        list_referenced_videos, remove_video_reference, set_video_reference_hidden,
        ReferenceParent, VideoParent,
    };
    use crate::test::test_utils::TestDbBuilder;

    /// Two techniques and a clip owned by the first, so it can be referenced
    /// onto the second.
    async fn fixture() -> (crate::test::test_utils::TestDb, i64, i64, i64, i64) {
        let db = TestDbBuilder::new()
            .coach("coach_user", Some("Coach"))
            .technique("Armbar", "", None)
            .technique("Triangle", "", None)
            .build()
            .await
            .unwrap();
        let coach_id = db.user_id("coach_user").unwrap();
        let home = db.technique_id("Armbar").unwrap();
        let away = db.technique_id("Triangle").unwrap();
        let video_id = create_processing_video(
            &db.pool,
            VideoParent::Technique(home),
            "Demo",
            None,
            coach_id,
        )
        .await
        .unwrap();
        (db, coach_id, home, away, video_id)
    }

    #[rocket::async_test]
    async fn a_referenced_clip_shows_on_the_destination() {
        let (db, coach_id, _home, away, video_id) = fixture().await;

        add_video_reference(
            &db.pool,
            video_id,
            ReferenceParent::Technique(away),
            None,
            coach_id,
        )
        .await
        .unwrap();

        let listed = list_referenced_videos(&db.pool, ReferenceParent::Technique(away))
            .await
            .unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].video.id, video_id);
        assert!(listed[0].hidden_at.is_none());
    }

    #[rocket::async_test]
    async fn referencing_the_same_clip_twice_is_the_same_reference() {
        let (db, coach_id, _home, away, video_id) = fixture().await;

        let first = add_video_reference(
            &db.pool,
            video_id,
            ReferenceParent::Technique(away),
            None,
            coach_id,
        )
        .await
        .unwrap();
        let second = add_video_reference(
            &db.pool,
            video_id,
            ReferenceParent::Technique(away),
            None,
            coach_id,
        )
        .await
        .unwrap();

        assert_eq!(first, second);
        let listed = list_referenced_videos(&db.pool, ReferenceParent::Technique(away))
            .await
            .unwrap();
        assert_eq!(listed.len(), 1);
    }

    #[rocket::async_test]
    async fn a_clip_cannot_be_referenced_onto_its_own_parent() {
        let (db, coach_id, home, _away, video_id) = fixture().await;

        let err = add_video_reference(
            &db.pool,
            video_id,
            ReferenceParent::Technique(home),
            None,
            coach_id,
        )
        .await
        .unwrap_err();

        assert!(matches!(err, crate::error::AppError::Validation(_)));
    }

    #[rocket::async_test]
    async fn hiding_a_reference_leaves_the_original_alone() {
        let (db, coach_id, _home, away, video_id) = fixture().await;
        let reference_id = add_video_reference(
            &db.pool,
            video_id,
            ReferenceParent::Technique(away),
            None,
            coach_id,
        )
        .await
        .unwrap();

        set_video_reference_hidden(&db.pool, reference_id, true)
            .await
            .unwrap();

        let listed = list_referenced_videos(&db.pool, ReferenceParent::Technique(away))
            .await
            .unwrap();
        assert!(
            listed[0].hidden_at.is_some(),
            "the reference is hidden at its destination"
        );
        let original = get_video(&db.pool, video_id).await.unwrap().unwrap();
        assert!(
            original.hidden_at.is_none(),
            "the clip itself is untouched in its home surface"
        );
    }

    #[rocket::async_test]
    async fn a_clip_deleted_at_its_source_drops_out_of_the_destination() {
        let (db, coach_id, _home, away, video_id) = fixture().await;
        add_video_reference(
            &db.pool,
            video_id,
            ReferenceParent::Technique(away),
            None,
            coach_id,
        )
        .await
        .unwrap();

        delete_video(&db.pool, video_id).await.unwrap();

        let listed = list_referenced_videos(&db.pool, ReferenceParent::Technique(away))
            .await
            .unwrap();
        assert!(listed.is_empty());
    }

    #[rocket::async_test]
    async fn a_students_syllabus_read_sees_a_reference_until_it_is_hidden() {
        use crate::db::list_videos_for_technique_in_syllabus_visible_to;

        let db = TestDbBuilder::new()
            .coach("coach_user", Some("Coach"))
            .student("alice", None)
            .technique("Armbar", "", None)
            .technique("Triangle", "", None)
            .build()
            .await
            .unwrap();
        let coach_id = db.user_id("coach_user").unwrap();
        let alice = db.user_id("alice").unwrap();
        let home = db.technique_id("Armbar").unwrap();
        let away = db.technique_id("Triangle").unwrap();

        let syllabus_id: i64 = sqlx::query_scalar!(
            "INSERT INTO syllabi (name, created_by_id) VALUES ('Blue Belt', ?) RETURNING id AS \"id!\"",
            coach_id
        )
        .fetch_one(&db.pool)
        .await
        .unwrap();
        sqlx::query!(
            "INSERT INTO syllabus_techniques (syllabus_id, technique_id, position, added_by_id)
             VALUES (?, ?, 0, ?)",
            syllabus_id,
            away,
            coach_id
        )
        .execute(&db.pool)
        .await
        .unwrap();
        let assignment_id: i64 = sqlx::query_scalar!(
            "INSERT INTO syllabus_assignments (student_id, syllabus_id, assigned_by_id)
             VALUES (?, ?, ?) RETURNING id AS \"id!\"",
            alice,
            syllabus_id,
            coach_id
        )
        .fetch_one(&db.pool)
        .await
        .unwrap();
        sqlx::query!(
            "INSERT INTO student_syllabus_techniques (assignment_id, technique_id)
             VALUES (?, ?)",
            assignment_id,
            away
        )
        .execute(&db.pool)
        .await
        .unwrap();

        // A clip owned by one technique, referenced onto the one she studies.
        let video_id = create_processing_video(
            &db.pool,
            VideoParent::Technique(home),
            "Demo",
            None,
            coach_id,
        )
        .await
        .unwrap();
        let reference_id = add_video_reference(
            &db.pool,
            video_id,
            ReferenceParent::Technique(away),
            None,
            coach_id,
        )
        .await
        .unwrap();

        let visible =
            list_videos_for_technique_in_syllabus_visible_to(&db.pool, away, syllabus_id, alice)
                .await
                .unwrap();
        assert_eq!(
            visible.iter().map(|v| v.id).collect::<Vec<_>>(),
            vec![video_id],
        );

        set_video_reference_hidden(&db.pool, reference_id, true)
            .await
            .unwrap();

        let visible =
            list_videos_for_technique_in_syllabus_visible_to(&db.pool, away, syllabus_id, alice)
                .await
                .unwrap();
        assert!(visible.is_empty(), "a hidden reference is not shown here");
    }

    #[rocket::async_test]
    async fn removing_a_reference_leaves_the_clip_in_place() {
        let (db, coach_id, _home, away, video_id) = fixture().await;
        let reference_id = add_video_reference(
            &db.pool,
            video_id,
            ReferenceParent::Technique(away),
            None,
            coach_id,
        )
        .await
        .unwrap();

        remove_video_reference(&db.pool, reference_id).await.unwrap();

        assert!(
            list_referenced_videos(&db.pool, ReferenceParent::Technique(away))
                .await
                .unwrap()
                .is_empty()
        );
        assert!(get_video(&db.pool, video_id).await.unwrap().is_some());
    }
}
