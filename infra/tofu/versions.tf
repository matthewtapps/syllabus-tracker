terraform {
  required_version = ">= 1.6.0"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.19"
    }
    github = {
      source  = "integrations/github"
      version = "~> 6.6"
    }
    sops = {
      source  = "carlpett/sops"
      version = "~> 1.2"
    }
  }
}
