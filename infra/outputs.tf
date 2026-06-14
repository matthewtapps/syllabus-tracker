# Service tofu outputs. R2 buckets and runtime token live in platform
# state; the service repo doesn't manage them (CF API limitation makes
# the alternative impractical — see docs/r2-architecture.md).

# Re-export platform values that the deploy workflow needs. Reading them
# via `tofu output -raw` is reliable across versions; `tofu console`
# hangs on EOF in some OpenTofu builds.
output "_platform_vm_ip" {
  description = "Re-exported from data.terraform_remote_state.platform for deploy workflow."
  value       = data.terraform_remote_state.platform.outputs.host_ips["sugar_glider"]
}

output "_platform_host_age_recipient" {
  description = "Re-exported. Empty string until sugar-glider is bootstrapped."
  value       = data.terraform_remote_state.platform.outputs.host_age_recipients["sugar_glider"]
}

output "_platform_ci_deploy_private_key" {
  description = "Re-exported CI deploy private key (SSH ed25519)."
  value       = data.terraform_remote_state.platform.outputs.ci_deploy_private_key
  sensitive   = true
}

# Runtime R2 token (S3-compat). Read from platform state where it's
# minted. Used to populate the runtime-secrets file at deploy time.
output "_platform_runtime_r2_access_key_id" {
  description = "Re-exported runtime R2 token id (S3-compat access key id)."
  value       = data.terraform_remote_state.platform.outputs.cf_runtime_r2_tokens["sillybus"].access_key_id
  sensitive   = true
}

output "_platform_runtime_r2_secret_access_key" {
  description = "Re-exported runtime R2 token secret (S3-compat secret access key)."
  value       = data.terraform_remote_state.platform.outputs.cf_runtime_r2_tokens["sillybus"].secret_access_key
  sensitive   = true
}

# Honeycomb ingest keys. Backend = in-stack collector (rust app +
# intra-stack nginx). Browser = baked into Vite bundle, ships to public
# internet. Both minted in the "sillybus" Honeycomb environment.
output "_platform_honeycomb_backend_ingest" {
  description = "Re-exported sillybus-backend Honeycomb ingest key. Used by docker compose otel-collector at runtime."
  value       = data.terraform_remote_state.platform.outputs.service_honeycomb_keys["sillybus"].backend_ingest
  sensitive   = true
}

output "_platform_honeycomb_browser_ingest" {
  description = "Re-exported sillybus-browser Honeycomb ingest key. Used as Vite build-arg; ends up in the public bundle."
  value       = data.terraform_remote_state.platform.outputs.service_honeycomb_keys["sillybus"].browser_ingest
  sensitive   = true
}

# Video processing (Cloudflare Queue + Worker). The enqueue token is the
# bearer the app sends to the Worker; the callback secret is the HMAC key
# the container signs the processing-result webhook with and the app
# verifies. Both minted in platform tofu; the deploy bakes them into the
# app runtime env, and the same values are set as Worker secrets via
# wrangler. The enqueue URL (Worker's workers.dev address) is NOT here:
# it is created by wrangler and supplied per-env as CI config.
output "_platform_video_enqueue_token" {
  description = "Re-exported bearer for the Worker /jobs enqueue endpoint."
  value       = data.terraform_remote_state.platform.outputs.video_enqueue_token
  sensitive   = true
}

output "_platform_video_callback_secret" {
  description = "Re-exported HMAC secret shared with the transcode container."
  value       = data.terraform_remote_state.platform.outputs.video_callback_secret
  sensitive   = true
}
