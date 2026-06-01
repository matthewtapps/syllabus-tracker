output "bucket_name" {
  value = cloudflare_r2_bucket.videos.name
}

output "s3_endpoint" {
  value       = "https://${var.cloudflare_account_id}.r2.cloudflarestorage.com"
  description = "S3-compatible endpoint to set as S3_ENDPOINT in prod.env."
}
