terraform {
  required_version = ">= 1.10"

  required_providers {
    aws        = { source = "hashicorp/aws",         version = "~> 5.70" }
    cloudflare = { source = "cloudflare/cloudflare", version = "~> 5.19" }
    local      = { source = "hashicorp/local",       version = "~> 2.5" }
  }
}
