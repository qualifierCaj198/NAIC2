# NAIC2

Node.js (Express + EJS) app to look up an Individual NPN across many states using NAIC public APIs, then show the license summary (from the search endpoint) and list all company appointments per state.

## Run locally

```bash
npm ci
npm start
# open http://localhost:3000
```

## Deploy from GitHub to a Vultr server (via SSH user + password)

Use the included GitHub Actions workflow: `.github/workflows/deploy.yml`

### Required GitHub secrets

- `SSH_HOST` – your server IP
- `SSH_USER` – typically `root`
- `SSH_PASS` – your password
- `SSH_PORT` – usually `22`
- `APP_DIR` – absolute path on the server to deploy into, e.g. `/var/www/naic2`
- `REPO_URL` – `https://github.com/qualifierCaj198/NAIC2`

### One-time server bootstrap

SSH into your server and run:

```bash
apt-get update -y
apt-get install -y git curl
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
npm i -g pm2
mkdir -p /var/www/naic2
```

### First manual run (if you want to try without Actions)

```bash
cd /var/www/naic2
git clone https://github.com/qualifierCaj198/NAIC2 .
npm ci --omit=dev
pm2 start server.js --name naic2
pm2 save
```

## Notes

- If a state returns no info at any step, the UI shows **"Not found in &lt;STATE&gt;"** instead of a server error.
- Basic caching (5m) is enabled to avoid hammering the API while testing.
- API calls are retried on transient failures and run with limited concurrency.