#[cfg(test)]
mod tests {
    use crate::{
        db::{
            add_tag_to_technique, create_tag, delete_tag, get_all_tags, get_tags_for_technique,
            remove_tag_from_technique,
        },
        test::test_utils::TestDbBuilder,
    };

    #[rocket::async_test]
    async fn test_create_and_get_tags() {
        let test_db = TestDbBuilder::new()
            .coach("coach_user", Some("Coach User"))
            .technique("Armbar", "Description of armbar", Some("coach_user"))
            .build()
            .await
            .expect("Failed to build test database");

        // Create tags
        create_tag(&test_db.pool, "Attack")
            .await
            .expect("Failed to create tag");
        create_tag(&test_db.pool, "Submission")
            .await
            .expect("Failed to create tag");
        create_tag(&test_db.pool, "No Gi")
            .await
            .expect("Failed to create tag");

        // Get all tags
        let all_tags = get_all_tags(&test_db.pool)
            .await
            .expect("Failed to get all tags");

        assert_eq!(all_tags.len(), 3);
        assert!(all_tags.iter().any(|t| t.name == "Attack"));
        assert!(all_tags.iter().any(|t| t.name == "Submission"));
        assert!(all_tags.iter().any(|t| t.name == "No Gi"));
    }

    #[rocket::async_test]
    async fn test_add_and_get_technique_tags() {
        let test_db = TestDbBuilder::new()
            .coach("coach_user", Some("Coach User"))
            .technique("Armbar", "Description of armbar", Some("coach_user"))
            .build()
            .await
            .expect("Failed to build test database");

        let technique_id = test_db.technique_id("Armbar").expect("Technique not found");

        let tag1_id = create_tag(&test_db.pool, "Attack")
            .await
            .expect("Failed to create tag");
        let tag2_id = create_tag(&test_db.pool, "Submission")
            .await
            .expect("Failed to create tag");

        add_tag_to_technique(&test_db.pool, technique_id, tag1_id)
            .await
            .expect("Failed to add tag to technique");
        add_tag_to_technique(&test_db.pool, technique_id, tag2_id)
            .await
            .expect("Failed to add tag to technique");

        let technique_tags = get_tags_for_technique(&test_db.pool, technique_id)
            .await
            .expect("Failed to get technique tags");

        assert_eq!(technique_tags.len(), 2);
        assert!(technique_tags.iter().any(|t| t.name == "Attack"));
        assert!(technique_tags.iter().any(|t| t.name == "Submission"));
    }

    #[rocket::async_test]
    async fn test_remove_technique_tag() {
        let test_db = TestDbBuilder::new()
            .coach("coach_user", Some("Coach User"))
            .technique("Armbar", "Description of armbar", Some("coach_user"))
            .build()
            .await
            .expect("Failed to build test database");

        let technique_id = test_db.technique_id("Armbar").expect("Technique not found");

        let tag_id = create_tag(&test_db.pool, "Attack")
            .await
            .expect("Failed to create tag");
        add_tag_to_technique(&test_db.pool, technique_id, tag_id)
            .await
            .expect("Failed to add tag to technique");

        remove_tag_from_technique(&test_db.pool, technique_id, tag_id)
            .await
            .expect("Failed to remove tag from technique");

        let technique_tags = get_tags_for_technique(&test_db.pool, technique_id)
            .await
            .expect("Failed to get technique tags");
        assert_eq!(technique_tags.len(), 0);
    }

    #[rocket::async_test]
    async fn test_delete_tag() {
        let test_db = TestDbBuilder::new()
            .coach("coach_user", Some("Coach User"))
            .technique("Armbar", "Description of armbar", Some("coach_user"))
            .technique("Triangle", "Description of triangle", Some("coach_user"))
            .build()
            .await
            .expect("Failed to build test database");

        let armbar_id = test_db.technique_id("Armbar").expect("Technique not found");
        let triangle_id = test_db
            .technique_id("Triangle")
            .expect("Technique not found");

        let tag_id = create_tag(&test_db.pool, "Submission")
            .await
            .expect("Failed to create tag");
        add_tag_to_technique(&test_db.pool, armbar_id, tag_id)
            .await
            .expect("Failed to add tag to armbar");
        add_tag_to_technique(&test_db.pool, triangle_id, tag_id)
            .await
            .expect("Failed to add tag to triangle");

        delete_tag(&test_db.pool, tag_id)
            .await
            .expect("Failed to delete tag");

        let armbar_tags = get_tags_for_technique(&test_db.pool, armbar_id)
            .await
            .expect("Failed to get armbar tags");
        let triangle_tags = get_tags_for_technique(&test_db.pool, triangle_id)
            .await
            .expect("Failed to get triangle tags");

        assert_eq!(armbar_tags.len(), 0);
        assert_eq!(triangle_tags.len(), 0);

        let all_tags = get_all_tags(&test_db.pool)
            .await
            .expect("Failed to get all tags");
        assert_eq!(all_tags.len(), 0);
    }

    #[rocket::async_test]
    async fn test_duplicate_tag() {
        let test_db = TestDbBuilder::new()
            .build()
            .await
            .expect("Failed to build test database");

        create_tag(&test_db.pool, "Attack")
            .await
            .expect("Failed to create tag");

        let result = create_tag(&test_db.pool, "Attack").await;
        assert!(result.is_err(), "Creating duplicate tag should fail");
    }

    #[rocket::async_test]
    async fn test_add_same_tag_twice() {
        let test_db = TestDbBuilder::new()
            .coach("coach_user", Some("Coach User"))
            .technique("Armbar", "Description of armbar", Some("coach_user"))
            .build()
            .await
            .expect("Failed to build test database");

        println!("db: {:?}", test_db);

        let technique_id = test_db.technique_id("Armbar").expect("Technique not found");

        // Create tag
        let tag_id = create_tag(&test_db.pool, "Attack")
            .await
            .expect("Failed to create tag");

        // Add tag to technique
        add_tag_to_technique(&test_db.pool, technique_id, tag_id)
            .await
            .expect("Failed to add tag to technique");

        // Try to add the same tag again
        let result = add_tag_to_technique(&test_db.pool, technique_id, tag_id).await;
        assert!(result.is_ok(), "Adding the same tag twice should not error");

        // Verify there's still only one tag
        let technique_tags = get_tags_for_technique(&test_db.pool, technique_id)
            .await
            .expect("Failed to get technique tags");
        assert_eq!(technique_tags.len(), 1);
    }
}
