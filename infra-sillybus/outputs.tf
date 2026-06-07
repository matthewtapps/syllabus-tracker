output "videos_bucket_name"  { value = cloudflare_r2_bucket.videos.name }
output "backups_bucket_name" { value = cloudflare_r2_bucket.backups.name }

# Runtime R2 token (S3-compat). Used to populate the runtime secrets
# file via the build workflow's "fetch runtime secrets" step.
output "runtime_r2_access_key_id" {
  value = cloudflare_api_token.runtime_r2.id
}

output "runtime_r2_secret_access_key" {
  value     = sha256(cloudflare_api_token.runtime_r2.value)
  sensitive = true
}
