# 🎲 Zufallsgenerator – Gruppeneinteilung

Eine kleine Website, die Personen per Zufall in Gruppen einteilt. Alle sehen live dasselbe – ohne Account, ohne Reload.

| Seite | Wer | Was |
|---|---|---|
| `/` | Teilnehmende | Namen eintragen, warten, dann sehen: „Du bist in **Rot**“ + alle Gruppen |
| `/admin` | Du (Passwort) | Gruppenanzahl, Gruppennamen und Gruppengröße festlegen, Teilnehmende verwalten, auslosen |

## Funktionen

- **Anzahl Gruppen** (1–50), optionale **Gruppennamen** (sonst „Gruppe 1, 2, …“) und optionale **maximale Gruppengröße**
- Auslosung auf dem Server (kryptografischer Zufall), Verteilung so ausgewogen wie möglich
- Ist die Größe begrenzt und es sind mehr Personen da als Plätze, landet der Rest auf einer **Warteliste** (rückt automatisch nach, wenn jemand entfernt wird)
- **Live-Updates** per Server-Sent-Events: Anmeldungen, Auslosung und Reset erscheinen sofort bei allen
- Spätere Anmeldungen nach der Auslosung werden automatisch der kleinsten Gruppe mit freiem Platz zugeteilt (Anmeldung lässt sich jederzeit schließen)
- Mehrfach neu auslosen, Einteilung zurücksetzen, Teilnehmende entfernen oder manuell hinzufügen, Ergebnis als Text kopieren
- Zustand wird in `data/state.json` gespeichert und überlebt Neustarts
- Handy-tauglich, Dark-Mode, keine externen Abhängigkeiten

## Starten

Benötigt nur [Node.js](https://nodejs.org) ≥ 18.

```bash
ADMIN_PASSWORD="dein-passwort" npm start
# → http://localhost:3000        (Teilnehmende)
# → http://localhost:3000/admin  (Admin)
```

Ohne `ADMIN_PASSWORD` wird beim ersten Start ein zufälliges Passwort erzeugt, in der Konsole ausgegeben und in `data/admin-password.txt` abgelegt.

| Variable | Standard | Bedeutung |
|---|---|---|
| `ADMIN_PASSWORD` | zufällig | Passwort für `/admin` |
| `PORT` | `3000` | Port |
| `DATA_DIR` | `./data` | Speicherort von `state.json` |

## Online stellen, damit alle den Link nutzen können

Die Seite braucht einen Server, der dauerhaft läuft (reines Hosting wie GitHub Pages reicht nicht, weil der gemeinsame Zustand auf dem Server liegt). Bei jedem Anbieter, der Node.js ausführt (z. B. Render, Railway, Fly.io, eigener Server):

- Build-Befehl: *(keiner nötig)*
- Start-Befehl: `npm start`
- Umgebungsvariable `ADMIN_PASSWORD` setzen
- Optional ein persistentes Volume auf `DATA_DIR` legen, falls der Zustand auch Neustarts/Deployments überleben soll

Danach verteilst du die Hauptadresse (`https://…/`) an die Teilnehmenden und öffnest selbst `https://…/admin`.

## Hinweise

- Namen müssen eindeutig sein (Groß-/Kleinschreibung egal). Wer sich versehentlich falsch angemeldet hat, kann sich selbst abmelden oder wird vom Admin entfernt.
- Wer sich anmeldet, wird im Browser wiedererkannt (localStorage) – auch nach einem Reload.
- Es gibt bewusst keine Nutzerkonten: Das Admin-Passwort ist der einzige Schutz. Verwende bei öffentlichem Betrieb HTTPS.
