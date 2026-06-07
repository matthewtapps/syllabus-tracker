# R2 buckets owned by sillybus.
#
# Location: APAC (because sugar-glider is syd1; Litestream sync + video
# uploads stay in-region for low latency). Location is IMMUTABLE after
# bucket creation — if this needs to change, destroy + recreate.

resource "cloudflare_r2_bucket" "videos" {
  account_id = data.terraform_remote_state.platform.outputs.cloudflare_account_id
  name       = "sillybus-videos-prod"
  location   = "APAC"
}

resource "cloudflare_r2_bucket" "backups" {
  account_id = data.terraform_remote_state.platform.outputs.cloudflare_account_id
  name       = "sillybus-db-backups-prod"
  location   = "APAC"
}

resource "cloudflare_r2_bucket_cors" "videos" {
  account_id  = data.terraform_remote_state.platform.outputs.cloudflare_account_id
  bucket_name = cloudflare_r2_bucket.videos.name

  rules = [{
    id = "app-presigned-reads"
    allowed = {
      methods = ["GET", "HEAD"]
      origins = [
        "https://sillybus.app",
        "https://www.sillybus.app",
        "http://localhost:8080",
      ]
      headers = ["*"]
    }
    expose_headers  = ["ETag", "Content-Length", "Content-Type"]
    max_age_seconds = 3600
  }]
}
