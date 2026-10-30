# Trainingslog

Kleine Web-App fürs Gym: Besuche abhaken und pro Übung die Sätze mit Wiederholungen × kg eintragen, direkt am Handy nach jeder Maschine. Cardio-Geräte (Laufband, Fahrradergometer, Treppensteiger, Crosstrainer, Rudergerät) mit Minuten, km, Stufe und kcal.

**Öffnen:** https://romanknj.github.io/trainingslog/

## Wo liegen meine Daten?

Nur **in deinem Browser auf deinem Gerät** (localStorage). Niemand sonst sieht deine Einträge, auch nicht der Betreiber dieser Seite.

**Ausnahme, nur wenn du einer Ranglisten-Gruppe beitrittst:** Dann gehen dein gewählter Name, deine Punkte, Besuchszahlen und Wochen-Serie an eine Datenbank bei Supabase (Frankfurt). Das sehen alle, die den Gruppen-Code kennen. Übungen und Gewichte werden nie übertragen. Mit „Verlassen“ wird dein Eintrag dort gelöscht. Ohne Gruppe geht nichts an einen Server.

Das heißt aber auch: Wenn du die Browserdaten löschst, das Handy wechselst oder einen anderen Browser nimmst, sind die Einträge dort nicht da. Deshalb:

- **Unten auf der Seite „Als Datei sichern“** tippen, regelmäßig (die Seite erinnert dich nach einer Woche). Die Datei z.B. in deine Cloud legen oder dir per Mail schicken.
- **„Aus Datei laden“** holt eine Sicherung zurück, auch auf einem neuen Gerät. Der Stand vorher wird dabei automatisch noch einmal als Datei gesichert.
- **Zum Startbildschirm hinzufügen** (Browser-Menü → „Zum Startbildschirm“ bzw. „App installieren“): Dann startet die Seite wie eine App, funktioniert auch ohne Empfang im Gym, und gerade auf dem iPhone räumt Safari die Daten einer installierten App nicht nach ein paar Wochen ohne Nutzung weg.

## Bedienung

1. „Heute im Gym“ antippen (wer eine Übung einträgt, zählt automatisch als da).
2. Bereich wählen: Oberkörper (gelb), Torso (grün), Beine (blau), Freihantel (violett), Cardio (orange), oder suchen.
3. Übung antippen, Wiederholungen und kg eintragen. „+ Satz“ für weitere Sätze, „Wie am …“ übernimmt das letzte Training. Speichert von selbst.
4. Unten im Kalender siehst du deine Gym-Tage und kannst ältere Tage ansehen oder nachtragen. Fehlende Übungen lassen sich über „+ Eigene Übung“ ergänzen.

## Rangliste

Punkte gibt es automatisch aus deinen Einträgen: 10 pro Gym-Besuch, 1 pro Satz (höchstens 30 am Tag), 5 pro Cardio-Einheit, 5 für einen neuen Bestwert an einer Übung. Ränge: Bronze, Silber ab 200, Gold ab 600, Platin ab 1.500, Diamant ab 3.000. Unter „Mit Freunden vergleichen“ legst du eine Gruppe an oder trittst mit einem Code bei.

## Technik

Reines HTML/CSS/JavaScript ohne Build-Schritt und ohne externe Abhängigkeiten. Die Übungsliste steht in `catalog.json`, die Datenbank-Einrichtung der Rangliste in `supabase.sql`. Gehostet über GitHub Pages.

Schriften: Rajdhani (Indian Type Foundry) und Share Tech Mono (Carrois Type Design), beide unter der SIL Open Font License 1.1, siehe `fonts/OFL-*.txt`.
