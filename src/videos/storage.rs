use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use aws_config::Region;
use aws_credential_types::Credentials;
use aws_sdk_s3::config::{BehaviorVersion, Builder as S3ConfigBuilder};
use aws_sdk_s3::primitives::ByteStream;
use aws_sdk_s3::presigning::PresigningConfig;
use aws_sdk_s3::Client as S3Client;
use thiserror::Error;
use tracing::instrument;

pub type DynVideoStorage = Arc<dyn VideoStorage + Send + Sync>;

#[derive(Debug, Error)]
pub enum StorageError {
    #[error("storage backend error: {0}")]
    Backend(String),
    #[error("presigning error: {0}")]
    Presign(String),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

#[async_trait]
pub trait VideoStorage {
    async fn put_file(
        &self,
        key: &str,
        content_type: &str,
        source: &Path,
    ) -> Result<(), StorageError>;

    async fn delete(&self, key: &str) -> Result<(), StorageError>;

    async fn presign_get(&self, key: &str, ttl: Duration) -> Result<String, StorageError>;

    async fn presign_attachment_get(
        &self,
        key: &str,
        ttl: Duration,
        filename: &str,
    ) -> Result<String, StorageError>;
}

#[derive(Debug, Clone)]
pub struct S3Config {
    pub endpoint: String,
    pub public_endpoint: String,
    pub region: String,
    pub bucket: String,
    pub access_key: String,
    pub secret_key: String,
    pub force_path_style: bool,
}

impl S3Config {
    pub fn from_env() -> Result<Self, StorageError> {
        let read = |key: &str| {
            dotenvy::var(key).map_err(|_| {
                StorageError::Backend(format!("missing env var: {}", key))
            })
        };
        let force_path_style = dotenvy::var("S3_FORCE_PATH_STYLE")
            .map(|v| v == "true" || v == "1")
            .unwrap_or(true);
        let endpoint = read("S3_ENDPOINT")?;
        let public_endpoint =
            dotenvy::var("S3_PUBLIC_ENDPOINT").unwrap_or_else(|_| endpoint.clone());
        Ok(Self {
            endpoint,
            public_endpoint,
            region: read("S3_REGION")?,
            bucket: read("S3_BUCKET")?,
            access_key: read("S3_ACCESS_KEY")?,
            secret_key: read("S3_SECRET_KEY")?,
            force_path_style,
        })
    }
}

pub struct S3VideoStorage {
    client: S3Client,
    presign_client: S3Client,
    bucket: String,
}

impl S3VideoStorage {
    pub fn new(config: &S3Config) -> Self {
        let client = build_client(config, &config.endpoint);
        // When S3_PUBLIC_ENDPOINT differs from S3_ENDPOINT, presigned URLs need
        // to embed the host the browser can actually reach. SIGv4 signs the
        // Host header, so we can't just rewrite the URL string after the fact:
        // we need a second client whose endpoint is the public one and presign
        // through that.
        let presign_client = if config.public_endpoint == config.endpoint {
            client.clone()
        } else {
            build_client(config, &config.public_endpoint)
        };
        Self {
            client,
            presign_client,
            bucket: config.bucket.clone(),
        }
    }
}

fn build_client(config: &S3Config, endpoint: &str) -> S3Client {
    let credentials = Credentials::new(
        config.access_key.clone(),
        config.secret_key.clone(),
        None,
        None,
        "static",
    );
    let s3_config = S3ConfigBuilder::new()
        .behavior_version(BehaviorVersion::latest())
        .endpoint_url(endpoint)
        .region(Region::new(config.region.clone()))
        .credentials_provider(credentials)
        .force_path_style(config.force_path_style)
        .build();
    S3Client::from_conf(s3_config)
}

#[async_trait]
impl VideoStorage for S3VideoStorage {
    #[instrument(skip(self, source), fields(bucket = %self.bucket, key = %key))]
    async fn put_file(
        &self,
        key: &str,
        content_type: &str,
        source: &Path,
    ) -> Result<(), StorageError> {
        let body = ByteStream::from_path(source)
            .await
            .map_err(|e| StorageError::Backend(format!("read source: {}", e)))?;
        self.client
            .put_object()
            .bucket(&self.bucket)
            .key(key)
            .content_type(content_type)
            .body(body)
            .send()
            .await
            .map_err(|e| StorageError::Backend(format!("put_object: {}", e)))?;
        Ok(())
    }

    #[instrument(skip(self), fields(bucket = %self.bucket, key = %key))]
    async fn delete(&self, key: &str) -> Result<(), StorageError> {
        self.client
            .delete_object()
            .bucket(&self.bucket)
            .key(key)
            .send()
            .await
            .map_err(|e| StorageError::Backend(format!("delete_object: {}", e)))?;
        Ok(())
    }

    #[instrument(skip(self), fields(bucket = %self.bucket, key = %key))]
    async fn presign_get(&self, key: &str, ttl: Duration) -> Result<String, StorageError> {
        let presign = PresigningConfig::expires_in(ttl)
            .map_err(|e| StorageError::Presign(e.to_string()))?;
        let req = self
            .presign_client
            .get_object()
            .bucket(&self.bucket)
            .key(key)
            .presigned(presign)
            .await
            .map_err(|e| StorageError::Presign(e.to_string()))?;
        Ok(req.uri().to_string())
    }

    #[instrument(skip(self), fields(bucket = %self.bucket, key = %key))]
    async fn presign_attachment_get(
        &self,
        key: &str,
        ttl: Duration,
        filename: &str,
    ) -> Result<String, StorageError> {
        let presign = PresigningConfig::expires_in(ttl)
            .map_err(|e| StorageError::Presign(e.to_string()))?;
        let disposition = format!("attachment; filename=\"{}\"", filename);
        let req = self
            .presign_client
            .get_object()
            .bucket(&self.bucket)
            .key(key)
            .response_content_disposition(disposition)
            .presigned(presign)
            .await
            .map_err(|e| StorageError::Presign(e.to_string()))?;
        Ok(req.uri().to_string())
    }
}

#[cfg(test)]
pub mod test_support {
    use std::collections::HashMap;
    use std::path::Path;
    use std::sync::Mutex;
    use std::time::Duration;

    use async_trait::async_trait;

    use super::{StorageError, VideoStorage};

    #[derive(Default)]
    pub struct InMemoryVideoStorage {
        objects: Mutex<HashMap<String, Vec<u8>>>,
    }

    impl InMemoryVideoStorage {
        pub fn new() -> Self {
            Self::default()
        }
    }

    #[async_trait]
    impl VideoStorage for InMemoryVideoStorage {
        async fn put_file(
            &self,
            key: &str,
            _content_type: &str,
            source: &Path,
        ) -> Result<(), StorageError> {
            let bytes = tokio::fs::read(source).await?;
            self.objects
                .lock()
                .unwrap()
                .insert(key.to_string(), bytes);
            Ok(())
        }

        async fn delete(&self, key: &str) -> Result<(), StorageError> {
            self.objects.lock().unwrap().remove(key);
            Ok(())
        }

        async fn presign_get(&self, key: &str, _ttl: Duration) -> Result<String, StorageError> {
            Ok(format!("memory://{}", key))
        }

        async fn presign_attachment_get(
            &self,
            key: &str,
            _ttl: Duration,
            filename: &str,
        ) -> Result<String, StorageError> {
            Ok(format!("memory://{}?filename={}", key, filename))
        }
    }
}
