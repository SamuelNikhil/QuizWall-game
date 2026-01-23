# EC2 Deployment Guide – Slingshot Realtime Server

This document walks through provisioning and running the Geckos.io realtime server on an AWS EC2 instance. Follow each section in order. The server listens on **TCP/UDP 3000** and must remain reachable from the public internet so clients and controllers can connect.

---

## 1. Launch & Secure the Instance

1. **Choose an AMI**: Amazon Linux 2023 (x86_64) or Ubuntu 22.04 LTS both work. A `t3.small` (2 vCPU / 2GB RAM) is usually enough.
2. **Key pair**: Create/download an SSH key so you can log in later.
3. **Security group**: Allow the following inbound rules (source can be your IP for SSH and `0.0.0.0/0` for game traffic):
   | Protocol | Port | Purpose |
   | --- | --- | --- |
   | TCP | 22 | SSH administration |
   | TCP | 3000 | Geckos signaling/control |
   | UDP | 3000 | Geckos realtime data |
   | (Optional) TCP | 80 / 443 | If you plan to reverse proxy through Nginx |
4. Launch the instance and note its public IPv4 address or DNS name.

---

## 2. Install Runtime Dependencies

SSH into the instance:
```bash
ssh -i /path/to/key.pem ec2-user@<PUBLIC_IP>
```

Install Node.js 20 via `nvm` (works on both Amazon Linux and Ubuntu):
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.nvm/nvm.sh
nvm install 20
nvm alias default 20
```

Optional but recommended: install `pm2` globally to manage the process.
```bash
npm install -g pm2
```

---

## 3. Fetch the Server Code

```bash
cd /opt
sudo mkdir -p slingshot-server && sudo chown $USER:$USER slingshot-server
cd slingshot-server
# if you already pushed the repo to GitHub/GitLab:
git clone <YOUR_REPO_URL> .
cd SlingShot-game/server
npm ci
```

The server only needs the `@geckos.io/server`, `express`, and `cors` packages, all handled by `npm ci`.

---

## 4. Configure Environment

Create a minimal `.env` (or export variables in the shell) if you want to override defaults:
```bash
echo "PORT=3000" > .env
```

By default the server already falls back to `PORT=3000`, so this step is optional. No database connection is required.

---

## 5. Run & Verify (manual test)

```bash
npm start
```

You should see `Slingshot Geckos.io server running on port 3000`. From your laptop run a quick check (replace `<PUBLIC_IP>`):
```bash
# TCP reachability
tnc <PUBLIC_IP> -Port 3000  # Windows
nc -vz <PUBLIC_IP> 3000     # macOS/Linux

# UDP check (macOS/Linux)
echo "ping" | nc -u -w1 <PUBLIC_IP> 3000
```

Once validated, stop the process (Ctrl+C) and set up a service so it survives reboots.

---

## 6. Keep the Server Running (choose one)

### Option A – PM2
```bash
pm2 start index.js --name slingshot-server --cwd /opt/slingshot-server/SlingShot-game/server
pm2 save
pm2 startup systemd  # follow the command it prints to enable auto-start
```

### Option B – Systemd Service
Create `/etc/systemd/system/slingshot-server.service` (sudo required):
```ini
[Unit]
Description=Slingshot Geckos Realtime Server
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/slingshot-server/SlingShot-game/server
Environment="PORT=3000"
ExecStart=/home/ec2-user/.nvm/versions/node/v20.*/bin/node index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```
Enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable slingshot-server
sudo systemctl start slingshot-server
sudo systemctl status slingshot-server
```

---

## 7. (Optional) Docker-Based Deployment

The repository already contains `server/Dockerfile`. To run inside Docker on EC2:
```bash
sudo yum install -y docker
sudo systemctl enable --now docker
cd /opt/slingshot-server/SlingShot-game/server
sudo docker build -t slingshot-server .
sudo docker run -d --name slingshot-server \
  -p 3000:3000/tcp \
  -p 3000:3000/udp \
  --restart unless-stopped \
  slingshot-server
```

Docker makes upgrades trivial: rebuild the image and restart the container.

---

## 8. Wire Up the Client

Set `VITE_SERVER_URL` (and optionally `VITE_SERVER_PORT`) in the client `.env` to the EC2 public DNS, e.g.
```
VITE_SERVER_URL=https://<your-domain-or-ip>
VITE_SERVER_PORT=3000
```
Rebuild & redeploy the client so controllers point to the EC2 server.

---

## 9. Observability & Maintenance

- **Logs**: `pm2 logs slingshot-server` or `journalctl -u slingshot-server -f`
- **Updates**: pull the latest code, run `npm ci`, then `pm2 restart` or `systemctl restart`.
- **Backups**: code is stateless; back up only if you keep configs locally.
- **Scaling**: use a larger EC2 instance or multiple instances behind a UDP-capable load balancer if needed.

You now have the realtime Geckos server running on EC2 with both TCP and UDP traffic open for controllers and hosts.
