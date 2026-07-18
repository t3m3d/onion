#!/bin/sh
set -eu

mkdir -p /var/lib/tor/data /var/lib/tor/hidden_service
chown -R tor:tor /var/lib/tor
chmod 0700 /var/lib/tor/data /var/lib/tor/hidden_service

exec su-exec tor "$@"
