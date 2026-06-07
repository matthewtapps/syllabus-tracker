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

# Re-export platform values that the deploy workflow needs. Reading them
# via `tofu output -raw <name>` is reliable across versions; `tofu console`
# hangs on EOF in some OpenTofu builds, so we avoid it.
output "_platform_vm_ip" {
  description = "Re-exported from data.terraform_remote_state.platform for deploy workflow."
  value       = data.terraform_remote_state.platform.outputs.host_ips["sugar_glider"]
}

output "_platform_host_age_recipient" {
  description = "Re-exported. Empty string until sugar-glider is bootstrapped (Phase 5.2)."
  value       = data.terraform_remote_state.platform.outputs.host_age_recipients["sugar_glider"]
}

output "_platform_ci_deploy_private_key" {
  description = "Re-exported CI deploy private key (SSH ed25519)."
  value       = data.terraform_remote_state.platform.outputs.ci_deploy_private_key
  sensitive   = true
}
