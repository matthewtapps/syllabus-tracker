variable "hetzner_s3_endpoint" {
  type        = string
  description = "Hetzner Object Storage S3 endpoint, e.g. https://fsn1.your-objectstorage.com"
  default     = "https://fsn1.your-objectstorage.com"
}

variable "hetzner_s3_region" {
  type        = string
  description = "Hetzner location used as the SIGv4 region (e.g. fsn1, nbg1, hel1)"
  default     = "fsn1"
}

variable "bucket_name" {
  type        = string
  description = "Bucket name for production video uploads"
  default     = "syllabus-tracker-videos-prod"
}

variable "app_origin" {
  type        = string
  description = "Origin allowed to read presigned URLs (used for CORS)"
  default     = "https://syllabustracker.matthewtapps.com"
}

provider "aws" {
  region = var.hetzner_s3_region

  endpoints {
    s3 = var.hetzner_s3_endpoint
  }

  s3_use_path_style           = true
  skip_credentials_validation = true
  skip_metadata_api_check     = true
  skip_requesting_account_id  = true
  skip_region_validation      = true
}
