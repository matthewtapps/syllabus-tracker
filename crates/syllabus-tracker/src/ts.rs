//! chrono-identical text forms for timestamps, in storage and JSON. Bind `sql`/`rfc3339`
//! strings, not a raw `OffsetDateTime`: sqlx's time encoding differs from chrono's.

use std::fmt::Write;

use serde::Serializer;
use time::format_description::well_known::Rfc3339;
use time::macros::format_description;
use time::{Date, OffsetDateTime, UtcOffset};

fn naive(dt: OffsetDateTime, sep: char) -> String {
    let dt = dt.to_offset(UtcOffset::UTC);
    let mut s = format!(
        "{:04}-{:02}-{:02}{sep}{:02}:{:02}:{:02}",
        dt.year(),
        u8::from(dt.month()),
        dt.day(),
        dt.hour(),
        dt.minute(),
        dt.second()
    );
    let ns = dt.nanosecond();
    let _ = if ns == 0 {
        Ok(())
    } else if ns.is_multiple_of(1_000_000) {
        write!(s, ".{:03}", ns / 1_000_000)
    } else if ns.is_multiple_of(1_000) {
        write!(s, ".{:06}", ns / 1_000)
    } else {
        write!(s, ".{ns:09}")
    };
    s
}

/// `YYYY-MM-DD HH:MM:SS[.fff]`, chrono's `NaiveDateTime` sqlite encoding.
pub fn sql(dt: OffsetDateTime) -> String {
    naive(dt, ' ')
}

/// `YYYY-MM-DDTHH:MM:SS[.fff]+00:00`, chrono's `to_rfc3339` and `DateTime<Utc>` sqlite encoding.
pub fn rfc3339(dt: OffsetDateTime) -> String {
    naive(dt, 'T') + "+00:00"
}

pub fn date(d: Date) -> String {
    format!("{:04}-{:02}-{:02}", d.year(), u8::from(d.month()), d.day())
}

pub fn parse_date(s: &str) -> Result<Date, time::error::Parse> {
    Date::parse(s, format_description!("[year]-[month]-[day]"))
}

pub fn parse_rfc3339(s: &str) -> Result<OffsetDateTime, time::error::Parse> {
    OffsetDateTime::parse(s, &Rfc3339).map(|dt| dt.to_offset(UtcOffset::UTC))
}

/// Serde for chrono's `DateTime<Utc>` JSON form: `YYYY-MM-DDTHH:MM:SS[.fff]Z`.
pub mod utc {
    use super::*;

    pub fn serialize<S: Serializer>(dt: &OffsetDateTime, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&(naive(*dt, 'T') + "Z"))
    }

    pub mod option {
        use super::*;

        pub fn serialize<S: Serializer>(
            dt: &Option<OffsetDateTime>,
            s: S,
        ) -> Result<S::Ok, S::Error> {
            match dt {
                Some(dt) => super::serialize(dt, s),
                None => s.serialize_none(),
            }
        }
    }
}

/// Serde for chrono's `NaiveDateTime` JSON form: `YYYY-MM-DDTHH:MM:SS[.fff]`.
pub mod naive_iso {
    use super::*;

    pub fn serialize<S: Serializer>(dt: &OffsetDateTime, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&naive(*dt, 'T'))
    }

    pub mod option {
        use super::*;

        pub fn serialize<S: Serializer>(
            dt: &Option<OffsetDateTime>,
            s: S,
        ) -> Result<S::Ok, S::Error> {
            match dt {
                Some(dt) => super::serialize(dt, s),
                None => s.serialize_none(),
            }
        }
    }
}

/// Serde for chrono's `NaiveDate` JSON form: `YYYY-MM-DD`.
pub mod date_iso {
    use super::*;

    pub fn serialize<S: Serializer>(d: &Date, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&date(*d))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use time::macros::datetime;

    #[test]
    fn matches_chrono_forms() {
        let whole = datetime!(2026-11-21 10:00:00 UTC);
        let ms = datetime!(2026-11-21 10:00:00.120 UTC);
        let us = datetime!(2026-11-21 10:00:00.123400 UTC);
        let ns = datetime!(2026-11-21 10:00:00.123456789 UTC);
        let local = datetime!(2026-11-21 20:00:00 +10:00);

        assert_eq!(sql(whole), "2026-11-21 10:00:00");
        assert_eq!(sql(ms), "2026-11-21 10:00:00.120");
        assert_eq!(sql(us), "2026-11-21 10:00:00.123400");
        assert_eq!(sql(ns), "2026-11-21 10:00:00.123456789");
        assert_eq!(sql(local), "2026-11-21 10:00:00");
        assert_eq!(rfc3339(ms), "2026-11-21T10:00:00.120+00:00");
        assert_eq!(date(whole.date()), "2026-11-21");

        #[derive(serde::Serialize)]
        struct Wire {
            #[serde(with = "utc")]
            utc: OffsetDateTime,
            #[serde(with = "utc::option")]
            utc_none: Option<OffsetDateTime>,
            #[serde(with = "naive_iso")]
            naive: OffsetDateTime,
            #[serde(with = "date_iso")]
            date: Date,
        }
        let json = serde_json::to_string(&Wire {
            utc: ms,
            utc_none: None,
            naive: whole,
            date: whole.date(),
        })
        .unwrap();
        assert_eq!(
            json,
            r#"{"utc":"2026-11-21T10:00:00.120Z","utc_none":null,"naive":"2026-11-21T10:00:00","date":"2026-11-21"}"#
        );
    }

    #[tokio::test]
    async fn decodes_legacy_stored_forms() {
        let pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        let ms = datetime!(2026-11-21 10:00:00.120 UTC);
        for stored in [
            "2026-11-21 10:00:00.120",
            "2026-11-21T10:00:00.120",
            "2026-11-21T10:00:00.120Z",
            "2026-11-21T10:00:00.120+00:00",
            "2026-11-21T20:00:00.120+10:00",
        ] {
            let got: OffsetDateTime = sqlx::query_scalar("SELECT ?")
                .bind(stored)
                .fetch_one(&pool)
                .await
                .unwrap();
            assert_eq!(got, ms, "{stored}");
        }
        let whole: OffsetDateTime = sqlx::query_scalar("SELECT CURRENT_TIMESTAMP")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(sql(whole).len(), "2026-11-21 10:00:00".len());
    }
}
