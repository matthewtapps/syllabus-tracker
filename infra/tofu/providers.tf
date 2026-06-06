variable "cloudflare_account_id" {
  type        = string
  description = "Cloudflare account ID that owns the R2 bucket."
  default     = "ea9e8573831e597fc41f865267b8fd35"
}

variable "r2_location" {
  type        = string
  description = "R2 bucket location hint. One of WNAM, ENAM, WEUR, EEUR, APAC, OC."
  default     = "WEUR"
}

variable "bucket_name" {
  type        = string
  description = "Bucket name for production video uploads."
  default     = "syllabus-tracker-videos-prod"
}

variable "app_origin" {
  type        = string
  description = "Origin allowed to read presigned URLs (used for CORS)."
  default     = "https://syllabustracker.matthewtapps.com"
}

variable "db_backups_bucket_name" {
  type        = string
  description = "Bucket name for Litestream database backups."
  default     = "syllabus-tracker-db-backups-prod"
}

# The provider reads its API token from $CLOUDFLARE_API_TOKEN; do not put the
# token in tfvars. Token needs Account > Workers R2 Storage > Edit on this
# account.
provider "cloudflare" {}

# Reads $GITHUB_TOKEN. PAT needs `Actions: Read and write` on this repo.
# See infra/tofu/README.md for the PAT minting flow.
provider "github" {
  owner = "matthewtapps"
}

provider "sops" {}

variable "github_repository" {
  type        = string
  description = "Repo name (without owner) for the GHA secret resources."
  default     = "syllabus-tracker"
}
