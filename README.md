# Web VPN Monitor

Web VPN Monitor menjalankan server WireGuard dan dashboard untuk memantau koneksi user, bandwidth, aktivitas DNS, notifikasi, dan aturan jaringan. Installer otomatis menyiapkan dependensi host, WireGuard, dnsmasq, firewall, user VPN, Docker, aplikasi, dan Nginx.

## Cara memasang di server baru

Installer tidak bergantung pada AWS atau penyedia cloud tertentu. Installer mendukung server/VPS/VM Debian atau Ubuntu dengan `systemd`, akses `sudo`/root, koneksi internet, kernel yang menyediakan WireGuard, dan alamat publik atau hostname yang dapat dijangkau user VPN. Beberapa layanan container/hosting membatasi perubahan interface dan firewall; lingkungan seperti itu tidak dapat menjalankan installer ini.

### 1. Ambil project

```bash
sudo apt-get update
sudo apt-get install -y git
git clone https://github.com/Kaguai10/monitoring-vpn.git
cd monitoring-vpn
```

### 2. Buat dan isi `.env`

```bash
sudo install -m 600 .env.example .env
sudo nano .env
```

Atur minimal nilai berikut sebelum installer dijalankan:

| Variable | Nilai yang harus diatur |
|---|---|
| `ADMIN_USERNAME` | Nama admin dashboard |
| `ADMIN_PASSWORD` | Password awal yang kuat, minimal 12 karakter; berlaku juga saat ganti/reset password |
| `WG_PUBLIC_IP` | IPv4 publik server atau hostname DNS yang mengarah ke server |
| `WG_PORT` | Port UDP WireGuard; default `51820` |
| `WG_INTERFACE` | Nama interface WireGuard; default `wg0` |
| `VPN_NETWORK` | Subnet VPN IPv4, contoh `10.66.66.0/24` |
| `VPN_SERVER_IP` | IP server di subnet VPN, contoh `10.66.66.1` |
| `VPN_CLIENT_RANGE_START` | IP pertama yang akan diberikan ke user |
| `VPN_CLIENT_RANGE_END` | IP terakhir yang akan diberikan ke user |
| `CLIENT_NAME_PREFIX` | Awalan nama akun otomatis, contoh `client` |
| `CLIENT_EMAIL_DOMAIN` | Domain email akun otomatis; `example.invalid` hanya nilai contoh |
| `PORT` | Port app internal, default `3000`; Nginx akan memakai nilai ini otomatis |

Pastikan subnet, IP server, dan rentang client tidak bertabrakan dengan jaringan yang sudah ada. Domain `example.invalid` adalah domain contoh yang tidak bisa menerima email; ganti jika email user memang diperlukan. Jangan mengubah nilai secret sesi secara manual setelah installer membuatnya.

### 3. Jalankan installer

```bash
sudo ./run.sh
```

Perintah ini satu-satunya langkah untuk memasang dan menyalakan service. `run.sh` memasang kebutuhan host, membuat konfigurasi WireGuard bila belum ada, menyiapkan firewall dan DNS, membuat file client, membangun container, lalu menyalakan app dan Nginx. Tidak perlu menjalankan `docker compose up` secara terpisah.

Jika `.env` belum ada, `run.sh` membuat file dengan izin privat lalu berhenti. Isi file tersebut, kemudian jalankan `sudo ./run.sh` lagi. Pada setup pertama, proses dapat berlangsung beberapa menit karena memasang paket dan membangun image.

### 4. Buka akses jaringan

Pada firewall cloud/security group, izinkan:

- TCP `80` dan `443` untuk dashboard melalui Nginx.
- UDP sesuai `WG_PORT` untuk koneksi WireGuard.

Jika UFW aktif di server, installer menambahkan aturan untuk port tersebut. Pastikan juga DNS hostname pada `WG_PUBLIC_IP` sudah mengarah ke server.

Dashboard tersedia di `http://<IP-atau-hostname-server>/` dan `https://<IP-atau-hostname-server>/`. Saat `sudo ./run.sh` dijalankan, installer otomatis membuat sertifikat self-signed yang cocok dengan `WG_PUBLIC_IP` dan memasangnya ke Nginx. Tidak perlu mengunggah atau membuat sertifikat secara manual. Browser akan menampilkan peringatan kepercayaan; pengguna bisa melanjutkan, tetapi untuk pemakaian publik sebaiknya ganti dengan sertifikat dari CA tepercaya. App internal hanya menerima koneksi dari localhost melalui Nginx; port `PORT` tidak perlu dibuka.

File konfigurasi WireGuard user dibuat di `/etc/wireguard/clients/`. File tersebut berisi private key dan hanya boleh dibagikan kepada pemilik akun terkait.


## Membuat user dan konfigurasi VPN

User VPN dibuat otomatis oleh `run.sh`; tidak perlu membuat akun satu per satu di dashboard. Sebelum instalasi, tentukan rentang client di `.env`, misalnya `10.66.66.101` sampai `10.66.66.115`. Saat dijalankan, installer akan:

1. Membuat satu nama user untuk setiap IP di rentang tersebut, memakai `CLIENT_NAME_PREFIX` dan nomor urut, misalnya `client1`.
2. Membuat alamat email berdasarkan `CLIENT_EMAIL_DOMAIN`.
3. Membuat key WireGuard, menambahkan peer ke server, dan menyimpan konfigurasi client sebagai `/etc/wireguard/clients/<nama-user>.conf`.
4. Menyimpan daftar nama, email, dan IP di `data/participants.csv` agar dashboard dapat menampilkan identitas yang cocok dengan peer.

Untuk melihat file konfigurasi yang tersedia:

```bash
sudo find /etc/wireguard/clients -maxdepth 1 -type f -name '*.conf' -printf '%f\n'
```

Untuk mengetahui nama dan IP yang cocok dengan file, lihat CSV lokal sebagai administrator:

```bash
sudo less data/participants.csv
```

Untuk menambah user setelah instalasi, gunakan IP yang belum dipakai: pertahankan `VPN_CLIENT_RANGE_START`, lalu naikkan `VPN_CLIENT_RANGE_END` di `.env` agar mencakup IP baru dalam subnet. Pertahankan `VPN_NETWORK`, `VPN_SERVER_IP`, dan `CLIENT_NAME_PREFIX` supaya peer lama tidak berubah. Jalankan kembali:

```bash
sudo ./run.sh
```

Installer melewati peer dan file konfigurasi yang sudah ada, lalu membuat konfigurasi untuk alamat baru dalam rentang. File konfigurasi baru muncul di `/etc/wireguard/clients/`. Dashboard hanya memiliki akun admin untuk pengelola; user VPN tidak mendapat akun login dashboard.

## Perintah operasional

Installer menyalakan deployment produksi dari `docker-compose.prod.yml`. Perintah berikut dapat dipakai untuk memeriksa service setelah instalasi:

```bash
sudo docker compose -f docker-compose.prod.yml ps
sudo docker compose -f docker-compose.prod.yml logs -f
sudo docker compose -f docker-compose.prod.yml restart
sudo systemctl status wg-quick@wg0
sudo systemctl status dnsmasq
sudo systemctl status webvpn-firewall
```

Jika lupa password admin, reset melalui container. Tanpa argumen, perintah membuat password acak dan menampilkannya sekali:

```bash
sudo docker compose -f docker-compose.prod.yml exec app node src/reset-password.js
```

Untuk memperbarui aplikasi setelah mengambil perubahan source terbaru:

```bash
git pull
sudo ./run.sh
```

Saat dijalankan ulang, script mempertahankan database serta konfigurasi WireGuard yang valid. Jangan menghapus folder `data/` atau file di `/etc/wireguard/clients/` jika ingin mempertahankan data dan konfigurasi yang sudah dibuat.

## Konfigurasi tambahan

Pengaturan berikut tersedia di `.env`:

- `SESSION_SECRET` dan `RESET_KEY` dibuat otomatis jika kosong.
- `DB_PATH` opsional untuk memilih file SQLite khusus; kosong berarti `data/monitor.db`.
- `CLIENT_ALLOWED_IPS` menentukan rute trafik client. Contoh mengarahkan seluruh trafik IPv4 dan IPv6 ke tunnel; forwarding IPv6 diblokir oleh konfigurasi server ini.
- `VPN_DNS_UPSTREAM` memilih DNS resolver upstream dnsmasq.
- `VPN_EGRESS_INTERFACE` memilih interface keluar internet; jika kosong, installer mendeteksi default route.
- `TZ` mengatur zona waktu container.
- `POLL_INTERVAL`, `DNS_POLL_INTERVAL`, `DISCONNECT_TIMEOUT`, dan `DATA_RETENTION_HOURS` mengatur pemantauan serta retensi data.
- `DEMO_MODE=true` memakai data simulasi, `false` memakai WireGuard aktif, dan `auto` memilih berdasarkan ketersediaan WireGuard.
- `WG_CONFIG_PATH` harus berbentuk `/etc/wireguard/<WG_INTERFACE>.conf`.
- `DNSMASQ_LOG_PATH` mengatur lokasi log dnsmasq.

Daftar domain blok dan akses internet user VPN dapat dikelola dari halaman Settings. DNS biasa diarahkan melalui dnsmasq dan DoT port 853 diblokir. DNS over HTTPS melalui HTTPS dan akses langsung ke IP memerlukan kebijakan jaringan tambahan.

## Data dan keamanan repository

- `.env` dan semua file `.env.*` selain `.env.example` diabaikan Git.
- `data/` berisi CSV user lokal dan database SQLite, serta diabaikan Git.
- File client di `/etc/wireguard/clients/`, private key, log, dan sertifikat tidak boleh dimasukkan ke repository.
- Contoh CSV aman ada di `examples/user-directory.csv.example`; jangan taruh data produksi di sana.

Sebelum push perubahan, periksa:

```bash
git status --short
git diff --check
git check-ignore .env data/monitor.db data/participants.csv
```

## Pengembangan lokal

Untuk menjalankan app tanpa menyiapkan WireGuard, isi `.env` lokal dan set `DEMO_MODE=true`, lalu jalankan:

```bash
npm ci
npm start
```

Mode demo memakai data simulasi dan tidak menulis aturan DNS/firewall host. Jangan gunakan file `.env` produksi atau database produksi untuk pengembangan.
