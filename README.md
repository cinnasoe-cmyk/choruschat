# Chorus No-Alerts + Call Error Fix

This update fixes:
- No more browser `alert`, `confirm`, or `prompt` popups for common actions
- Adds clean in-app toast notifications
- Adds clean in-app confirm/edit modals
- Fixes the ugly call error when `navigator.mediaDevices.getUserMedia` is unavailable
- Gives a clear HTTPS message instead of crashing
- Friend request success/errors now appear inside Chorus

## Important

The code can stop the ugly error, but it cannot force browser mic/screen access on HTTP.

Your current site is HTTP:

```txt
http://prem-eu1.bot-hosting.net:20185
```

Most browsers block microphone and screen share on HTTP. To make calling actually work for users, put Chorus behind HTTPS using a domain + SSL, Cloudflare Tunnel, Nginx reverse proxy with SSL, or another HTTPS proxy.

## Upload

Replace:

```txt
/home/container/index.js
/home/container/package.json
/home/container/public/
```

Keep:

```txt
/home/container/data/
/home/container/uploads/
```

Then run:

```bash
npm install
node index.js
```
