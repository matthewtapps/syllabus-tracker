terraform {
  backend "s3" {
    bucket   = "tofu-state-services"
    key      = "sillybus/terraform.tfstate"
    region   = "us-east-1"
    endpoint = "https://ea9e8573831e597fc41f865267b8fd35.r2.cloudflarestorage.com"
    skip_credentials_validation = true
    skip_metadata_api_check     = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_s3_checksum            = true
    use_path_style              = true
    use_lockfile                = true
  }
}
