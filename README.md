# Krypton Onion Mirror

Reproducible `.onion` mirror of [krypton-lang.org](https://krypton-lang.org/).

## Start

Requirements: Docker Engine/Desktop with Compose. Node.js 18+ only needed to refresh mirror.

```sh
npm run sync
npm run verify
docker compose up --build -d
```

Local preview: <http://127.0.0.1:8181>. Override port with `ONION_PREVIEW_PORT` if needed.

Print generated onion address:

```sh
docker compose exec tor cat /var/lib/tor/hidden_service/hostname
```

Open resulting `http://....onion` address in Tor Browser. HTTP is normal here: Tor authenticates onion address and encrypts connection end to end.

## Refresh

```sh
npm run sync
npm run verify
docker compose restart web
```

Synchronizer copies only same-origin `krypton-lang.org` resources. Same-origin absolute URLs become local paths. External hyperlinks remain links. Server Content Security Policy blocks third-party scripts, frames, images, and connections.

Sync details live in `site/mirror-report.json`.

## Preserve onion address

Private onion keys live in Docker volume `onion_tor-state` (prefix may change with Compose project name). Restarts and normal `docker compose down` preserve it.

**Do not run `docker compose down -v` unless you want a new onion address.** Back up volume if address matters. Anyone holding private key can impersonate service.

## Operations

- Preview port binds only to loopback. No public clearnet listener.
- Onion container makes outbound Tor connections. No inbound firewall port needed.
- Mirror is static. Future server-side forms/APIs need onion-native backend.
- Dedicated, patched Linux host recommended for public 24/7 launch.

Stop without deleting identity:

```sh
docker compose down
```
