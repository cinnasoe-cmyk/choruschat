# Chorus - Railway Ready

This version is ready to upload to GitHub and deploy on Railway.

## Files included

```txt
index.js
package.json
railway.json
.env.example
.gitignore
public/
```

## Railway variables

In Railway, add these variables:

```txt
SESSION_SECRET=make-a-long-random-secret
STORAGE_DIR=/app/storage
```

## Persistent storage

Add a Railway Volume to the Chorus service.

Mount path:

```txt
/app/storage
```

This keeps:

```txt
/app/storage/data
/app/storage/uploads
```

so accounts, chats, and profile pictures survive redeploys.

## Deploy steps

1. Make a GitHub repo called `chorus`
2. Upload these files to the repo
3. Go to Railway
4. New Project
5. Deploy from GitHub repo
6. Pick your `chorus` repo
7. Add the variables above
8. Add the volume at `/app/storage`
9. Deploy

Railway will run:

```bash
npm install
npm start
```

## Notes

Do not upload `node_modules`.

Use Railway's HTTPS link for calling and screenshare.
