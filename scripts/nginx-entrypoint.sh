#!/bin/sh
set -e

# Create all necessary directories for certbot and nginx
echo "Setting up directories..."
mkdir -p /var/www/certbot
mkdir -p /etc/letsencrypt/live/syllabustracker.matthewtapps.com
mkdir -p /etc/letsencrypt/archive
mkdir -p /etc/nginx/conf.d

# Ensure proper permissions
chmod -R 755 /var/www/certbot
chmod -R 700 /etc/letsencrypt

# Check if certificate exists
if [ ! -f /etc/letsencrypt/live/syllabustracker.matthewtapps.com/fullchain.pem ]; then
  echo "SSL certificate not found, requesting new certificate..."

  # Install certbot and dependencies
  echo "Installing certbot..."
  apk update
  apk add --no-cache certbot certbot-nginx

  # Start nginx with a temporary config for the ACME challenge
  echo "Creating temporary nginx config for ACME challenge..."
  cat >/etc/nginx/conf.d/default.conf <<EOF
server {
    listen 80;
    server_name syllabustracker.matthewtapps.com;
    
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }
    
    location / {
        return 200 "SSL certificate being provisioned, please wait...";
    }
}
EOF

  # Start nginx
  echo "Starting nginx with temporary configuration..."
  nginx -g "daemon off;" &
  nginx_pid=$!

  # Wait for nginx to start
  echo "Waiting for nginx to start..."
  sleep 5

  # Request the certificate
  echo "Requesting SSL certificate from Let's Encrypt..."
  certbot certonly --webroot -w /var/www/certbot \
    --email ${SSL_CERT_EMAIL} \
    --agree-tos --no-eff-email \
    -d syllabustracker.matthewtapps.com \
    --non-interactive

  # Stop the temporary nginx
  echo "Stopping temporary nginx..."
  kill $nginx_pid
  wait

  # Now use the real config
  echo "Applying final nginx configuration..."
  cp /etc/nginx/conf.d/ssl.conf.template /etc/nginx/conf.d/default.conf
else
  echo "SSL certificate exists, using existing certificate"
  # Copy the SSL config to the default.conf location
  cp /etc/nginx/conf.d/ssl.conf.template /etc/nginx/conf.d/default.conf
fi

# Start nginx with the final config
echo "Starting nginx with SSL configuration..."
exec nginx -g "daemon off;"
