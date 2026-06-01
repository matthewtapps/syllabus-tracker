# Cloudflare R2 bucket

Provisions the production R2 bucket used for native video uploads. Uses the
`cloudflare/cloudflare` provider's native `cloudflare_r2_bucket` and
`cloudflare_r2_bucket_cors` resources.

## One-time setup

1. Generate a Cloudflare API token at https://dash.cloudflare.com/profile/api-tokens
   with **Account > Workers R2 Storage > Edit** scoped to this account. No zone
   permissions needed.
2. Export the token for Terraform (it reads `$CLOUDFLARE_API_TOKEN`
   automatically):

   ```sh
   export CLOUDFLARE_API_TOKEN=<your_token>
   ```

   This is *not* the same as the S3-compatible credentials the app uses at
   runtime. Those are R2 API Tokens generated from the R2 dashboard after the
   bucket exists, and live in `.secrets.env` as `S3_ACCESS_KEY` /
   `S3_SECRET_KEY`.

## Apply

```sh
cd infra/terraform
terraform init
terraform plan
terraform apply
```

Outputs include `bucket_name` and `s3_endpoint`. The endpoint is what goes in
`config/prod.env` as `S3_ENDPOINT`.

State is local. Move it to a remote backend once you have credentials parked
somewhere durable.

## Generate the runtime S3 token

After `terraform apply`:

1. Cloudflare dashboard > R2 Object Storage > Manage R2 API Tokens > Create
   API Token.
2. Permissions: **Object Read & Write**.
3. Specify bucket: **`syllabus-tracker-videos-prod`** (the one Terraform just
   created).
4. Copy the **Access Key ID** and **Secret Access Key** (secret shown once).
5. Paste both into GitHub Actions secrets as `CLOUDFLARE_R2_ACCESS_KEY_ID` and
   `CLOUDFLARE_R2_SECRET_ACCESS_KEY`. The deploy workflow surfaces them into
   `.secrets.env` on the server.
