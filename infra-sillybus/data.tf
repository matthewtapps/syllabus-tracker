# Read platform tofu state. The bootstrap CF R2 token in the `sillybus`
# GitHub Environment has read access to the platform state bucket, so
# this works at every CI run without needing any per-credential GHA
# secret.

data "terraform_remote_state" "platform" {
  backend = "s3"
  config = {
    bucket   = "tofu-state-platform"
    key      = "terraform.tfstate"
    region   = "us-east-1"
    endpoint = "https://ea9e8573831e597fc41f865267b8fd35.r2.cloudflarestorage.com"
    skip_credentials_validation = true
    skip_metadata_api_check     = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_s3_checksum            = true
    use_path_style              = true
  }
}
