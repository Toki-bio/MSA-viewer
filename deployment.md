# Running the ViewAlign server behind a domain

ViewAlign needs no server: the hosted app on GitHub Pages does everything in the browser.
The optional Node.js server (`server.js`) adds hosted BLAST databases, a native MAFFT
endpoint, BAM-to-SAM conversion with samtools, and loading files over SSH. It also serves
the viewer itself, so the page and its `/api` calls share one address.

This guide puts the server on a Linux machine behind nginx with HTTPS. Read the access rules
below first: by default the server accepts only requests from its own machine.

## What the server reads from the environment

The server reads these environment variables, and nothing else. It does not read a `.env`
file. Set them in the shell, in a systemd unit, or in a PM2 ecosystem file.

| Variable | Meaning | Default |
|---|---|---|
| `PORT` | Port to listen on | `3000` |
| `HOST` | Address to bind | `127.0.0.1` (this machine only) |
| `ALLOWED_HOSTS` | Comma-separated host names that may appear in the `Host` header, besides `localhost` and IP addresses | none |
| `TAILSCALE_IP` | One more address accepted as a host name | none |
| `CORS_ORIGIN` | One more web origin allowed to call `/api` | `http://localhost:PORT` and `http://127.0.0.1:PORT` |
| `ALLOW_REMOTE_FILE_ACCESS` | `1` lets clients that are not on this machine use the file and SSH routes, add or delete databases and run MAFFT/BLAST (they still need the access key) | off |
| `STATIC_SERVE_ALL` | `1` serves every file of the folder, not only the viewer's own files | off |
| `LOCAL_FILE_ROOTS` | Folders the local-file routes may read, separated by the path delimiter (`:` on Linux) | the ViewAlign folder and the home folder |
| `SSH_KEY_PATH` | Private key used by SSH file loading | `~/.ssh/id_ed25519` (`id_ed25519.ppk` on Windows) |
| `MAFFT_BIN` | Path of the native MAFFT binary used by `POST /api/mafft` | `/staging/conda/envs/bioinfo/bin/mafft`, so set it |
| `CHILD_OUTPUT_MAX_BYTES` | Output cap for child processes such as samtools | 200 MB |

BLAST+ (`blastn`, `makeblastdb`) and `samtools` are looked up on `PATH`. There are no
variables for them. The viewer's own "BLAST-like" search runs in the browser and needs no
BLAST+ install.

## Access rules that matter behind a proxy

- **Host check.** The `Host` header must be `localhost`, an IP address, or a name in
  `ALLOWED_HOSTS`. Any other name gets `403 Host not allowed`. With nginx passing
  `Host $host`, set `ALLOWED_HOSTS=msa-viewer.example.com` (your domain).
- **Local-file and SSH routes.** `/api/local-cat`, `/api/bam2sam`, `/api/ssh-cat`,
  `/api/ssh-ls`, `/api/ssh-poll-file`, `/api/queue-file` and `/api/poll-file` answer only
  clients on the same machine. A request that carries `X-Forwarded-For` or `X-Real-IP`
  counts as remote, so through the nginx recipe below these routes return `403`. That is
  the safe setting for a public site. Set `ALLOW_REMOTE_FILE_ACCESS=1` only for a private
  site, because it lets every visitor read files that the server user can read inside
  `LOCAL_FILE_ROOTS` and use your SSH servers.
- **Routes that change the server or run programs.** Adding or deleting a database and running MAFFT or
  BLAST (`POST /api/blast-db`, `DELETE /api/blast-db/...`, `POST /api/mafft`, `/api/blast`,
  `/api/blast-all`) follow the same rule: same machine only unless `ALLOW_REMOTE_FILE_ACCESS=1`.
- **Access key.** All the routes of the two points above, and `/api/ssh-servers`, also need the access
  key. The server prints a link `http://localhost:PORT/?key=...` at start and keeps the key in
  `~/.viewalign/access-key` of the server user. A browser must open the site once with `/?key=<key>`
  (through nginx: `https://msa-viewer.example.com/?key=<key>`) to get the cookie. Without it these routes
  return `401` and the page shows a note; the viewer itself works.
- **Files served.** Only the viewer's own files, `snapshots/` and the added databases are served.
  `STATIC_SERVE_ALL=1` serves the whole folder (development pages); do not set it on a public site.
- **Cross-site requests.** `/api` requests sent by another site's page are refused. The
  viewer served by this same server passes.

## Step 1: Install

```bash
cd /srv
git clone https://github.com/Toki-bio/MSA-viewer.git msa-server
cd msa-server
npm install
```

Optional tools, only for the routes that use them:

```bash
sudo apt install -y mafft samtools
```

## Step 2: Start the server with PM2

```bash
npm install -g pm2
cd /srv/msa-server
PORT=3000 ALLOWED_HOSTS=msa-viewer.example.com MAFFT_BIN=/usr/bin/mafft \
  pm2 start server.js --name msa-viewer --max-memory-restart 500M
pm2 save
pm2 startup systemd
```

The server stays on `127.0.0.1`, so only nginx on the same machine can reach it.

## Step 3: nginx with HTTPS

```bash
sudo apt update && sudo apt install -y nginx certbot python3-certbot-nginx
```

`/etc/nginx/sites-available/msa-viewer`:

```nginx
server {
    listen 80;
    server_name msa-viewer.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
        client_max_body_size 10m;
    }
}
```

The server accepts request bodies up to 10 MB, which `client_max_body_size` matches.

```bash
sudo ln -s /etc/nginx/sites-available/msa-viewer /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d msa-viewer.example.com
```

Check it: `curl https://msa-viewer.example.com/api/viewer-info` should return JSON. A
`Host not allowed` reply means `ALLOWED_HOSTS` is missing the name.

## Step 4: The page finds the server by itself

The viewer calls `/api/...` on the address it was loaded from. Open
`https://msa-viewer.example.com/` and the viewer works; the file, SSH and database features appear only
for a browser that has the access key and only where the access rules above allow them. There is no setting to
change in `script.js`. The page on GitHub Pages never looks for a server, so the hosted
app and your server are separate sites.

## Updating

```bash
cd /srv/msa-server
git pull
npm install
pm2 restart msa-viewer
```
