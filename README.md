# Trainingslog

Kleine Web-App fürs Gym: Besuche abhaken und pro Übung die Sätze mit Wiederholungen × kg eintragen, direkt am Handy nach jeder Maschine. Cardio-Geräte (Laufband, Fahrradergometer, Treppensteiger, Crosstrainer, Rudergerät) mit Minuten, km, Stufe und kcal.

**Öffnen:** https://romanknj.github.io/trainingslog/

## Wo liegen meine Daten?

Nur **in deinem Browser auf deinem Gerät** (localStorage). Es gibt keinen Server, niemand sonst sieht deine Einträge, auch nicht der Betreiber dieser Seite.

Das heißt aber auch: Wenn du die Browserdaten löschst, das Handy wechselst oder einen anderen Browser nimmst, sind die Einträge dort nicht da. Deshalb:

- **Unten auf der Seite „Als Datei sichern“** tippen, regelmäßig (die Seite erinnert dich nach einer Woche). Die Datei z.B. in deine Cloud legen oder dir per Mail schicken.
- **„Aus Datei laden“** holt eine Sicherung zurück, auch auf einem neuen Gerät. Der Stand vorher wird dabei automatisch noch einmal als Datei gesichert.
- **Zum Startbildschirm hinzufügen** (Browser-Menü → „Zum Startbildschirm“ bzw. „App installieren“): Dann startet die Seite wie eine App, funktioniert auch ohne Empfang im Gym, und gerade auf dem iPhone räumt Safari die Daten einer installierten App nicht nach ein paar Wochen ohne Nutzung weg.

## Bedienung

1. „Heute im Gym“ antippen (wer eine Übung einträgt, zählt automatisch als da).
2. Bereich wählen: Oberkörper (gelb), Torso (grün), Beine (blau), Freihantel (violett), Cardio (orange), oder suchen.
3. Übung antippen, Wiederholungen und kg eintragen. „+ Satz“ für weitere Sätze, „Wie am …“ übernimmt das letzte Training. Speichert von selbst.
4. Unten im Kalender siehst du deine Gym-Tage und kannst ältere Tage ansehen oder nachtragen. Fehlende Übungen lassen sich über „+ Eigene Übung“ ergänzen.

## Technik

Reines HTML/CSS/JavaScript ohne Build-Schritt und ohne externe Abhängigkeiten. Die Übungsliste steht in `catalog.json`. Gehostet über GitHub Pages.

Schriften: Rajdhani (Indian Type Foundry) und Share Tech Mono (Carrois Type Design), beide unter der SIL Open Font License 1.1, siehe `fonts/OFL-*.txt`.
