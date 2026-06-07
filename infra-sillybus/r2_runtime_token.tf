# Per-bucket runtime S3-compat token. The sillybus app uses this at
# runtime for video uploads (S3 API) and Litestream backups (S3 API).
#
# Scoped to ONLY the sillybus buckets via per-bucket resource scoping
# (com.cloudflare.edge.r2.bucket.<acct>_default_<name>).

resource "cloudflare_api_token" "runtime_r2" {
  name = "sillybus-runtime-r2"

  policies = [
    {
      effect            = "allow"
      permission_groups = [{ id = data.terraform_remote_state.platform.outputs.r2_edit_permission_group_id }]
      resources = jsonencode({
        "com.cloudflare.edge.r2.bucket.${data.terraform_remote_state.platform.outputs.cloudflare_account_id}_default_${cloudflare_r2_bucket.videos.name}"  = "*"
        "com.cloudflare.edge.r2.bucket.${data.terraform_remote_state.platform.outputs.cloudflare_account_id}_default_${cloudflare_r2_bucket.backups.name}" = "*"
      })
    }
  ]
}
