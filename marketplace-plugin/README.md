# Marktplatz-Studie

Ein MCP-Plugin für die Recherche auf willhaben Marktplatz in ChatGPT. Version 1.3.1 unterstützt aktuelle Suchseiten, gezielte Detailprüfungen, echte Inseratfotos, vergleichbare Angebotspreise und interaktive Angebotskarten.

## Verbindung

Die persönliche Live-Verbindung verwendet die separat bereitgestellte Installations-URL. Sie ist bis zur ausdrücklichen Deaktivierung gültig. Nach einem Update der Tool-Schemata und UI-Metadaten die Verbindung in ChatGPT öffnen und die Werkzeuge aktualisieren. Der Server stellt zwölf Tools bereit. Die aktuelle OpenAI-Anleitung beschreibt den Refresh auf der Detailseite des Plugins. [Verbindung und Tests](https://developers.openai.com/plugins/deploy/connect-chatgpt)

Der öffentliche Endpunkt für Demo- und bereitgestellte Daten lautet `https://marktplatz-studie.lars-e82.workers.dev/mcp`. Das portable Plugin-Paket unter `plugin/` enthält diesen öffentlichen Endpunkt und den Forschungs-Skill. Für Live-Recherche die persönliche Verbindung verwenden.

## Werkzeuge

| Tool | Aufgabe |
| --- | --- |
| `plan_search` | Suchvarianten, native Suchlinks, verfügbare Zugriffe und detailpflichtige Kriterien vorbereiten |
| `parse_search_url` | Eine willhaben-Such-URL in Tool-Argumente übersetzen und zusätzliche Parameter sichtbar machen |
| `discover_filters` | Kategorien, Regionen und Attribute entdecken, Werte suchen und weiterblättern |
| `search_listings` | Eine kompakte Suchseite mit Fortsetzung, Feldwahl und optionalen Titelbildern lesen |
| `inspect_listings` | Ausgewählte Inserate, Beschreibungen, Attribute und Kriterienbelege prüfen |
| `inspect_listing_images` | Einzelne Fotoindizes oder fortsetzbare Galeriepakete als Bildinhalt oder Links lesen |
| `inspect_listing_image` | Einen Fotoindex über die bisherige Einzelfoto-Schnittstelle lesen |
| `present_listings` | Eine geordnete Auswahl mit eigenen Inseratbildern, Fakten, Begründungen und offenen Fragen präsentieren |
| `study_market` | Suchvarianten deduplizieren, Anforderungen bewerten und Preiskohorten berechnen |
| `save_study` | Auf ausdrücklichen Wunsch eine Studie für 24 Stunden speichern |
| `get_study` | Eine gespeicherte Beobachtung mit ihrem ursprünglichen Zeitpunkt lesen |
| `compare_studies` | Zwei Beobachtungen nach Definition, Abdeckung und Angebotspreisen vergleichen |

## Praktische Defaults

| Bereich | Standard | Explizite Auswahl und Fortsetzung |
| --- | --- | --- |
| Treffer pro Suchseite | 50 | 1–100 mit `pageSize` |
| Suchseiten | Eine pro `search_listings`-Aufruf | `nextCursor` so oft wiederholen, wie die Recherche weitere Seiten braucht |
| Suchfelder | ID, Titel, URL, Preis, Ort, Status, Fotoanzahl und Galerie-Vollständigkeit, soweit verfügbar | `fields` wählt zusätzliche oder weniger Felder |
| Detailabrufe | Fünf pro Aufruf | Bis zu zehn pro Paket, bis zu 100 ausgewählte IDs, weitere Pakete über `nextCursor` |
| Beschreibungen | 1.500 Zeichen | Bis zu 6.000 mit `descriptionLimit`, Gesamtlänge und Kürzungsstatus werden ausgegeben |
| Suchbilder | Abruf auf Anforderung | `images=links` oder `images=thumbnails`, vier Covers standardmäßig, höchstens acht |
| Gezielte Titelbilder | IDs aus der aktuellen Suchseite | `imageIds` wählt bis zu acht Kandidaten, alternativ `imageLimit` |
| Galeriefotos | Vier Fotos | Bis zu acht pro Paket, alle verfügbaren Indizes über `nextIndex` oder `indices` erreichbar |
| Angebotskarten | Gewöhnlich drei bis sechs nach der Recherche | Ein bis acht ausgewählte IDs mit optionalem Fotoindex, Begründung und offenen Fragen |
| Filterwerte | Übersicht mit drei Beispielen je Dimension | Gezielte Suche mit `dimension`, `filter`, `valueQuery` und weiteren Seiten |
| Live-Studie | Eine Suchseite insgesamt, null automatische Details | Bis zu 32 Seiten insgesamt und 100 Detailversuche je Aufruf, begrenzt durch die Aufrufzeit |
| Aufrufzeit | 35 Sekunden | Teilergebnisse mit offenen IDs, Positionen und gegebenenfalls `retryAt` |
| Gespeicherte Studie | 24 Stunden | Der zurückgegebene geheime Studien-Identifier ermöglicht Folgefragen |

Detail- und Galeriepakete sind wiederholt abrufbar. Die Seitengröße gehört zur Cursor-Identität. Eine veränderte Suchdefinition beginnt mit einem neuen ersten Aufruf.

Ein Foto darf bis zu 4 MiB umfassen. Das gemeinsame Bildbudget einer Antwort liegt unter 8 MiB nach Base64-Kodierung. Ein erreichtes Antwortbudget erhält die erste unbearbeitete Position. Für größere Dateien sind kleinere Bildvarianten oder Links verfügbar. Fehlt eine native Miniatur, weist die Antwort den Vollbild-Fallback als `full` aus.

## Darstellung im Chat

Jedes einzeln besprochene oder empfohlene Angebot erhält sein eigenes Inseratfoto, Preis, Ort, Original-Link und eine knappe Einordnung. ChatGPT ruft dafür `present_listings` mit den ausgewählten IDs auf. Die geordnete Auswahl kann Titel, Zusammenfassung, Begründungen und offene Punkte enthalten. Explizite Kriterien werden anhand vorhandener Belege als bestätigt, widersprochen oder unbekannt gezeigt.

Die MCP-Apps-Oberfläche zeigt unbeschnittene Produktfotos, bekannte Stückpreise und Versandkosten, Zustand und den ursprünglichen Beobachtungszeitpunkt. Die Reihenfolge lässt sich lokal nach Empfehlung oder Preis ändern. „Fotos ansehen“ lädt die Galerie gezielt in fortsetzbaren Paketen. Ladefehler und Wartezeiten bleiben am betroffenen Angebot sichtbar, bereits geladene Fotos bleiben erhalten. Auf kleinen Displays lassen sich die Karten horizontal durchblättern. Unterstützt der Host den Vollbildmodus, steht eine größere Ansicht zur Verfügung.

Die Karten verwenden die neueste vorhandene vollständige Beobachtung je Inserat. Fehlende IDs erhalten eine konkrete Detailprüfung als nächsten Schritt. Nur die ausgewählten Titelbilder werden über das bestehende Bildbudget und CDN-Pacing geladen. Bilddaten stehen in privaten Tool-Result-Metadaten für die Oberfläche. Das Modell erhält kompakte Fakten, Bildstatus und exakte Bild-URLs. Für bereitgestellte oder synthetische Daten bleibt ein unbekannter ursprünglicher Beobachtungszeitpunkt ausdrücklich offen.

In Clients ohne MCP-Apps-Darstellung verwendet ChatGPT Markdown-Bilder mit den exakten Inseratbild-URLs neben den jeweiligen Fakten. Der Bildstatus bestimmt, ob ein Foto eingebettet wird oder ein fehlgeschlagener beziehungsweise offener Abruf mit Fortsetzung erscheint. Eine öffentliche Verbindung stellt verifizierbare Bild-Links bereit, der persönliche fotoaktivierte Zugang liefert zusätzlich die Bilddaten für die Oberfläche.

## Raten und Aktualität

Die persönliche MCP-Verbindung erlaubt 120 Aufrufe pro Minute. Diese Zählung gilt für die Verbindung über wechselnde Client-IP-Adressen hinweg. Die tatsächlich ausgehenden Abrufe koordiniert ein gemeinsames SQLite-Durable-Object je Origin.

| Datenquelle | Abstand zwischen Anfragen |
| --- | --- |
| willhaben-Such- und Detailseiten | Mindestens zwei Sekunden plus 0–500 ms positiver Jitter |
| Bild-CDN | Mindestens 500 ms plus 0–250 ms positiver Jitter |

Jeder Weiterleitungsschritt und jeder Wiederholungsversuch benötigt einen eigenen Abrufslot. `Retry-After` gilt vollständig als Sekundenwert oder HTTP-Datum. Netzwerkfehler und HTTP 502/503/504 erhalten bis zu zwei Wiederholungen innerhalb der Aufrufzeit. HTTP 429, Zugriffsablehnungen und Challenges führen zu einem gemeinsamen Cooldown mit strukturiertem Rückgabestatus.

Suchseiten, Facetten und Kurzbeobachtungen werden fünf Minuten, Details 15 Minuten wiederverwendet. `fresh=true` fordert eine neue Beobachtung unter derselben Anfragesteuerung an. Ergebnisse enthalten den ursprünglichen Beobachtungszeitpunkt und das Cache-Alter. Studien erhalten diese Zeiten auch für reine Suchseiten-Beobachtungen. Bei der Präsentation entscheidet der jüngste Beobachtungszeitpunkt zwischen Suchkurzfassung und Details. Bei gleichem Zeitpunkt haben Details Vorrang.

## Aussagekraft

Kriterien werden als bestätigt, widersprochen oder unbekannt ausgewiesen. Preisvergleiche berücksichtigen Kategorie, Modell, Zustand, Menge und bekannte Versandkosten. Ein vergleichbarer Median erfordert mindestens fünf geeignete Beobachtungen. `priceContext` ordnet einen Kandidaten innerhalb dieser beobachteten Kohorte ein.

Eine Studie umfasst ihren eigenen Abruflauf. Eine Suchfortsetzung erzeugt zusätzliche Beobachtungen. Für eine gemeinsame spätere Auswertung können deduplizierte Daten als `source=provided` mit bis zu 300 Datensätzen eingebracht werden. Der Studienbericht benennt Abdeckung, offene Detailprüfungen und verbleibende Suchpositionen.

## Entwicklung

Node 22 oder neuer verwenden. Die Produktionsmodule verwenden die Workers-Laufzeit. Miniflare ist ausschließlich eine Entwicklungsabhängigkeit für echte workerd- und SQLite-Tests.

```sh
npm ci
npm test
npm run test:runtime
```

Die Runtime-Suiten arbeiten mit synthetischen Upstreamdaten. Sie prüfen auch parallele Slot-Anforderungen, Cache-Persistenz nach Neustart, lange Cooldowns und tatsächliche Anfrageabstände.

Der Browserharness benötigt zusätzlich eine verfügbare Playwright-Installation mit Chromium. Er prüft die tatsächliche Oberfläche in einem simulierten MCP-Apps-Host, einschließlich Bildzuordnung, Galeriefortsetzung, Ladefehlern, Sortierung und mobilen Ansichten.

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chromium \
node test/presentation-ui.browser.mjs
```

`PLAYWRIGHT_CHROMIUM_EXECUTABLE` wählt eine vorhandene Chromium-Binärdatei. Alternativ liest `PLAYWRIGHT_BROWSER_CONFIG` eine JSON-Datei mit `executablePath` und optionalen `args`. Ohne diese Angaben verwendet der Harness die normale Playwright-Browserinstallation. `UI_SCREENSHOT_DIR` speichert auf Wunsch Desktop- und Mobile-Screenshots.

## Cloudflare-Deployment

Die ES-Module in `src/` unter ihren Dateinamen hochladen. `src/index.mjs` exportiert den Worker und `OriginGate`. Die Vorlage steht in `deployment/metadata.json`.

- Den KV-Platzhalter durch den Namespace für Studien ersetzen.
- Beim ersten Deployment die SQLite-Migration `origin-gate-v1` anwenden. Bei weiteren Code-Uploads die bereits angewandte Migration auslassen.
- `ORIGIN_GATE` und `REQUIRE_ORIGIN_GATE=true` bereitstellen.
- Bestehende Geheimnisse mit `keep_bindings: ["secret_text"]` erhalten.
- Für die persönliche Verbindung `PERSONAL_TEST_TOKEN_SHA256` als Secret verwenden. Der Wert ist SHA-256 des 64-stelligen Installationsschlüssels.
- `PERSONAL_TEST_EXPIRES_AT` für einen Zugang bis zur Deaktivierung entfernen.
- Request- und Invocation-Logging deaktiviert halten, da die persönliche URL ein Zugangsgeheimnis trägt.

Die Betriebsentscheidungen und die geprüften GitHub-Implementierungen sind nachvollziehbar dokumentiert. [Recherche und Funktionsvergleich](docs/research-and-decisions.md) · [Verifikationsübersicht](docs/feature-map.md)
