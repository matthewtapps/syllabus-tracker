resource "cloudflare_r2_bucket" "videos" {
  account_id = var.cloudflare_account_id
  name       = var.bucket_name
  location   = var.r2_location
}

resource "cloudflare_r2_bucket_cors" "videos" {
  account_id  = var.cloudflare_account_id
  bucket_name = cloudflare_r2_bucket.videos.name

  rules = [{
    id = "app-presigned-reads"
    allowed = {
      methods = ["GET", "HEAD"]
      origins = [var.app_origin]
      headers = ["*"]
    }
    expose_headers  = ["ETag", "Content-Length", "Content-Type"]
    max_age_seconds = 3600
  }]
}

# ---- Database backups (Litestream → R2) ----------------------------------

resource "cloudflare_r2_bucket" "db_backups" {
  account_id = var.cloudflare_account_id
  name       = var.db_backups_bucket_name
  location   = var.r2_location
}

# Note: the runtime S3 API tokens for both buckets are NOT Terraform-managed.
# See infra/terraform/README.md for the click-mint flow and the rationale.
