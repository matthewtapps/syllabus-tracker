#[cfg(test)]
mod tests {
    use crate::db::{Verb, notifies};

    #[test]
    fn own_action_never_notifies() {
        // actor == viewer => false even for a notifiable verb in the feed.
        assert!(!notifies(Verb::AttemptLogged.as_str(), 5, 5, true));
    }

    #[test]
    fn non_notifiable_verb_never_notifies() {
        assert!(!notifies(Verb::AttemptDeleted.as_str(), 9, 5, true));
    }

    #[test]
    fn notifiable_other_actor_in_feed_notifies() {
        assert!(notifies(Verb::AttemptLogged.as_str(), 9, 5, true));
    }

    #[test]
    fn not_in_feed_never_notifies() {
        assert!(!notifies(Verb::AttemptLogged.as_str(), 9, 5, false));
    }
}
