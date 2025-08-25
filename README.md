# Noahjo Shop — Repo für Deployment (Vercel + Railway/Render)

Diese ZIP enthält alle Dateien, die du in ein GitHub-Repository hochladen kannst, um:
- das **Frontend** (statische Seite) zu Vercel zu deployen, und
- das **Backend** (Express + Stripe + Socket.IO) zu Railway oder Render zu deployen.

## Was ist enthalten
- `server.js` — Node/Express Server (erstellt DB automatisch falls nötig)
- `package.json` — Dependencies & Start-Scripts
- `index.html` — einfache statische Startseite (Frontend)
- `.env.example` — Umgebungsvariablen (nicht committen)
- `.gitignore`
- `public/images/` — Ordner für Produktbilder (leer)

## Schnellstart (einfach)
1. Entpacke diese ZIP lokal.
2. Öffne Terminal im Ordner und führe aus:
   ```bash
   git init
   git add .
   git commit -m "Initial commit - Noahjo shop"
   git branch -M main
   # Ersetze <URL> durch dein GitHub-Repo (erst auf GitHub erstellen)
   git remote add origin <GIT_REMOTE_URL>
   git push -u origin main
   ```
3. Backend deployen (Railway oder Render empfohlen):
   - Erstelle Account bei Railway (https://railway.app) oder Render (https://render.com)
   - Importiere dein GitHub-Repo
   - Setze Umgebungsvariablen (siehe `.env.example`) im Dashboard
   - Deploy starten (Railway/Render führt `npm install` und `npm start` aus)

4. Frontend deployen (Vercel):
   - Gehe zu https://vercel.com und verbinde dein GitHub-Repo
   - Importiere Projekt → Deploy
   - Wenn deine Frontend-URL `https://meine-site.vercel.app` ist, setze diese als `APP_URL` in deinem Backend (Railway/Render), damit Stripe-Redirects funktionieren.

## Wichtige Hinweise
- **.env** darf nicht ins Repo. Benutze `.env.example` als Vorlage.
- SQLite (`./data/db.sqlite`) ist in der ZIP nicht enthalten. Der Server erstellt die DB automatisch beim ersten Start.
- Auf manchen Hosts ist das Dateisystem **ephemeral** — bestimme Plattform unterstützt persistent storage; wenn nicht, nutze eine echte DB (Postgres).

Wenn du willst, helfe ich dir beim nächsten Schritt: ich kann die Dateien direkt in eine GitHub-Repo-Struktur umwandeln oder dir zeigen, wie du Vercel/Railway konfigurierst.
