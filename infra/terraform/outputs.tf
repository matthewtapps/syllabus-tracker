output "bucket_name" {
  value = cloudflare_r2_bucket.videos.name
}

output "s3_endpoint" {
  value       = "https://${var.cloudflare_account_id}.r2.cloudflarestorage.com"
  description = "S3-compatible endpoint to set as S3_ENDPOINT in prod.env."
}

# ---- Database backups -----------------------------------------------------

output "db_backups_bucket_name" {
  value       = cloudflare_r2_bucket.db_backups.name
  description = "Litestream replica bucket; matches LITESTREAM_BUCKET in prod.env."
}

output "litestream_endpoint" {
  value       = "https://${var.cloudflare_account_id}.r2.cloudflarestorage.com"
  description = "S3-compatible endpoint for the Litestream replica."
}
