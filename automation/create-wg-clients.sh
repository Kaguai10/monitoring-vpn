#!/usr/bin/env bash
set -Eeuo pipefail

# Bulk WireGuard client generator.
# Usage:
#   sudo bash create-wg-clients.sh /path/to/participants.csv PUBLIC_IP_OR_DNS
#
# Optional environment variables:
#   WG_INTERFACE=wg0
#   WG_CONFIG=/etc/wireguard/wg0.conf
#   CLIENT_DIR=/etc/wireguard/clients
#   VPN_DNS=10.66.66.1
#   WG_PORT=51820
#   CLIENT_ALLOWED_IPS=0.0.0.0/0

WG_INTERFACE="${WG_INTERFACE:-wg0}"
WG_CONFIG="${WG_CONFIG:-/etc/wireguard/${WG_INTERFACE}.conf}"
CLIENT_DIR="${CLIENT_DIR:-/etc/wireguard/clients}"
VPN_DNS="${VPN_DNS:-10.66.66.1}"
WG_PORT="${WG_PORT:-51820}"
CLIENT_ALLOWED_IPS="${CLIENT_ALLOWED_IPS:-0.0.0.0/0}"
VPN_NETWORK="${VPN_NETWORK:-10.66.66.0/24}"
VPN_SERVER_IP="${VPN_SERVER_IP:-10.66.66.1}"

usage() {
    echo "Usage: sudo bash $0 /path/to/file.csv PUBLIC_IP_OR_DNS"
    exit 1
}

[[ $# -eq 2 ]] || usage
CSV_FILE="$1"
ENDPOINT_HOST="$2"

if [[ "${EUID}" -ne 0 ]]; then
    echo "[ERROR] Jalankan script sebagai root: sudo bash $0 ..."
    exit 1
fi

[[ -f "$CSV_FILE" ]] || { echo "[ERROR] CSV tidak ditemukan: $CSV_FILE"; exit 1; }
[[ -f "$WG_CONFIG" ]] || { echo "[ERROR] Konfigurasi server tidak ditemukan: $WG_CONFIG"; exit 1; }
ip link show "$WG_INTERFACE" >/dev/null 2>&1 || {
    echo "[ERROR] Interface $WG_INTERFACE tidak aktif/ tidak ditemukan."
    exit 1
}

for cmd in wg python3; do
    command -v "$cmd" >/dev/null 2>&1 || {
        echo "[ERROR] Perintah '$cmd' belum terpasang."
        exit 1
    }
done

# Validate and parse only the two columns required from the CSV.
# Passwords and other personal data are deliberately ignored.
ROWS_FILE="$(mktemp)"
trap 'rm -f "$ROWS_FILE"' EXIT

python3 - "$CSV_FILE" "$ROWS_FILE" "$VPN_NETWORK" "$VPN_SERVER_IP" <<'PY'
import csv, ipaddress, os, re, sys

source, output, network_text, server_text = sys.argv[1:]
network = ipaddress.ip_network(network_text, strict=True)
server_ip = ipaddress.ip_address(server_text)
if server_ip not in network:
    raise SystemExit("[ERROR] VPN_SERVER_IP harus berada di dalam VPN_NETWORK.")
seen_files, seen_ips = set(), set()
rows = []

with open(source, newline="", encoding="utf-8-sig") as f:
    reader = csv.DictReader(f)
    required = {"target_file", "IP VPN"}
    if not reader.fieldnames or not required.issubset(set(reader.fieldnames)):
        raise SystemExit(
            "[ERROR] CSV harus memiliki header: target_file dan IP VPN"
        )

    for line_no, row in enumerate(reader, start=2):
        filename = (row.get("target_file") or "").strip()
        ip_text = (row.get("IP VPN") or "").strip()

        if not filename and not ip_text:
            continue
        if not filename or not ip_text:
            raise SystemExit(f"[ERROR] Baris {line_no}: target_file/IP VPN kosong.")

        # Only allow a plain filename ending in .conf; reject paths and shell-sensitive names.
        if not re.fullmatch(r"[A-Za-z0-9_.@+-]+\.conf", filename):
            raise SystemExit(f"[ERROR] Nama target_file tidak aman pada baris {line_no}: {filename!r}")

        try:
            addr = ipaddress.ip_address(ip_text)
        except ValueError:
            raise SystemExit(f"[ERROR] IP tidak valid pada baris {line_no}: {ip_text}")

        if addr.version != 4 or addr not in network:
            raise SystemExit(
                f"[ERROR] IP {ip_text} harus IPv4 di dalam subnet {network}."
            )
        if addr == server_ip or addr == network.network_address or addr == network.broadcast_address:
            raise SystemExit(f"[ERROR] IP {ip_text} adalah alamat network/server/broadcast.")

        if filename in seen_files:
            raise SystemExit(f"[ERROR] target_file duplikat: {filename}")
        if ip_text in seen_ips:
            raise SystemExit(f"[ERROR] IP VPN duplikat: {ip_text}")

        seen_files.add(filename)
        seen_ips.add(ip_text)
        rows.append((filename, ip_text))

if not rows:
    raise SystemExit("[ERROR] Tidak ada baris peserta yang valid.")

with open(output, "w", encoding="utf-8") as f:
    for filename, ip_text in rows:
        f.write(f"{filename}\t{ip_text}\n")

print(f"[OK] CSV valid: {len(rows)} peserta.")
PY

SERVER_PUBLIC_KEY="$(wg show "$WG_INTERFACE" public-key)"
[[ -n "$SERVER_PUBLIC_KEY" ]] || { echo "[ERROR] Gagal membaca public key server."; exit 1; }

install -d -m 700 "$CLIENT_DIR"

# Prevent accidental overwrite or duplicate addresses already configured on server.
while IFS=$'\t' read -r filename client_ip; do
    config_has_ip=0
    file_exists=0

    if grep -Eq "^[[:space:]]*AllowedIPs[[:space:]]*=[[:space:]]*${client_ip//./\\.}/32([[:space:]]|$)" "$WG_CONFIG"; then
        config_has_ip=1
    fi
    [[ -e "$CLIENT_DIR/$filename" ]] && file_exists=1

    if [[ "$config_has_ip" -eq 1 && "$file_exists" -eq 1 ]]; then
        echo "[SKIP] $filename ($client_ip) sudah ada."
    elif [[ "$config_has_ip" -eq 1 || "$file_exists" -eq 1 ]]; then
        echo "[ERROR] Konflik untuk $client_ip / $filename."
        echo "        Periksa $WG_CONFIG dan $CLIENT_DIR sebelum melanjutkan."
        exit 1
    fi
done < "$ROWS_FILE"

# Backup the server config before making any changes.
BACKUP="${WG_CONFIG}.backup.$(date +%Y%m%d-%H%M%S)"
cp -a "$WG_CONFIG" "$BACKUP"
chmod 600 "$BACKUP"
echo "[OK] Backup konfigurasi: $BACKUP"

created=0
skipped=0
while IFS=$'\t' read -r filename client_ip; do
    if grep -Eq "^[[:space:]]*AllowedIPs[[:space:]]*=[[:space:]]*${client_ip//./\\.}/32([[:space:]]|$)" "$WG_CONFIG"; then
        ((skipped+=1))
        continue
    fi

    client_private="$(wg genkey)"
    client_public="$(printf '%s' "$client_private" | wg pubkey)"

    # Write client config with restrictive permissions.
    client_tmp="$(mktemp "$CLIENT_DIR/.client.XXXXXX")"
    cat > "$client_tmp" <<EOF
[Interface]
PrivateKey = ${client_private}
Address = ${client_ip}/32
DNS = ${VPN_DNS}

[Peer]
PublicKey = ${SERVER_PUBLIC_KEY}
Endpoint = ${ENDPOINT_HOST}:${WG_PORT}
AllowedIPs = ${CLIENT_ALLOWED_IPS}
PersistentKeepalive = 25
EOF
    chmod 600 "$client_tmp"
    mv "$client_tmp" "$CLIENT_DIR/$filename"

    # Add peer to persistent server config and apply it live without restarting wg0.
    cat >> "$WG_CONFIG" <<EOF

# VPN client: ${filename}
[Peer]
PublicKey = ${client_public}
AllowedIPs = ${client_ip}/32
EOF

    if ! wg set "$WG_INTERFACE" peer "$client_public" allowed-ips "${client_ip}/32"; then
        echo "[ERROR] Gagal menerapkan peer $filename. Periksa konfigurasi server."
        exit 1
    fi

    ((created+=1))
    echo "[CREATED] $filename -> $client_ip"
done < "$ROWS_FILE"

chmod 600 "$WG_CONFIG"

echo
echo "Selesai."
echo "Dibuat baru : $created"
echo "Dilewati    : $skipped"
echo "Folder conf : $CLIENT_DIR"
echo "Backup      : $BACKUP"
echo
echo "[PENTING] File .conf berisi private key peserta. Jangan bagikan folder ini secara publik."
echo "[PENTING] Script tidak mengubah firewall/NAT dan tidak me-restart WireGuard."
