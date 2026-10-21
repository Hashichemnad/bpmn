# ProcessHub — Deployment Guide

This guide is for the IT person who installs and runs ProcessHub on a company server. You do not need to
be a developer: every step is a command to copy, followed by what you should see. Commands that start with
`sudo` need administrator rights on the server.

Contents

1. [What you are installing](#1-what-you-are-installing)
2. [Server sizing](#2-server-sizing)
3. [Before you start](#3-before-you-start)
4. [Step by step: install on an Ubuntu VM](#4-step-by-step-install-on-an-ubuntu-vm)
5. [Domain and HTTPS](#5-domain-and-https)
6. [First sign-in](#6-first-sign-in)
7. [Backups](#7-backups)
8. [Restore](#8-restore)
9. [Updates](#9-updates)
10. [Monitoring](#10-monitoring)
11. [Troubleshooting](#11-troubleshooting)
12. [Reference](#12-reference)

---

## 1. What you are installing

ProcessHub runs as five Docker containers on **one Linux server**, started together with Docker Compose
from the file `docker-compose.prod.yml`:

```
  Users' browsers ──HTTPS (443)──►  caddy     reverse proxy: HTTPS certificate, http → https redirect
                                     │
                                     ▼
                                    web       nginx: the web application, forwards /api to the API
                                     │
                                     ▼
                                    api       the ProcessHub server ──► internet: AI provider, GitHub/GitLab,
                                   │    │                                         e-mail server (optional)
                                   ▼    ▼
                           postgres      storage
                           database      uploaded files (attachments, logos)
```

- Only **caddy** is reachable from outside, on ports **80** and **443**. The database and the file storage
  are on an internal network: they have no published ports and no internet access.
- All data lives in Docker **volumes** on the server: `postgres-data` (database), `storage-data` (files),
  `caddy-data` (HTTPS certificates), `api-data`.
- Your settings and secrets live in one file: **`.env`** in the ProcessHub folder.

## 2. Server sizing

| Users (named) | Typical at the same time | vCPU | RAM   | Data disk | Azure (UAE North) | AWS (me-central-1) |
| ------------- | ------------------------ | ---- | ----- | --------- | ----------------- | ------------------ |
| up to 250     | up to 50                 | 4    | 8 GB  | 128 GB    | `Standard_D4s_v5` | `m6i.xlarge`       |
| 250 – 500     | up to 120                | 8    | 16 GB | 256 GB    | `Standard_D8s_v5` | `m6i.2xlarge`      |

- **Operating system:** Ubuntu Server 24.04 LTS (64-bit, x86). Other Linux distributions with Docker work too,
  but this guide uses Ubuntu.
- **Disks:** a 30 GB OS disk plus a separate **SSD data disk** (Azure _Premium SSD_, AWS _gp3_) for Docker
  data and local backups. Size it for your attachments: the database itself rarely exceeds a few GB; uploaded
  files and 14 days of backups use most of the space.
- The defaults in `.env` fit the first row. For the second row, set the larger values listed in `.env` under
  "Server size" (e.g. `API_MEMORY=4G`, `POSTGRES_MEMORY=6G`, `PG_SHARED_BUFFERS=2GB`).
- The AI assistant runs at the AI provider, not on your server; it needs no extra capacity.
- Region: choose the region where your data must stay (e.g. Azure **UAE North** or AWS **me-central-1**,
  both in the UAE). Store backup copies in the same region.

## 3. Before you start

Have these ready:

- [ ] A **cloud subscription or virtualisation host** where you can create the VM.
- [ ] A **host name** for ProcessHub, e.g. `processhub.yourcompany.com`, and access to your DNS to create a
      record for it.
- [ ] An **e-mail address** for certificate notices (for Let's Encrypt), or your company's certificate
      files if you prefer your own certificate (section 5).
- [ ] **SMTP details** for notification e-mails (server, port, user, password), e.g. Microsoft 365
      `smtp.office365.com:587`. Can also be added later.
- [ ] The e-mail address of the **first administrator**.
- [ ] A **password manager or vault** where you can store the `.env` file (it contains the keys).

## 4. Step by step: install on an Ubuntu VM

### 4.1 Create the VM

**Azure (portal):**

1. _Virtual machines → Create → Azure virtual machine._
2. _Region:_ **(Middle East) UAE North**. _Image:_ **Ubuntu Server 24.04 LTS – x64 Gen2**.
   _Size:_ see section 2.
3. _Authentication type:_ **SSH public key** (no password). _Username:_ e.g. `processhub-admin`.
4. _Inbound ports:_ allow **SSH (22), HTTP (80), HTTPS (443)**.
5. _Disks:_ OS disk _Premium SSD_; under _Data disks_ → _Create and attach a new disk_ (size from section 2).
6. _Networking:_ a **static public IP** (or a private IP if ProcessHub is intranet-only).
7. _Review + create._ Download the SSH key when asked.
8. After creation: _Networking → Network security group_ → edit the **SSH** rule so that _Source_ is only
   your office / VPN IP address, never "Any".

**AWS (console):**

1. _EC2 → Launch instance_, region **Middle East (UAE) me-central-1**.
2. _AMI:_ **Ubuntu Server 24.04 LTS (x86)**. _Instance type:_ see section 2.
3. _Key pair:_ create or choose one.
4. _Security group:_ allow **SSH (22) from My IP only**, **HTTP (80)** and **HTTPS (443)** from anywhere
   (or from your company network for an intranet installation).
5. _Storage:_ root volume 30 GB gp3, **add a volume** gp3 for data (size from section 2), _Encrypted_.
6. _Launch_, then allocate an **Elastic IP** and associate it with the instance.

### 4.2 Connect

From your PC (Windows Terminal, PowerShell or macOS/Linux terminal):

```bash
ssh -i path/to/your-key.pem processhub-admin@SERVER_IP      # AWS user name: ubuntu
```

### 4.3 Prepare the server

Update the system and turn on automatic security updates:

```bash
sudo apt-get update && sudo apt-get -y upgrade
sudo apt-get install -y unattended-upgrades ca-certificates curl git
sudo dpkg-reconfigure -plow unattended-upgrades        # answer "Yes"
sudo timedatectl set-timezone Asia/Dubai               # your time zone (backup times use it)
```

Prepare the data disk. Find its name first — it is the disk **without** partitions and with the size you
chose (often `sdc` on Azure, `nvme1n1` on AWS):

```bash
lsblk
```

Then (replace `sdc` with your disk name — **this erases that disk**):

```bash
DISK=/dev/sdc
sudo mkfs.ext4 -L processhub-data "$DISK"
sudo mkdir -p /data
echo 'LABEL=processhub-data /data ext4 defaults,nofail 0 2' | sudo tee -a /etc/fstab
sudo mount -a && df -h /data          # shows the new disk mounted on /data
```

Firewall (the cloud firewall from 4.1 is the main one; this is a second layer):

```bash
sudo ufw allow OpenSSH && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp && sudo ufw allow 443/udp
sudo ufw --force enable
```

### 4.4 Install Docker

Tell Docker to keep its data on the data disk, then install it from Docker's official repository:

```bash
sudo mkdir -p /etc/docker /data/docker
echo '{ "data-root": "/data/docker" }' | sudo tee /etc/docker/daemon.json

sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" |
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

sudo docker run --rm hello-world       # prints "Hello from Docker!"
docker compose version                 # prints "Docker Compose version v2…"
```

The commands in this guide use `sudo`. (Adding your user to the `docker` group avoids typing `sudo`, but
that group is equivalent to full administrator rights on the server.)

### 4.5 Get ProcessHub

```bash
sudo git clone https://github.com/<your-organisation>/<processhub-repository>.git /opt/processhub
cd /opt/processhub
sudo git checkout main            # or the release tag you were given, e.g. v1.0.0
```

(No Git access from the server? Copy a release archive with `scp` and unpack it into `/opt/processhub`.)

### 4.6 Configure

```bash
cd /opt/processhub
sudo cp .env.example.prod .env
sudo ./scripts/generate-secrets.sh
```

The script fills in all passwords and keys with random values and prints the **first administrator
password once** — note it down. Then edit the settings marked in the file:

```bash
sudo nano .env
```

| Setting                                           | What to enter                                                                       |
| ------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `DOMAIN`                                          | the host name, e.g. `processhub.yourcompany.com` (no `https://`)                    |
| `CADDY_TLS`                                       | your e-mail address (automatic certificate), or see section 5 for the other options |
| `SEED_ADMIN_EMAIL`                                | the e-mail address the first administrator signs in with                            |
| `BACKUP_DIR`                                      | `/data/backups` (on the data disk)                                                  |
| `SEED_ORG_NAME_EN` / `_AR`, `SEED_DEFAULT_LOCALE` | your organisation name and default language (also editable later)                   |

Save with `Ctrl+O`, `Enter`, and leave with `Ctrl+X`.

> **Store a copy of `.env` in your password manager or vault now.** Restoring a backup on a new server needs
> the same keys. The file is readable only by root (`chmod 600`); never e-mail it or put it in a ticket.

### 4.7 Create the DNS record

In your DNS, create an **A record**: `processhub.yourcompany.com` → the server's public IP (from 4.1).
Check from your PC: `nslookup processhub.yourcompany.com` shows that IP. (For intranet-only installations,
create the record in your internal DNS and read section 5.)

### 4.8 Start ProcessHub

```bash
cd /opt/processhub
sudo docker compose up -d --build
```

The first start builds the application (5–15 minutes, it downloads components from the internet). Then
check the status until every line shows **(healthy)**:

```bash
sudo docker compose ps
```

```
NAME                  SERVICE    STATUS
processhub-api-1      api        Up 2 minutes (healthy)
processhub-caddy-1    caddy      Up 1 minute (healthy)
processhub-postgres-1 postgres   Up 2 minutes (healthy)
processhub-storage-1  storage    Up 2 minutes (healthy)
processhub-web-1      web        Up 1 minute (healthy)
```

(`.env` contains `COMPOSE_FILE=docker-compose.prod.yml`, so plain `docker compose` commands in this folder
always use the production setup.)

### 4.9 Schedule the daily backup

```bash
sudo cp /opt/processhub/deploy/processhub-backup.cron /etc/cron.d/processhub-backup
sudo /opt/processhub/scripts/backup.sh          # run one now to check it works
```

Details and off-site copies: section 7.

## 5. Domain and HTTPS

Caddy handles HTTPS. Choose one option with `CADDY_TLS` in `.env`, then run `sudo docker compose up -d`.

| Option                      | `CADDY_TLS`                            | When to use                                           | Requirements                                                                                                                                                                                                                                          |
| --------------------------- | -------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Automatic (recommended)** | your e-mail, e.g. `it@yourcompany.com` | ProcessHub is reachable from the internet             | DNS A record points to the server; ports 80 and 443 open from the internet. Certificate from Let's Encrypt, renewed automatically.                                                                                                                    |
| **Company certificate**     | `/certs/cert.pem /certs/key.pem`       | intranet name, or company policy requires your own CA | Copy the certificate (with the intermediate chain) to `deploy/certs/cert.pem` and the private key to `deploy/certs/key.pem`; `sudo chmod 600 deploy/certs/key.pem`. Replace the files before they expire and run `sudo docker compose restart caddy`. |
| **Internal**                | `internal`                             | quick intranet trial                                  | Caddy issues its own certificate. Browsers warn until Caddy's root certificate (`sudo docker compose exec caddy cat /data/caddy/pki/authorities/local/root.crt`) is installed on the PCs (e.g. by Group Policy).                                      |

- Plain `http://` is always redirected to `https://`, and browsers are told to use HTTPS only (HSTS).
- Users must open exactly `https://DOMAIN`. If ProcessHub must also answer under a second name, add it to
  `CORS_ORIGINS` in `.env` (comma-separated, with `https://`) and as an extra site address in
  `deploy/Caddyfile`.
- Changing `DOMAIN` later: update DNS, edit `.env`, `sudo docker compose up -d`. Links in old notification
  e-mails keep the old address.

## 6. First sign-in

1. Open `https://processhub.yourcompany.com`. The sign-in page appears in English or Arabic.
2. Sign in with `SEED_ADMIN_EMAIL` and the password printed by `generate-secrets.sh` (it is also
   `SEED_ADMIN_PASSWORD` in `.env`).
   **Two-step verification is required for Super Admin and Admin** (company policy, see 6.2): at this first
   sign-in ProcessHub asks you to scan a QR code with an authenticator app (Microsoft Authenticator, Google
   Authenticator, 1Password, …), enter the six-digit code and save the ten recovery codes. Have your phone
   ready.
3. **Change the password** (user menu, top corner → _Change password_). The value in `.env` is only used
   when the administrator is created the very first time; afterwards it no longer matters.
4. **Settings → Organisation:** name in English and Arabic, logo, default language.
5. **Settings → Email:** SMTP server, port, user, password, sender → **Send test email**.
   If your mail server is in a private network, add it to `OUTBOUND_ALLOWED_HOSTS` in `.env` first (see 11).
6. **Administration → Departments, Users:** create departments and users and assign roles (Super Admin,
   Admin, Process Owner, Modeler, Reviewer, Auditor, Viewer). **Create a second Super Admin** so that one
   administrator can reset the other's password.
7. Optional: **Settings → AI** (AI assistant, needs an API key from your AI provider) and
   **Settings → Integrations** (GitHub / GitLab). See `README.md`.
8. **Settings → Authentication** — single sign-on with your company accounts (6.1), the MFA request to IT
   (6.1, step 9), the break-glass account (6.3) and two-step verification (6.2; Super Admin and Admin are
   already required).
9. Go through the go-live checklist in [`docs/SECURITY.md`](./SECURITY.md) §7.

### 6.1 Single sign-on with Microsoft Entra ID (Azure AD)

Staff then sign in with their Microsoft 365 account ("Sign in with your company account" on the sign-in
page). You need an Entra ID role that may register applications (Application Administrator or Global
Administrator) — about 15 minutes.

1. **Register the application.** [entra.microsoft.com](https://entra.microsoft.com) → _Identity_ →
   _Applications_ → _App registrations_ → **New registration**.
   - Name: `ProcessHub`.
   - Supported account types: **Accounts in this organizational directory only** (single tenant).
   - Redirect URI: platform **Web**, value `https://processhub.yourcompany.com/api/v1/auth/sso/callback`
     (exactly as shown under **Settings → Authentication → Redirect URI** in ProcessHub).
   - **Register.**
2. **Copy two IDs** from the _Overview_ page: _Application (client) ID_ and _Directory (tenant) ID_.
3. **Create a client secret:** _Certificates & secrets_ → _Client secrets_ → **New client secret**,
   description `ProcessHub`, expiry 24 months → copy the **Value** (not the Secret ID) right away; it is shown
   only once. Put a reminder in your calendar a month before it expires (see "Renew the secret" below).
4. **Optional — groups for roles:** _Token configuration_ → **Add groups claim** → _Security groups_ →
   for ID tokens choose **Group ID** → Save. Note the _Object ID_ of each group you want to map (Entra ID →
   _Groups_). Users in more than 200 groups get no group list in the token; ProcessHub then keeps their roles
   unchanged — use dedicated groups and _Groups assigned to the application_ if that happens.
5. **Optional — only some staff:** _Enterprise applications_ → ProcessHub → _Properties_ → **Assignment
   required = Yes**, then add the users or groups under _Users and groups_.
6. **In ProcessHub:** **Settings → Authentication** (Super Admin):
   - Enable single sign-on, Identity provider **Microsoft Entra ID**, paste the tenant ID, client ID and
     client secret.
   - **Allowed e-mail domains:** your domains, e.g. `yourcompany.com` (press Enter after each).
   - **Default role for new users:** usually _Viewer_ (Knowledge Portal only). Optionally a default
     department.
   - **Group mappings** (optional): group object ID → roles and department, e.g. the "BPM Modelers" group →
     _Modeler / Editor_. **Roles are managed in ProcessHub** (company decision): the mappings only set the
     role of a user who signs in for the first time; afterwards an administrator changes roles under
     **Administration → Users**. Leave **Update roles at every sign-in** off (the default) — when it is on,
     the directory manages roles and changes made in ProcessHub are replaced at the next sign-in.
   - **Test connection** → "Connected to https://login.microsoftonline.com/…/v2.0" → **Save**.
7. **Try it** in a private browser window: the sign-in page shows the company button; after signing in, the
   user appears under **Administration → Users** with an _SSO_ tag. Existing ProcessHub users with the same
   e-mail address are linked to their Microsoft account at their first single sign-on.
8. **Switch off passwords** (company decision): once everyone can sign in with single sign-on, create the
   break-glass account (6.3), then turn off **Allow sign-in with a ProcessHub password** and choose it as
   **Break-glass Super Admin**. Only this account can still use a password (link _Administrator sign-in with
   a password_ under the company button); everybody else — administrators included — uses single sign-on.
9. **Ask IT to enforce MFA for ProcessHub in Entra ID.** ProcessHub's own two-step verification only
   protects password sign-in; single sign-on users verify at Microsoft. Send this request to the Entra ID
   administrators (needs Microsoft Entra ID P1, included in Microsoft 365 E3/E5 and Business Premium):

   > **Subject:** Conditional Access policy for the ProcessHub application
   >
   > Please create a Conditional Access policy (Entra admin center → _Protection_ → _Conditional Access_ →
   > **New policy**):
   >
   > - **Name:** `Require MFA – ProcessHub`
   > - **Users:** include _All users_ (or the groups assigned to ProcessHub); exclude only the
   >   organisation's emergency-access (break-glass) Entra accounts.
   > - **Target resources:** _Select resources_ → **ProcessHub** (application ID `<client ID>`).
   > - **Conditions:** none (all platforms and locations). Optional: block legacy authentication.
   > - **Grant:** _Grant access_ → **Require multifactor authentication** (or **Require authentication
   >   strength → Phishing-resistant MFA** for administrators).
   > - **Session:** _Sign-in frequency_ **24 hours** (matches ProcessHub's session lifetime).
   > - Start in **Report-only**, check the sign-in logs for a week, then switch to **On**.
   >
   > Please confirm when the policy is on, and tell us if Security Defaults are used instead of
   > Conditional Access (then MFA is already required for all users).

   Then sign in once in a private window: Microsoft must ask for the second factor. Note the policy name in
   the go-live checklist (SECURITY.md §7).

**Other providers** (Google Workspace, Okta, Keycloak, ADFS, …): choose _Other OpenID Connect provider_ and
enter the issuer URL (ProcessHub reads `<issuer>/.well-known/openid-configuration`), client ID and secret; the
redirect URI is the same. The provider must send the `email` claim; for groups, set the claim name.

**Renew the secret:** in Entra ID create a new client secret, paste it in **Settings → Authentication →
Client secret**, Save, then delete the old secret in Entra ID. Sign-in keeps working during the change.

**Emergency — identity provider down and break-glass account unusable:** set `AUTH_FORCE_LOCAL_LOGIN=true` in
`.env`, `sudo docker compose up -d`; every account with a password can sign in again (a warning is shown in
Settings). Remove the line and run `sudo docker compose up -d` again afterwards.

### 6.2 Two-step verification

**Company policy:** two-step verification is **required for Super Admin and Admin** and optional for all other
roles. This is the default in **Settings → Authentication → Require two-step verification for** (Super Admin
and Admin are pre-selected; a warning appears if one of them is removed — do not remove them). Members of the
selected roles must set it up at their next password sign-in. Everybody else with a ProcessHub password can
turn it on under **Profile → Two-step verification** (QR code for Microsoft Authenticator, Google
Authenticator, 1Password, …; ten one-time recovery codes). The break-glass account (6.3) always needs it.
Single sign-on users verify with Microsoft (Conditional Access, 6.1 step 9). A user who lost their phone and
recovery codes: **Administration → Users → ⋮ → Reset 2FA** (only a Super Admin can do this for a Super
Admin).

**Sessions** end after **24 hours without activity** (`REFRESH_TOKEN_TTL_HOURS` in `.env`, default 24):
whoever has not used ProcessHub for a day signs in again (with single sign-on usually without typing
anything). A session also ends at sign-out, a password change, a 2FA reset or when the user is deactivated.
To change the lifetime, set the value in hours in `.env` and run `sudo docker compose up -d`. (Older `.env`
files contain `REFRESH_TOKEN_TTL_DAYS`; it is no longer used — replace it with `REFRESH_TOKEN_TTL_HOURS=24`.)

**Leavers:** ProcessHub does not yet notice when an account is disabled in Entra ID (automatic
de-provisioning is planned). Single sign-on is refused as soon as Entra ID disables the account, but a
ProcessHub session that is already open keeps working while it is used. So, as part of the leaver process,
**deactivate the user under Administration → Users** — this ends their access immediately.

### 6.3 Break-glass Super Admin (emergency access)

When password sign-in is switched off (6.1 step 8), **one dedicated Super Admin account** keeps a password,
for the day single sign-on does not work (Entra ID outage, expired client secret, wrong settings). It is not
anybody's daily account. Two people do this together (the "four-eyes" rule), about 15 minutes:

1. **Prepare a vault entry.** In the company password manager (e.g. 1Password, Bitwarden, Keeper, KeePass on
   a shared drive with restricted access) create an entry **ProcessHub – break-glass Super Admin** in a vault
   that only the IT managers / ProcessHub owners can open (at least two people, so access does not depend on
   one person). Generate the password there: **at least 24 random characters**.
2. **Create the account.** Signed in as a Super Admin: **Administration → Users → New user**:
   - E-mail: a shared mailbox or distribution list that is not a person, e.g.
     `processhub-breakglass@yourcompany.com` (**not** in an allowed SSO domain account that someone uses
     with Microsoft, so single sign-on can never link to it);
   - Name: `Break-glass Super Admin` / `حساب الطوارئ`; role **Super Admin** only; the password from the vault.
3. **Set up two-step verification.** In a private browser window sign in as the new account: ProcessHub asks
   for the authenticator set-up (always required for this account). Add it to the **password manager's own
   TOTP field** of the vault entry (or a dedicated company phone kept in the safe), not a personal phone.
   **Download the ten recovery codes** and store them in the same vault entry (or printed, in a sealed
   envelope in the safe). Sign out.
4. **Select it** in **Settings → Authentication → Break-glass Super Admin**, turn off **Allow sign-in with a
   ProcessHub password**, Save.
5. **Test it** at once: private window → _Administrator sign-in with a password_ → the break-glass account
   with password and code works; a normal user's password is refused ("use single sign-on").
6. **Record it** in the go-live checklist: who has vault access, where the recovery codes are.

**Using it:** only in an emergency. Every sign-in is in the audit log (**Administration → Audit log**, action
_Sign-in_); review each use and say why in the IT ticket. Afterwards **change its password** in the vault and in
ProcessHub (Profile → Change password). **Test it every quarter** (sign in, sign out) and whenever someone with
vault access leaves (then also change the password). If both the password and the recovery codes are lost: the
emergency switch below.

## 7. Backups

### What is backed up

`scripts/backup.sh` creates one folder per run, e.g. `/data/backups/processhub-2026-10-21_023000/`:

| File            | Content                                                                        |
| --------------- | ------------------------------------------------------------------------------ |
| `database.dump` | the complete database (processes, pages, versions, users, settings, audit log) |
| `files.tar.gz`  | all uploaded files (attachments, logos)                                        |
| `MANIFEST.txt`  | date, versions, number of files, fingerprint of the encryption key             |
| `SHA256SUMS`    | checksums; the restore refuses a damaged backup                                |

The application keeps running during the backup. Backups older than `BACKUP_KEEP_DAYS` (default 14) are
deleted automatically.

**Not included: `.env` with the keys — by policy.** Backups never contain `.env`. The keys
(`JWT_ACCESS_SECRET`, `INTEGRATIONS_ENCRYPTION_KEY`) and passwords are kept **only in the company password
manager** (section 4.6):

- Save the complete `.env` in the password manager right after installation, and update that entry every
  time you change `.env`.
- A restore needs **both** a backup folder **and** the `.env` from the password manager. Without the same
  `INTEGRATIONS_ENCRYPTION_KEY`, a restored system works but the stored Git token, SMTP password and AI key
  must be entered again.
- Do not use `backup.sh --with-env`; it exists for exceptional cases only and is not part of the agreed setup
  (DECISIONS D-054).

### Daily schedule

Installed in 4.9: `/etc/cron.d/processhub-backup` runs the backup every day at 02:30 (server time) and
writes to `/var/log/processhub-backup.log`. Check it the next morning:

```bash
sudo tail -n 5 /var/log/processhub-backup.log      # ends with "Backup complete: …"
ls -lh /data/backups/
```

Keep the log small with logrotate:

```bash
printf '/var/log/processhub-backup.log {\n  monthly\n  rotate 6\n  compress\n  missingok\n}\n' |
  sudo tee /etc/logrotate.d/processhub-backup
```

### Off-site copy (required) — recommended setup: Azure Blob Storage, UAE North, 90 days

Backups on the same server do not help if the server or its disk is lost. The agreed setup (DECISIONS D-054)
copies them every day to **Azure Blob Storage in UAE North** (same region as the server, data stays in the
UAE) and keeps them **90 days**. Locally, the server keeps the last 14 days (`BACKUP_KEEP_DAYS`).

**1. Create the storage (Azure portal, once):**

1. _Storage accounts → Create_: region **UAE North**, performance _Standard_, redundancy **ZRS** (or LRS),
   name e.g. `processhubbackups`.
2. _Advanced_: _Require secure transfer_ on, _Allow Blob anonymous access_ **off**, minimum TLS 1.2.
3. _Data protection_: enable **soft delete for blobs** (e.g. 14 days) and **versioning**.
4. _Containers → + Container_: `processhub-backups`, access level **Private**.
5. _Data management → Lifecycle management → Add a rule_: "Delete blobs" when **last modified more than
   90 days ago** (also tick previous versions). Optionally move to the _Cool_ tier after 30 days.
6. On the VM: _Identity → System assigned → On_. On the storage account: _Access control (IAM) → Add role
   assignment_ → **Storage Blob Data Contributor** → the VM's managed identity.
7. Optional, stricter: _Networking_ → allow access only from the VM's virtual network / public IP.

**2. Install AzCopy on the server and add the daily copy:**

```bash
curl -fsSL https://aka.ms/downloadazcopy-v10-linux -o /tmp/azcopy.tgz
sudo tar -xzf /tmp/azcopy.tgz -C /tmp && sudo cp /tmp/azcopy_linux_amd64_*/azcopy /usr/local/bin/
echo '15 3 * * * root azcopy login --identity && azcopy sync /data/backups "https://processhubbackups.blob.core.windows.net/processhub-backups" --delete-destination=false >> /var/log/processhub-backup.log 2>&1' |
  sudo tee -a /etc/cron.d/processhub-backup
```

Replace `processhubbackups` with your storage account name. `--delete-destination=false` means backups
deleted on the server after 14 days stay in Azure until the 90-day lifecycle rule removes them.

**3. Check it the next day:** _Storage account → Containers → processhub-backups_ shows a
`processhub-<date>` folder per day, and the end of `/var/log/processhub-backup.log` shows the AzCopy
summary with `Final Job Status: Completed`.

_Other clouds:_ on AWS the equivalent is an S3 bucket in me-central-1 with versioning and a 90-day lifecycle
rule, copied with `aws s3 sync /data/backups s3://<bucket>/processhub/ --sse AES256`.

VM-level backups (Azure Backup) of the data disk are a good second layer, but do not replace the copies above.

### Test the backup

Once per quarter, restore the latest backup on a **separate test VM** (section 8, "new server") and sign in.
A backup that has never been restored is not a backup.

## 8. Restore

`scripts/restore.sh` **replaces** the current database and files with a backup.

```bash
cd /opt/processhub
ls /data/backups/                                       # pick a backup folder
sudo ./scripts/restore.sh /data/backups/processhub-2026-10-21_023000
```

It then:

1. verifies the checksums (a damaged backup is refused),
2. warns if `.env` has a different encryption key than the backup,
3. asks you to type `RESTORE`,
4. makes a safety backup of the current state (`processhub-pre-restore-…`),
5. stops the application, replaces database and files, starts everything again and waits until the API is
   healthy (usually under a minute plus the size of your data).

Afterwards sign in and check a few processes, pages and attachments. Users have to sign in again only if
`JWT_ACCESS_SECRET` changed.

**Restore on a new server** (disaster recovery): follow 4.1 – 4.5, then put your saved **`.env` from the
vault** into `/opt/processhub/.env` (instead of running `generate-secrets.sh`), copy the backup folder to
the new server from Azure (e.g. `azcopy login --identity` then
`azcopy copy "https://processhubbackups.blob.core.windows.net/processhub-backups/processhub-2026-10-21_023000" /data/backups --recursive`), point DNS to the
new server, and run:

```bash
sudo docker compose up -d --build
sudo ./scripts/restore.sh /data/backups/processhub-2026-10-21_023000
```

## 9. Updates

### ProcessHub

Read the release notes first. Then:

```bash
cd /opt/processhub
sudo ./scripts/backup.sh                       # always back up first
sudo git fetch --tags
sudo git checkout v1.1.0                       # the new release (or: sudo git pull)
sudo docker compose up -d --build              # rebuilds and restarts; database updates run automatically
sudo docker compose ps                         # wait until all are (healthy)
sudo docker image prune -f                     # remove old image layers
```

Users see a short interruption (about a minute). Compare `.env.example.prod` with your `.env` for new
settings (`sudo diff .env.example.prod .env`). **Going back** to the previous version: check out the
previous release, `sudo docker compose up -d --build`, then restore the backup made before the update
(database changes of a newer version are not undone otherwise).

### Coming from an installation with MinIO

Installations from before the production setup stored files in a MinIO container. After updating, copy
the files into the new storage once — the script keeps the old volume until you delete it:

```bash
sudo ./scripts/migrate-minio-storage.sh
```

Moving a trial installation (`docker-compose.yml`) to production: the trial generated its keys inside the
`api-data` volume. Before switching, read them and put them into the production `.env`:

```bash
sudo docker compose -f docker-compose.yml exec api cat /app/data/integrations_encryption_key; echo
sudo docker compose -f docker-compose.yml exec api cat /app/data/jwt_access_secret; echo
```

then back up the trial (`sudo COMPOSE_FILE=docker-compose.yml ./scripts/backup.sh`), set up `.env` from
`.env.example.prod` with those two values, start the production stack and restore that backup.

### Operating system and Docker

Security updates are installed automatically (4.3). Once a month:

```bash
sudo apt-get update && sudo apt-get -y upgrade
[ -f /var/run/reboot-required ] && sudo reboot      # containers start again by themselves
```

### Database, storage and proxy versions

The images of PostgreSQL, the file storage and Caddy are pinned (`*_IMAGE` in `.env`) and only change when
you change them. Minor updates (e.g. `caddy:2.11-alpine` → `caddy:2.12-alpine`): back up, change the value,
`sudo docker compose up -d`. **Never change the PostgreSQL major version** (16 → 17) this way: it needs a
backup, a new empty database volume and a restore — ask your ProcessHub developer.

## 10. Monitoring

| What                 | How                                                                                                                                                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Is it up?            | Add `https://processhub.yourcompany.com/api/v1/health` to your uptime monitor (Azure Monitor availability test, AWS CloudWatch Synthetics, UptimeRobot, …). Healthy = HTTP 200 with `{"status":"ok"}` (it also checks the database). |
| Container state      | `sudo docker compose ps` — all **(healthy)**. Containers restart automatically after crashes and reboots.                                                                                                                            |
| Logs                 | `sudo docker compose logs --tail 100 api` (or `web`, `caddy`, `postgres`, `storage`); `-f` follows live. Docker keeps at most 5 × 20 MB per container.                                                                               |
| Disk space           | `df -h /data` — alert at 80 %. `sudo docker system df` shows Docker's share.                                                                                                                                                         |
| CPU / memory         | `sudo docker stats --no-stream`; cloud metrics (Azure Monitor / CloudWatch) with alerts at 85 % for 15 minutes.                                                                                                                      |
| Backups              | `/var/log/processhub-backup.log` ends with "Backup complete" every day; off-site copy present.                                                                                                                                       |
| Certificate          | Renewed automatically 30 days before expiry (Let's Encrypt). With your own certificate: put the renewal in your calendar.                                                                                                            |
| Application activity | In ProcessHub: **Administration → Audit log** (sign-ins, changes, publications) and **AI usage**.                                                                                                                                    |

## 11. Troubleshooting

| Symptom                                                                                      | Likely cause                                                                                                                       | What to do                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docker compose up` stops with "required variable … is missing"                              | A setting in `.env` is empty                                                                                                       | Run `sudo ./scripts/generate-secrets.sh`, set `DOMAIN`, `CADDY_TLS`, `SEED_ADMIN_EMAIL`.                                                                                                                  |
| Browser shows a certificate warning; `docker compose logs caddy` mentions "challenge failed" | DNS does not point to the server, or ports 80/443 are closed in the cloud firewall, or the name is not reachable from the internet | Check `nslookup`, the NSG / security group (4.1). For intranet names use your own certificate or `internal` (section 5).                                                                                  |
| "502 Bad Gateway"                                                                            | The API is still starting (first start applies database updates) or crashed                                                        | Wait 2 minutes, `sudo docker compose ps`, `sudo docker compose logs --tail 100 api`.                                                                                                                      |
| Sign-in fails with "Your session token is out of date"                                       | Users open a different address than `DOMAIN` (e.g. the IP address)                                                                 | Always use `https://DOMAIN`, or add the other address to `CORS_ORIGINS`.                                                                                                                                  |
| Sign-in page shows "Sign-in with your organisation's account failed"                         | Wrong client secret or expired secret, wrong tenant ID, or the redirect URI is not registered                                      | **Settings → Authentication → Test connection**; check the redirect URI in Entra ID; **Administration → Audit log** (Login failed, reason and provider message); renew the secret (6.1).                  |
| "Your e-mail domain is not allowed" / "You do not have a ProcessHub account yet"             | The domain is missing in _Allowed e-mail domains_, or _Create users on first sign-in_ is off                                       | Add the domain or create the user under **Administration → Users** (same e-mail address).                                                                                                                 |
| Nobody can sign in: identity provider down and break-glass password unknown                  | Password sign-in is turned off                                                                                                     | `AUTH_FORCE_LOCAL_LOGIN=true` in `.env`, `sudo docker compose up -d`; remove it afterwards (6.1).                                                                                                         |
| A user lost the phone with the authenticator app                                             | Two-step verification                                                                                                              | The user signs in with a recovery code, or an administrator uses **Users → ⋮ → Reset 2FA** (6.2).                                                                                                         |
| "Your account is temporarily locked"                                                         | Too many wrong passwords                                                                                                           | Wait `LOGIN_LOCKOUT_MINUTES` (15), or another Super Admin resets the password under **Administration → Users**.                                                                                           |
| Test e-mail fails with "blocked"                                                             | The SMTP server is in a private network (SSRF protection)                                                                          | Add its name or IP to `OUTBOUND_ALLOWED_HOSTS` in `.env`, `sudo docker compose up -d`.                                                                                                                    |
| Test e-mail times out on Azure                                                               | Azure blocks outgoing port 25                                                                                                      | Use port 587 with authentication (e.g. Microsoft 365 `smtp.office365.com:587`, STARTTLS).                                                                                                                 |
| Upload fails "file too large"                                                                | Attachments are limited to 10 MB, logos to 1 MB                                                                                    | Compress or split the file.                                                                                                                                                                               |
| A container restarts again and again                                                         | Error at start, or not enough memory                                                                                               | `sudo docker compose logs <service>`; `sudo docker inspect processhub-api-1 --format '{{.State.OOMKilled}}'` = `true` → raise `API_MEMORY` (or `POSTGRES_MEMORY`) in `.env`, `sudo docker compose up -d`. |
| Disk full                                                                                    | Old images, large backups                                                                                                          | `sudo docker image prune -a -f`; lower `BACKUP_KEEP_DAYS`; enlarge the data disk.                                                                                                                         |
| AI requests fail or time out                                                                 | No outbound internet, wrong key, provider limits                                                                                   | **Settings → AI → Test connection**; `sudo docker compose logs api`.                                                                                                                                      |
| Restore warns "not the key this backup was made with"                                        | `.env` is not the one from the vault                                                                                               | Copy `INTEGRATIONS_ENCRYPTION_KEY` from the vault copy into `.env` and run the restore again.                                                                                                             |
| Everything is down after a reboot                                                            | Docker did not start                                                                                                               | `sudo systemctl enable --now docker`, then `sudo docker compose ps`.                                                                                                                                      |

Still stuck? Collect `sudo docker compose ps`, `sudo docker compose logs --tail 200 > processhub-logs.txt`
and the time of the problem for your ProcessHub developer. (Logs contain e-mail addresses and IP addresses,
not passwords — share them only internally.)

## 12. Reference

| File / command                                                             | Purpose                                                                                                                |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `.env`                                                                     | All settings and secrets of this installation (keep a copy in the vault)                                               |
| `.env.example.prod`                                                        | Template with explanations of every production setting                                                                 |
| `docker-compose.prod.yml`                                                  | The five services, networks, limits, health checks                                                                     |
| `deploy/Caddyfile`                                                         | HTTPS / reverse proxy configuration                                                                                    |
| `deploy/certs/`                                                            | Your own certificate files (optional)                                                                                  |
| `deploy/processhub-backup.cron`                                            | Daily backup schedule                                                                                                  |
| `scripts/generate-secrets.sh`                                              | Fill in random secrets in `.env`                                                                                       |
| `scripts/backup.sh` / `scripts/restore.sh`                                 | Backup / restore                                                                                                       |
| `scripts/migrate-minio-storage.sh`                                         | One-time file migration from the old MinIO container                                                                   |
| `sudo docker compose ps` / `logs` / `restart <service>` / `up -d` / `down` | Status, logs, restart, start/apply changes, stop (`down` keeps the data; **never** use `down -v`, it deletes all data) |
| [`docs/SECURITY.md`](./SECURITY.md)                                        | Security controls and the go-live checklist                                                                            |
