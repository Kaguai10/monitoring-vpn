# WireGuard client generator

`create-wg-clients.sh` creates client configuration files and adds peers to the active WireGuard interface. The main installer invokes it with the local directory generated from `.env` settings:

```bash
sudo ./run.sh
```

To use it separately, provide a CSV with `target_file` and `IP VPN` columns and the public endpoint:

```bash
sudo bash automation/create-wg-clients.sh /path/to/user-directory.csv vpn.example.org
```

Optional environment variables configure the WireGuard interface, server config path, client output directory, DNS address, port, VPN subnet, server address, and allowed IPs. Client configuration files contain private keys. Keep them on the server with restrictive permissions and never commit them.
