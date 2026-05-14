# Chorus 4.0 Discord-style Overhaul

This is a full replacement build for Chorus.

## Replace your GitHub repo with these files

Your repo root should contain:

```txt
index.js
package.json
railway.json
public/
.env.example
.gitignore
```

## Railway variables

Keep these:

```txt
SESSION_SECRET=make-a-long-random-secret
STORAGE_DIR=/app/storage
```

Keep your Railway volume mounted to:

```txt
/app/storage
```

## Optional but recommended for voice calls

For the most reliable calls, add TURN variables:

```txt
TURN_URL=turn:your-turn-server.com:3478
TURN_USERNAME=your_username
TURN_PASSWORD=your_password
```

Without TURN, calls can still work, but some Wi-Fi/mobile networks may block WebRTC.

## Features

- Discord-style full-screen layout
- Mobile layout
- Login/register
- Username claiming
- Friend requests
- Profile picture uploads
- Display name and bio editing
- DMs
- Group chats
- Saved messages/accounts/uploads using SQLite
- Message edit/delete
- Emoji reactions
- Message notification sound
- Settings menu for mic/speaker/volume
- Rebuilt one-on-one voice calls
