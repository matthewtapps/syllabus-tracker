# Hetzner Object Storage bucket

Provisions the production bucket used for native video uploads. Uses the
`hashicorp/aws` provider pointed at Hetzner's S3-compatible endpoint.

## One-time setup

1. Create a Hetzner Cloud project and enable Object Storage on it.
2. Generate a S3 access key and secret in the Hetzner console.
3. Export the credentials for Terraform:

   ```sh
   export AWS_ACCESS_KEY_ID=<hetzner_access_key>
   export AWS_SECRET_ACCESS_KEY=<hetzner_secret_key>
   ```

   The same credentials should also live in `.secrets.env` as `S3_ACCESS_KEY` /
   `S3_SECRET_KEY` so the app can use them at runtime.

## Apply

```sh
cd infra/terraform
terraform init
terraform plan
terraform apply
```

State is local. Move it to a remote backend once you have credentials parked
somewhere durable.

## Known quirks

Hetzner's S3 surface is compatible enough for `aws_s3_bucket` and
`aws_s3_bucket_cors_configuration`. If a future Terraform resource fails because
Hetzner rejects a specific request (bucket policy, ACL, logging, replication),
either remove the resource or wrap it in `lifecycle { ignore_changes = [...] }`.
