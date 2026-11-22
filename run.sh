#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$ROOT_DIR/.env"
fail() { printf '[ERROR] %s\n' "$*" >&2; exit 1; }
info() { printf '[SETUP] %s\n' "$*"; }

[[ $EUID -eq 0 ]] || fail 'Jalankan dengan sudo: sudo ./run.sh'
[[ -f "$ROOT_DIR/docker-compose.yml" ]] || fail 'Folder aplikasi tidak lengkap.'
if [[ ! -f "$ENV_FILE" ]]; then
  install -m 600 "$ROOT_DIR/.env.example" "$ENV_FILE"
  echo '[INFO] .env dibuat. Isi admin, public IP, network/server VPN, dan range client, lalu jalankan lagi.'
  exit 1
fi
chmod 600 "$ENV_FILE"

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a
FRESH_SETUP=0
[[ -f "$ROOT_DIR/data/.webvpn-install-id" ]] || FRESH_SETUP=1
if [[ "$FRESH_SETUP" -eq 1 && -f "$ROOT_DIR/data/monitor.db" ]] && command -v docker >/dev/null 2>&1; then
  if docker ps --format '{{.Names}}' | grep -Eq '^vpn-monitor(-app|-nginx)?$'; then
    fail 'Database ada tanpa marker setup tetapi monitor sedang berjalan. Hentikan dan backup secara manual sebelum fresh setup.'
  fi
fi

for key in ADMIN_USERNAME ADMIN_PASSWORD WG_PUBLIC_IP WG_PORT WG_INTERFACE VPN_NETWORK VPN_SERVER_IP VPN_CLIENT_RANGE_START VPN_CLIENT_RANGE_END CLIENT_NAME_PREFIX CLIENT_EMAIL_DOMAIN PORT; do
  [[ -n "${!key:-}" ]] || fail "Variable $key belum diisi di .env."
done
[[ "$ADMIN_PASSWORD" != 'replace-with-a-strong-password' ]] || fail 'Ganti ADMIN_PASSWORD di .env.'
[[ ${#ADMIN_PASSWORD} -ge 12 ]] || fail 'ADMIN_PASSWORD minimal 12 karakter.'
[[ "$ADMIN_USERNAME" =~ ^[A-Za-z0-9_.-]+$ ]] || fail 'ADMIN_USERNAME tidak valid.'
[[ "$WG_INTERFACE" =~ ^[A-Za-z0-9_.-]{1,15}$ ]] || fail 'WG_INTERFACE tidak valid.'
[[ "$CLIENT_NAME_PREFIX" =~ ^[A-Za-z][A-Za-z0-9_-]{0,24}$ ]] || fail 'CLIENT_NAME_PREFIX tidak valid.'
[[ "$CLIENT_EMAIL_DOMAIN" =~ ^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || fail 'CLIENT_EMAIL_DOMAIN tidak valid.'
[[ "$WG_PORT" =~ ^[0-9]+$ ]] && ((WG_PORT > 0 && WG_PORT < 65536)) || fail 'WG_PORT harus 1-65535.'
[[ "$PORT" =~ ^[0-9]+$ ]] && ((PORT > 0 && PORT < 65536)) || fail 'PORT harus 1-65535.'
WG_CONFIG_PATH="${WG_CONFIG_PATH:-/etc/wireguard/${WG_INTERFACE}.conf}"
DNSMASQ_LOG_PATH="${DNSMASQ_LOG_PATH:-/var/log/dnsmasq.log}"
[[ "$WG_CONFIG_PATH" == "/etc/wireguard/${WG_INTERFACE}.conf" ]] || fail 'WG_CONFIG_PATH harus /etc/wireguard/<interface>.conf.'
export WG_CONFIG_PATH DNSMASQ_LOG_PATH

python3 - "$WG_PUBLIC_IP" "$VPN_NETWORK" "$VPN_SERVER_IP" "$VPN_CLIENT_RANGE_START" "$VPN_CLIENT_RANGE_END" <<'PY'
import ipaddress,re,sys
public,network_text,server_text,first_text,last_text=sys.argv[1:]
try:
    net=ipaddress.ip_network(network_text,strict=True)
    server,first,last=map(ipaddress.ip_address,(server_text,first_text,last_text))
except ValueError as e: raise SystemExit(f'[ERROR] IP/subnet tidak valid: {e}')
if net.version!=4 or any(x.version!=4 for x in (server,first,last)): raise SystemExit('[ERROR] VPN_NETWORK harus IPv4.')
if server not in net or first not in net or last not in net or first>last: raise SystemExit('[ERROR] Server dan range client harus valid di dalam VPN_NETWORK.')
if server in (net.network_address,net.broadcast_address) or first==net.network_address or last==net.broadcast_address or first<=server<=last: raise SystemExit('[ERROR] Range mencakup alamat network/broadcast/server.')
if int(last)-int(first)+1>65534: raise SystemExit('[ERROR] Range client terlalu besar.')
if not re.fullmatch(r'[A-Za-z0-9.-]+',public): raise SystemExit('[ERROR] WG_PUBLIC_IP harus IPv4 atau hostname publik.')
print(f'[INFO] VPN {net}, server {server}, client {first}-{last} ({int(last)-int(first)+1} client).')
PY

if [[ "$FRESH_SETUP" -eq 1 || -z "${SESSION_SECRET:-}" || -z "${RESET_KEY:-}" ]]; then
  python3 - "$ENV_FILE" "$FRESH_SETUP" <<'PY'
import os,secrets,sys
from pathlib import Path
p=Path(sys.argv[1]); fresh=sys.argv[2]=='1'; lines=p.read_text().splitlines()
values={
 'SESSION_SECRET':secrets.token_hex(32) if fresh else (os.environ.get('SESSION_SECRET') or secrets.token_hex(32)),
 'RESET_KEY':secrets.token_hex(24) if fresh else (os.environ.get('RESET_KEY') or secrets.token_hex(24)),
}
seen=set(); out=[]
for line in lines:
    key=line.split('=',1)[0].strip() if '=' in line and not line.lstrip().startswith('#') else None
    if key in values: out.append(f'{key}={values[key]}'); seen.add(key)
    else: out.append(line)
for key,value in values.items():
    if key not in seen: out.append(f'{key}={value}')
p.write_text('\n'.join(out)+'\n'); p.chmod(0o600)
PY
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

command -v apt-get >/dev/null 2>&1 || fail 'Host yang didukung saat ini Debian/Ubuntu.'
info 'Memasang dependensi host.'
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
packages=(wireguard-tools dnsmasq nftables python3 curl ca-certificates)
command -v docker >/dev/null 2>&1 || packages+=(docker.io)
apt-get install -y "${packages[@]}"
if ! docker compose version >/dev/null 2>&1 && ! command -v docker-compose >/dev/null 2>&1; then
  apt-get install -y docker-compose-v2 || apt-get install -y docker-compose-plugin || apt-get install -y docker-compose
fi
systemctl enable --now docker
if docker compose version >/dev/null 2>&1; then COMPOSE=(docker compose); else COMPOSE=(docker-compose); fi

if [[ "$FRESH_SETUP" -eq 1 && -f "$ROOT_DIR/data/monitor.db" ]]; then
  if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' | grep -Eq '^vpn-monitor(-app|-nginx)?$'; then
    fail 'Database ada tanpa marker setup tetapi monitor sedang berjalan. Hentikan dan backup secara manual sebelum fresh setup.'
  fi
  DATA_BACKUP="/root/webvpn-seed-data-$(date -u +%Y%m%d-%H%M%S)"
  install -d -m 700 "$DATA_BACKUP"
  mv "$ROOT_DIR/data" "$DATA_BACKUP/data"
  info "Data bawaan dipindahkan ke $DATA_BACKUP agar database deployment baru dibuat bersih."
fi
install -d -m 700 /etc/wireguard /etc/wireguard/clients /etc/webvpn "$ROOT_DIR/data"
umask 077
if [[ ! -f "$WG_CONFIG_PATH" ]]; then
  PRIVATE_KEY="$(wg genkey)"
  printf '%s\n' "$PRIVATE_KEY" > "/etc/wireguard/${WG_INTERFACE}.key"
  PREFIX="$(python3 -c 'import ipaddress,sys; print(ipaddress.ip_network(sys.argv[1],strict=True).prefixlen)' "$VPN_NETWORK")"
  cat > "$WG_CONFIG_PATH" <<EOF
[Interface]
Address = ${VPN_SERVER_IP}/${PREFIX}
ListenPort = ${WG_PORT}
PrivateKey = ${PRIVATE_KEY}
SaveConfig = false
EOF
  unset PRIVATE_KEY
  chmod 600 "$WG_CONFIG_PATH"
else
  info "Mempertahankan konfigurasi WireGuard yang sudah ada."
  wg-quick strip "$WG_CONFIG_PATH" >/dev/null || fail 'Config WireGuard yang sudah ada tidak valid.'
  grep -Eq "^[[:space:]]*Address[[:space:]]*=[[:space:]]*${VPN_SERVER_IP}/" "$WG_CONFIG_PATH" || fail 'VPN_SERVER_IP tidak cocok dengan config WireGuard.'
  grep -Eq "^[[:space:]]*ListenPort[[:space:]]*=[[:space:]]*${WG_PORT}[[:space:]]*$" "$WG_CONFIG_PATH" || fail 'WG_PORT tidak cocok dengan config WireGuard.'
fi

echo 'net.ipv4.ip_forward=1' > /etc/sysctl.d/99-webvpn.conf
sysctl --system >/dev/null
EGRESS="${VPN_EGRESS_INTERFACE:-$(ip -4 route get 1.1.1.1 | awk '{for(i=1;i<=NF;i++) if($i=="dev") {print $(i+1); exit}}')}"
[[ "$EGRESS" =~ ^[A-Za-z0-9_.-]{1,15}$ ]] || fail 'Tidak dapat mendeteksi interface internet; isi VPN_EGRESS_INTERFACE di .env.'

cat > /etc/webvpn/firewall.nft <<EOF
table inet webvpn_filter {
 chain forward {
  type filter hook forward priority filter; policy accept;
  iifname "${WG_INTERFACE}" oifname != "${WG_INTERFACE}" ip saddr ${VPN_NETWORK} tcp dport 853 drop
  iifname "${WG_INTERFACE}" oifname != "${WG_INTERFACE}" ip saddr ${VPN_NETWORK} udp dport 853 drop
  iifname "${WG_INTERFACE}" oifname != "${WG_INTERFACE}" meta nfproto ipv6 drop
 }
}
table ip webvpn_nat {
 chain prerouting {
  type nat hook prerouting priority dstnat; policy accept;
  iifname "${WG_INTERFACE}" ip saddr ${VPN_NETWORK} udp dport 53 dnat to ${VPN_SERVER_IP}:53
  iifname "${WG_INTERFACE}" ip saddr ${VPN_NETWORK} tcp dport 53 dnat to ${VPN_SERVER_IP}:53
 }
 chain postrouting {
  type nat hook postrouting priority srcnat; policy accept;
  oifname "${EGRESS}" ip saddr ${VPN_NETWORK} masquerade
 }
}
EOF
cat > /usr/local/sbin/webvpn-firewall-apply <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
nft delete table inet webvpn_filter 2>/dev/null || true
nft delete table ip webvpn_nat 2>/dev/null || true
nft -f /etc/webvpn/firewall.nft
/usr/local/sbin/webvpn-internet-access-apply
EOF
chmod 700 /usr/local/sbin/webvpn-firewall-apply
install -d -m 755 /var/lib/webvpn
if [[ ! -e /var/lib/webvpn/internet-access.enabled ]]; then
  printf 'true\n' > /var/lib/webvpn/internet-access.enabled
fi
cat > /usr/local/sbin/webvpn-internet-access-apply <<EOF
#!/usr/bin/env bash
set -Eeuo pipefail
table='webvpn_filter'
chain='forward'
nft list chain inet "\$table" "\$chain" >/dev/null
while read -r handle; do
  [[ -n "\$handle" ]] && nft delete rule inet "\$table" "\$chain" handle "\$handle"
done < <(nft -a list chain inet "\$table" "\$chain" | awk '/comment "webvpn-internet-block"/ {print \$NF}')
if [[ -f /var/lib/webvpn/internet-access.enabled ]] && grep -qx 'false' /var/lib/webvpn/internet-access.enabled; then
  nft insert rule inet "\$table" "\$chain" iifname '${WG_INTERFACE}' oifname != '${WG_INTERFACE}' ip saddr ${VPN_NETWORK} counter drop comment "webvpn-internet-block"
fi
EOF
chmod 700 /usr/local/sbin/webvpn-internet-access-apply
if ! nft list table inet webvpn_filter >/dev/null 2>&1; then
  nft -c -f /etc/webvpn/firewall.nft
fi
cat > /etc/systemd/system/webvpn-firewall.service <<EOF
[Unit]
Description=Web VPN forwarding, NAT, and DNS enforcement
After=network-online.target wg-quick@${WG_INTERFACE}.service
Wants=network-online.target
Requires=wg-quick@${WG_INTERFACE}.service
[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/local/sbin/webvpn-firewall-apply
ExecReload=/usr/local/sbin/webvpn-firewall-apply
[Install]
WantedBy=multi-user.target
EOF
cat > /etc/systemd/system/webvpn-internet-access.path <<'EOF'
[Unit]
Description=Watch Web VPN internet access setting

[Path]
PathChanged=/var/lib/webvpn/internet-access.enabled
Unit=webvpn-internet-access.service

[Install]
WantedBy=multi-user.target
EOF
cat > /etc/systemd/system/webvpn-internet-access.service <<'EOF'
[Unit]
Description=Apply Web VPN internet access setting
After=webvpn-firewall.service

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/webvpn-internet-access-apply
EOF

# Keep the legacy include file empty; the live list is managed through the app.
printf '# Managed by Web VPN Monitor; live rules are in /var/lib/webvpn/blocked-services.conf\n' > /etc/dnsmasq.d/webvpn-blocked-services.conf
install -d -m 755 /var/lib/webvpn
install -m 644 "$ROOT_DIR/deploy/blocked-services.conf" /var/lib/webvpn/blocked-services.conf
cat > /etc/dnsmasq.d/webvpn.conf <<EOF
interface=${WG_INTERFACE}
listen-address=${VPN_SERVER_IP}
bind-dynamic
no-resolv
server=${VPN_DNS_UPSTREAM:-1.1.1.1}
log-queries=extra
log-facility=${DNSMASQ_LOG_PATH}
conf-file=/var/lib/webvpn/blocked-services.conf
EOF
if ! grep -Eq '^[[:space:]]*conf-dir=/etc/dnsmasq\.d' /etc/dnsmasq.conf; then
  grep -Fqx 'conf-file=/etc/dnsmasq.d/webvpn.conf' /etc/dnsmasq.conf || echo 'conf-file=/etc/dnsmasq.d/webvpn.conf' >> /etc/dnsmasq.conf
fi
touch "$DNSMASQ_LOG_PATH"
chown dnsmasq:adm "$DNSMASQ_LOG_PATH"
chmod 640 "$DNSMASQ_LOG_PATH"

systemctl daemon-reload
systemctl enable --now "wg-quick@${WG_INTERFACE}"
systemctl enable --now webvpn-firewall.service
systemctl restart webvpn-firewall.service
systemctl enable --now webvpn-internet-access.path
dnsmasq --test
systemctl enable --now dnsmasq
systemctl restart dnsmasq
cat > /etc/systemd/system/webvpn-dnsmasq-reload.path <<'EOF'
[Unit]
Description=Watch Web VPN DNS blocklist changes

[Path]
PathChanged=/var/lib/webvpn/blocked-services.conf
Unit=webvpn-dnsmasq-reload.service

[Install]
WantedBy=multi-user.target
EOF
cat > /etc/systemd/system/webvpn-dnsmasq-reload.service <<'EOF'
[Unit]
Description=Reload dnsmasq after Web VPN blocklist changes
After=dnsmasq.service

[Service]
Type=oneshot
ExecStart=/usr/bin/systemctl restart dnsmasq.service
EOF
systemctl daemon-reload
systemctl enable --now webvpn-dnsmasq-reload.path
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q '^Status: active'; then
  ufw route allow in on "${WG_INTERFACE}" out on "$EGRESS" from "$VPN_NETWORK" >/dev/null
  ufw allow "${WG_PORT}/udp" >/dev/null
  ufw allow 80/tcp >/dev/null
  ufw allow "${PORT}/tcp" >/dev/null
fi

python3 - "$ROOT_DIR/data/participants.csv" "$VPN_NETWORK" "$VPN_SERVER_IP" "$VPN_CLIENT_RANGE_START" "$VPN_CLIENT_RANGE_END" "$CLIENT_NAME_PREFIX" "$CLIENT_EMAIL_DOMAIN" <<'PY'
import csv,ipaddress,sys
path,network_text,server_text,first_text,last_text,name_prefix,email_domain=sys.argv[1:]
net=ipaddress.ip_network(network_text,strict=True); server=ipaddress.ip_address(server_text)
first,last=map(ipaddress.ip_address,(first_text,last_text))
if first>last: raise SystemExit('[ERROR] Range client terbalik.')
rows=[]
for n,value in enumerate(range(int(first),int(last)+1),1):
 ip=ipaddress.ip_address(value)
 if ip not in net or ip in (server,net.network_address,net.broadcast_address): raise SystemExit(f'[ERROR] IP client {ip} tidak dapat dipakai.')
 name=f'{name_prefix}{n}'
 rows.append([name,f'{name}@{email_domain}','','',f'{name}.conf',str(ip)])
with open(path,'w',newline='',encoding='utf-8') as f:
 w=csv.writer(f); w.writerow(['name','email','password','affiliation','target_file','IP VPN']); w.writerows(rows)
PY
chmod 600 "$ROOT_DIR/data/participants.csv"
export VPN_NETWORK VPN_SERVER_IP WG_INTERFACE WG_PORT WG_CONFIG_PATH
export CLIENT_DIR=/etc/wireguard/clients VPN_DNS="$VPN_SERVER_IP"
bash "$ROOT_DIR/automation/create-wg-clients.sh" "$ROOT_DIR/data/participants.csv" "$WG_PUBLIC_IP"

info 'Membangun dan menjalankan web monitor.'
cd "$ROOT_DIR"
"${COMPOSE[@]}" -f "$ROOT_DIR/docker-compose.prod.yml" up -d --build
printf 'initialized\n' > "$ROOT_DIR/data/.webvpn-install-id"
chmod 600 "$ROOT_DIR/data/.webvpn-install-id"
printf '\nSetup selesai.\nWeb monitor: http://<IP-server>/ (Nginx)\nApp langsung: http://<IP-server>:%s\nWireGuard: %s:%s/udp\nClient config: /etc/wireguard/clients/\n' "$PORT" "$WG_PUBLIC_IP" "$WG_PORT"
