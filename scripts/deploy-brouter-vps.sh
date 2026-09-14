#!/usr/bin/env bash
#
# Mopik's own BRouter, on a fresh Ubuntu/Debian VPS.
#
# Why this exists: brouter.de refuses any leg over roughly 500 km, answering
# 400 "error re-tracking track" — measured 2026-09-14 on Como → Budapest
# (~800 km) and Berlin → Warszawa (~570 km, flat). The same lengths route in
# 4.4 s on our own instance, so this is the public instance giving up, not a
# limit of BRouter or of our cost profile. It also throttles bursts (403
# "Please, retry later!"), which is the biggest drag on measuring anything.
#
# Sizing, measured rather than guessed: the 88 European segment files are
# 3.31 GB on disk, but BRouter memory-maps them — the local process sits at
# 196 MB resident after a 700 km route with -Xmx512M. So the cheapest tier is
# genuinely enough: 2 GB RAM, 10 GB disk, 1-2 vCPU (e.g. Hetzner CX22).
#
# Usage, as root on a fresh server:
#   curl -fsSL <this file> | bash -s -- --domain brouter.example.com --token "$(openssl rand -hex 32)"
# or copy it over and run:
#   ./deploy-brouter-vps.sh --domain brouter.example.com --token <secret>
#
# --domain is optional. Without it the server listens on plain HTTP on port 80
# and you point BROUTER_BASE_URL at http://<ip>; with it, nginx gets a Let's
# Encrypt certificate and you get https://<domain>.
#
# Prefer a domain: the token travels in a header on every request, and over
# plain HTTP that header is readable in transit. Mopik's own instance is
# https://brouter.mopik.eu (A record -> the server's IP, added at the
# registrar; point it at the IP *before* running with --domain, because
# certbot verifies over the live name).
#
# The token is what keeps the instance ours: every request must carry
# `X-Mopik-Token`. Without it an open BRouter is a free routing service for
# whoever finds it, and the bill for that is our CPU.

set -euo pipefail

BROUTER_VERSION="1.7.10"
SEGMENTS_URL="https://brouter.de/brouter/segments4"
INSTALL_DIR="/opt/brouter"
SERVICE_USER="brouter"
PORT_INTERNAL="17777"
# Matches the local dev server, and is the whole point of self-hosting: a long
# European leg must not be cut off the way brouter.de cuts it.
MAX_RUNNING_TIME="300"
# Measured: 196 MB resident after a 700 km route. 1 GB leaves generous room
# for concurrent requests without risking the OOM killer on a 2 GB box.
JAVA_HEAP="1024M"
# Europe: W15..E45, N35..N70 on BRouter's 5-degree grid.
LON_MIN=-15; LON_MAX=45; LAT_MIN=35; LAT_MAX=70

DOMAIN=""
TOKEN=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain) DOMAIN="$2"; shift 2 ;;
    --token)  TOKEN="$2";  shift 2 ;;
    *) echo "unknown option: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$TOKEN" ]]; then
  echo "error: --token is required. Generate one with: openssl rand -hex 32" >&2
  exit 1
fi
if [[ $EUID -ne 0 ]]; then
  echo "error: run as root." >&2
  exit 1
fi

echo "==> Installing packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq default-jre-headless unzip curl nginx ufw >/dev/null

echo "==> Creating ${SERVICE_USER} user and ${INSTALL_DIR}"
id -u "$SERVICE_USER" >/dev/null 2>&1 || useradd --system --home "$INSTALL_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
mkdir -p "$INSTALL_DIR"/{segments4,customprofiles}
cd "$INSTALL_DIR"

echo "==> Fetching BRouter ${BROUTER_VERSION}"
if [[ ! -f "$INSTALL_DIR/brouter-${BROUTER_VERSION}-all.jar" ]]; then
  curl -fsSL -o /tmp/brouter.zip \
    "https://github.com/abrensch/brouter/releases/download/v${BROUTER_VERSION}/brouter-${BROUTER_VERSION}.zip"
  unzip -oq /tmp/brouter.zip -d /tmp/brouter-dist
  # The archive's layout has moved between releases; find the pieces instead
  # of assuming a path.
  find /tmp/brouter-dist -name "brouter-${BROUTER_VERSION}-all.jar" -exec cp {} "$INSTALL_DIR/" \;
  PROFILE_SRC="$(find /tmp/brouter-dist -type d -name profiles2 | head -1)"
  [[ -n "$PROFILE_SRC" ]] || { echo "error: profiles2 not found in the release archive" >&2; exit 1; }
  cp -r "$PROFILE_SRC" "$INSTALL_DIR/"
  rm -rf /tmp/brouter.zip /tmp/brouter-dist
fi

echo "==> Downloading European segments (~3.3 GB, 88 files) — resumable, skips what is present"
# -C - resumes a partial file, so re-running after an interruption costs only
# what is missing rather than the whole 3.3 GB.
for (( lon=LON_MIN; lon<=LON_MAX; lon+=5 )); do
  for (( lat=LAT_MIN; lat<=LAT_MAX; lat+=5 )); do
    if (( lon < 0 )); then ew="W$(( -lon ))"; else ew="E${lon}"; fi
    if (( lat < 0 )); then ns="S$(( -lat ))"; else ns="N${lat}"; fi
    tile="${ew}_${ns}.rd5"
    target="$INSTALL_DIR/segments4/${tile}"
    [[ -s "$target" ]] && continue
    # Many grid cells are sea and have no file; a 404 is normal, not an error.
    if curl -fsSL -C - -o "${target}.part" "${SEGMENTS_URL}/${tile}" 2>/dev/null; then
      mv "${target}.part" "$target"
      echo "    ${tile}"
    else
      rm -f "${target}.part"
    fi
  done
done
echo "==> Segments: $(ls -1 "$INSTALL_DIR"/segments4/*.rd5 2>/dev/null | wc -l) files, $(du -sh "$INSTALL_DIR/segments4" | cut -f1)"

chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"

echo "==> systemd service"
cat >/etc/systemd/system/brouter.service <<EOF
[Unit]
Description=BRouter routing server for Mopik
After=network.target

[Service]
Type=simple
User=${SERVICE_USER}
WorkingDirectory=${INSTALL_DIR}
# Bound to localhost: nginx is the only way in, so the token check cannot be
# bypassed by talking to the port directly.
# Paths are RELATIVE to WorkingDirectory, exactly as the local dev script
# passes them. BRouter resolves the custom-profile directory against the
# profiles directory, so an absolute path here becomes
# "/opt/brouter/profiles2/opt/brouter/customprofiles" and every uploaded
# profile fails with FileNotFoundException — while nginx still answers 200,
# because the 500 is inside BRouter's own response body.
ExecStart=/usr/bin/java -Xmx${JAVA_HEAP} -Xms128M -Xmn8M -DmaxRunningTime=${MAX_RUNNING_TIME} \\
  -cp ${INSTALL_DIR}/brouter-${BROUTER_VERSION}-all.jar btools.server.RouteServer \\
  segments4 profiles2 customprofiles ${PORT_INTERNAL} 4 127.0.0.1
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true

[Install]
WantedBy=multi-user.target
EOF

echo "==> Pruning uploaded profiles weekly"
# Every generation uploads a cost profile, and BRouter keeps each one as a
# file. Measured locally: 231 files / 1.9 MB in eleven days — slow, but
# unbounded. Anything untouched for a week is from a request long finished.
cat >/etc/systemd/system/brouter-prune.service <<EOF
[Unit]
Description=Remove BRouter custom profiles older than 7 days

[Service]
Type=oneshot
ExecStart=/usr/bin/find ${INSTALL_DIR}/customprofiles -name '*.brf' -mtime +7 -delete
EOF
cat >/etc/systemd/system/brouter-prune.timer <<EOF
[Unit]
Description=Weekly BRouter profile prune

[Timer]
OnCalendar=weekly
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now brouter.service brouter-prune.timer

echo "==> nginx"
SERVER_NAME="${DOMAIN:-_}"
cat >/etc/nginx/sites-available/brouter <<EOF
server {
    listen 80;
    server_name ${SERVER_NAME};

    # The shared secret. Without it this is a free routing service for anyone
    # who finds the IP, paid for in our CPU.
    #
    # When every request 403s, log what actually arrives before suspecting the
    # value — a missing header and a wrong one look identical from outside:
    #   log_format tok '\$status tok=[\$http_x_mopik_token]';
    #   access_log /var/log/nginx/token.log tok;
    # "tok=[-]" means the caller never sent the header at all. On Vercel that
    # means the variable was added after the last build, so the function does
    # not have it yet and a cacheless redeploy is the fix — not a new token.
    set \$ok 0;
    if (\$http_x_mopik_token = "${TOKEN}") { set \$ok 1; }
    if (\$ok = 0) { return 403; }

    # A long leg is the reason this server exists; 700 km measured at 4.4 s,
    # but a cold segment file and a hard profile can take longer.
    proxy_read_timeout 300s;
    proxy_send_timeout 300s;

    location / {
        proxy_pass http://127.0.0.1:${PORT_INTERNAL};
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
    }
}
EOF
ln -sf /etc/nginx/sites-available/brouter /etc/nginx/sites-enabled/brouter
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

echo "==> Firewall"
ufw allow OpenSSH >/dev/null
ufw allow 'Nginx Full' >/dev/null
ufw --force enable >/dev/null

if [[ -n "$DOMAIN" ]]; then
  echo "==> TLS for ${DOMAIN}"
  apt-get install -y -qq certbot python3-certbot-nginx >/dev/null
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect
  # Certbot leaves the plain-HTTP server block answering `return 404` for
  # anything that is not the certificated name — so a caller still pointed at
  # http://<ip> gets 404, not a redirect, and Node's fetch would not resurvive
  # a redirect with a POST body anyway. Send them to the canonical name so the
  # failure is at least legible, and point BROUTER_BASE_URL at the domain.
  sed -i "s|    return 404; # managed by Certbot|    return 301 https://${DOMAIN}\$request_uri;|" \
    /etc/nginx/sites-available/brouter
  nginx -t && systemctl reload nginx
  BASE="https://${DOMAIN}"
else
  BASE="http://$(curl -fsS4 https://ifconfig.me || echo YOUR_SERVER_IP)"
fi

echo
echo "==> Checking it answers"
sleep 3
# Rīga → Tallinn, a leg brouter.de handles, as a smoke test.
code=$(curl -s -o /dev/null -w '%{http_code}' -H "X-Mopik-Token: ${TOKEN}" \
  "${BASE}/brouter?lonlats=24.1052,56.9496%7C24.7536,59.437&profile=trekking&alternativeidx=0&format=geojson" || true)
echo "    Rīga → Tallinn: HTTP ${code}"

cat <<EOF

Done.

Set these in Vercel (Production), then redeploy:

  BROUTER_BASE_URL   ${BASE}
  BROUTER_TOKEN      ${TOKEN}

Keep the token somewhere safe — it is the only thing standing between this
server and the open internet.

Check on it with:
  systemctl status brouter
  journalctl -u brouter -f
EOF
