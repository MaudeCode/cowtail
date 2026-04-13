#!/bin/sh
set -eu

template="/opt/cowtail/templates/apple-app-site-association.template"
output_root="/usr/share/nginx/html"

mkdir -p "${output_root}/.well-known"

envsubst '${UNIVERSAL_LINKS_APP_ID}' < "${template}" > "${output_root}/apple-app-site-association"
envsubst '${UNIVERSAL_LINKS_APP_ID}' < "${template}" > "${output_root}/.well-known/apple-app-site-association"
