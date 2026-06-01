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
