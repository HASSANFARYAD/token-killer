#!/usr/bin/env sh
set -eu

cat > /usr/share/nginx/html/config.js <<EOF
window.RTK_ADMIN_CONFIG = {
  apiBaseUrl: "${RTK_ADMIN_API_BASE_URL:-http://localhost:8000}"
};
EOF
