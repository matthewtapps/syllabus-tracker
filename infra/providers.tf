# Providers pull credentials from platform state. Service CI never holds
# long-lived provider credentials; they're fetched fresh every run from
# the platform tfstate via the bootstrap R2 token.

provider "aws" {
  region     = "us-east-1"
  access_key = data.terraform_remote_state.platform.outputs.aws_dns_access_keys["sillybus"].id
  secret_key = data.terraform_remote_state.platform.outputs.aws_dns_access_keys["sillybus"].secret
}

# Cloudflare provider no longer needed — buckets and runtime token live
# in platform tofu. Service consumes them via remote_state outputs.
