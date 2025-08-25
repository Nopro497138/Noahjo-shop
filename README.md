# Noahjo Shop — Einfaches Paket für Railway / Vercel Deployment

Dieses Paket enthält ein fertiges Backend (`server.js`) und ein kleines Frontend (`public/index.html`) — bereit zum Hochladen in ein GitHub-Repo und Deployment.

## Schnell-Anleitung (einfach erklärt)
1. **Unzip** und überprüfe die Dateien.
2. **Push** in dein GitHub-Repository:
   ```bash
   git init
   git add .
   git commit -m "Initial commit - Noahjo shop"
   git branch -M main
   # Erstelle ein Repo auf GitHub und füge es als remote hinzu, z.B.:
   git remote add origin git@github.com:DEINUSER/DEINREPO.git
   git push -u origin main
   ```
3. **Railway** (Backend):
   - Account bei https://railway.app erstellen.
   - Neues Project → "Deploy from GitHub" → wähle dein Repo.
   - Setze Environment Variables (Project → Variables):
     - `JWT_SECRET` (z. B. lange zufällige Zeichenkette)
     - `STRIPE_SECRET_KEY` (optional)
     - `STRIPE_WEBHOOK_SECRET` (optional)
     - `APP_URL` (optional; z. B. deine Vercel-URL)
     - `DATABASE_FILE` = `./data/db.sqlite` (Railway unterstützt persistent storage in vielen Fällen)
   - Deploy starten. Nach erfolgreichem Deploy bekommst du eine URL, z.B. `https://your-project.up.railway.app` — diese URL zeigt jetzt dein Frontend (index.html) und deine API.

4. **Vercel** (Frontend optional):
   - Wenn du lieber Vercel für das Frontend willst, verbinde Vercel mit GitHub und importiere dein Repo.
   - In `public/index.html` ersetze `BACKEND_URL` mit deiner Railway-URL oder API-URL.

## Lokaler Test
1. `npm install`
2. `node server.js`
3. Öffne `http://localhost:3001/` — du solltest die Startseite sehen.
4. `http://localhost:3001/api/ping` sollte `{ "ok": true }` zurückgeben.

## .env.example
Fülle eine `.env` lokal (nicht ins Repo committen) wie in `.env.example`.

## Support
Wenn du willst, helfe ich dir beim Hochladen zu GitHub oder beim Einrichten auf Railway — sag mir einfach, welche Schritte du als nächstes machen willst.
