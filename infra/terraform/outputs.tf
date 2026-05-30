output "bucket_name" {
  value = aws_s3_bucket.videos.bucket
}

output "endpoint" {
  value = var.hetzner_s3_endpoint
}
