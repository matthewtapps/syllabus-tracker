resource "aws_s3_bucket" "videos" {
  bucket = var.bucket_name
}

resource "aws_s3_bucket_cors_configuration" "videos" {
  bucket = aws_s3_bucket.videos.id

  cors_rule {
    allowed_methods = ["GET", "HEAD"]
    allowed_origins = [var.app_origin]
    allowed_headers = ["*"]
    expose_headers  = ["ETag", "Content-Length", "Content-Type"]
    max_age_seconds = 3600
  }
}
