# willhaben

Ein MCP-Plugin für die Recherche auf willhaben Marktplatz in ChatGPT. Version 1.5.1 unterstützt Text- und Bildsuche, gespeicherte Fotoanforderungen, nachträgliche Suchverfeinerung, Merken und Ablehnen sowie den direkten Vergleich von Angeboten in blätterbaren Karten.

## Verbindung

Die persönliche Live-Verbindung verwendet die separat bereitgestellte Installations-URL. Sie ist bis zur ausdrücklichen Deaktivierung gültig. Nach einem Update der Tool-Schemata und UI-Metadaten die Verbindung in ChatGPT öffnen und die Werkzeuge aktualisieren. Der Server stellt 18 Tools bereit. `browse_collection` ist für die interaktive Oberfläche vorgesehen. 17 Tools stehen für die Modellsteuerung zur Verfügung. Die aktuelle OpenAI-Anleitung beschreibt den Refresh auf der Detailseite des Plugins. [Verbindung und Tests](https://developers.openai.com/plugins/deploy/connect-chatgpt)

Der öffentliche Endpunkt für Demo- und bereitgestellte Daten lautet `https://marktplatz-studie.lars-e82.workers.dev/mcp`. Das portable Plugin-Paket unter `plugin/` enthält diesen öffentlichen Endpunkt und den Forschungs-Skill. Für Live-Recherche die persönliche Verbindung verwenden.

## Werkzeuge

| Tool | Aufgabe |
| --- | --- |
| `plan_search` | Suchvarianten, native Suchlinks, verfügbare Zugriffe und detailpflichtige Kriterien vorbereiten |
| `parse_search_url` | Eine willhaben-Such-URL in Tool-Argumente übersetzen und zusätzliche Parameter sichtbar machen |
| `discover_filters` | Kategorien, Regionen und Attribute entdecken, Werte suchen und weiterblättern |
| `search_listings` | Eine kompakte Suchseite mit Fortsetzung, Feldwahl und optionalen Titelbildern lesen |
| `search_by_image` | Native Ähnlichkeitssuche mit ChatGPT-Anhang, öffentlicher Bild-URL oder Inseratfoto und fortsetzbaren Ergebnisseiten |
| `get_research` | Rechercheumfang, Suchanfragen und präzise Inseratnachweise paginiert lesen |
| `record_review` | Konkrete Anforderungen als bestätigt, widersprochen oder unbekannt an tatsächlich gelieferte Originalfotos binden |
| `refine_research` | Gespeicherte Kandidaten nach Pflichtanforderungen, Präferenzen und Nutzerentscheidungen fortsetzbar auswerten |
| `set_listing_feedback` | Ein Angebot innerhalb der Recherche merken, ablehnen oder die Entscheidung zurücknehmen |
| `browse_collection` | App-interne Seiten, Hauptbilder, Galerien und Detailansichten laden |
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
| Nachträgliche Verfeinerung | Bis zu 256 gespeicherte Kandidaten pro Schritt | Fortsetzung bis zum vollständigen Bestand, dann die fertige Sammlung öffnen |
| Suchseiten | Eine pro `search_listings`-Aufruf | `nextCursor` so oft wiederholen, wie die Recherche weitere Seiten braucht |
| Suchfelder | ID, Titel, URL, Preis, Ort, Status, Fotoanzahl und Galerie-Vollständigkeit, soweit verfügbar | `fields` wählt zusätzliche oder weniger Felder |
| Detailabrufe | Fünf pro Aufruf | Bis zu zehn pro Paket, bis zu 100 ausgewählte IDs, weitere Pakete über `nextCursor` |
| Beschreibungen | 1.500 Zeichen | Bis zu 6.000 mit `descriptionLimit`, Gesamtlänge und Kürzungsstatus werden ausgegeben |
| Suchbilder | Abruf auf Anforderung | `images=links` oder `images=thumbnails`, vier Covers standardmäßig, höchstens acht |
| Gezielte Titelbilder | IDs aus der aktuellen Suchseite | `imageIds` wählt bis zu acht Kandidaten, alternativ `imageLimit` |
| Galeriefotos | Vier Fotos | Bis zu acht pro Paket, alle verfügbaren Indizes über `nextIndex` oder `indices` erreichbar |
| Angebotskarten | Zwölf pro Seite, zwei vorab geladene Hauptbilder | Optional 24 pro Seite, weitere beobachtete Inserate über die gespeicherte Sammlung, sichtbare Bilder in Viererpaketen |
| Bildsuche | 50 Treffer, natives 300-Pixel-JPEG als Suchreferenz | Bis zu 100 Treffer je Seite, Referenzbild bis zu 10 MiB, Fortsetzung mit Cursor |
| Rechercheprotokoll | Getrennt je Aufgabe und Zugang, sieben Tage Inaktivität | `researchId` bei zugehörigen Aufrufen weitergeben, `get_research` für Nachweise |
| Filterwerte | Übersicht mit drei Beispielen je Dimension | Gezielte Suche mit `dimension`, `filter`, `valueQuery` und weiteren Seiten |
| Live-Studie | Eine Suchseite insgesamt, null automatische Details | Bis zu 32 Seiten insgesamt und 100 Detailversuche je Aufruf, begrenzt durch die Aufrufzeit |
| Aufrufzeit | 35 Sekunden | Teilergebnisse mit offenen IDs, Positionen und gegebenenfalls `retryAt` |
| Gespeicherte Studie | 24 Stunden | Der zurückgegebene geheime Studien-Identifier ermöglicht Folgefragen |

Detail- und Galeriepakete sind wiederholt abrufbar. Die Seitengröße gehört zur Cursor-Identität. Eine veränderte Suchdefinition beginnt mit einem neuen ersten Aufruf.

Ein Foto darf bis zu 4 MiB umfassen. Das gemeinsame Bildbudget einer Antwort liegt unter 8 MiB nach Base64-Kodierung. Ein erreichtes Antwortbudget erhält die erste unbearbeitete Position. Für größere Dateien sind kleinere Bildvarianten oder Links verfügbar. Fehlt eine native Miniatur, weist die Antwort den Vollbild-Fallback als `full` aus.

## Darstellung im Chat

Jedes einzeln besprochene oder empfohlene Angebot erhält sein eigenes Inseratfoto, Preis, Ort, Original-Link und eine knappe Einordnung. ChatGPT ruft dafür `present_listings` mit den ausgewählten IDs auf. Für einen breiten Überblick übernimmt `present_listings` mit `researchId` alle beobachteten Treffer. `queryIds` wählt bestimmte Suchläufe und `selections` eine geordnete Auswahl mit Begründungen und offenen Punkten. Automatische Sammlungen besitzen keine zusätzliche Gesamtgrenze. Eine explizite Auswahl akzeptiert bis zu 1.000 IDs pro Aufruf. Explizite Kriterien werden anhand vorhandener Belege als bestätigt, widersprochen oder unbekannt gezeigt.

Die MCP-Apps-Oberfläche zeigt unbeschnittene Produktfotos, bekannte Stückpreise und Versandkosten, Zustand und den ursprünglichen Beobachtungszeitpunkt. Die Reihenfolge lässt sich lokal nach Empfehlung oder Preis ändern. „Fotos ansehen“ lädt die Galerie gezielt in fortsetzbaren Paketen. Ladefehler und Wartezeiten bleiben am betroffenen Angebot sichtbar, bereits geladene Fotos bleiben erhalten. Auf kleinen Displays lassen sich die Karten horizontal durchblättern. Unterstützt der Host den Vollbildmodus, steht eine größere Ansicht zur Verfügung.

Die Karten verwenden die neueste vorhandene vollständige Beobachtung je Inserat. Kompakte Angebotsdaten und Fotoverweise bleiben gemeinsam mit der Recherche sieben Tage nach der letzten Nutzung erhalten. Ihr ursprünglicher Beobachtungszeitpunkt bleibt sichtbar. Neuere Löschbeobachtungen verhindern die erneute Anzeige veralteter Angebote. Bei älteren Sammlungen mit fehlenden Daten zeigt die Oberfläche die betroffene Anzahl und fordert eine Aktualisierung der relevanten Suche in derselben Recherche an. Die erste Seite lädt zwei Titelbilder vorab. Die Oberfläche fordert weitere Bilder innerhalb des sichtbaren Bereichs einschließlich einer kleinen Vorladezone an. Jede Seite hält höchstens 24 Karten im DOM. Seitennavigation, Details und Galerien laufen über App-Aufrufe unter dem gemeinsamen Bildbudget und CDN-Pacing. Bilddaten stehen in privaten Tool-Result-Metadaten für die Oberfläche. Das Modell erhält kompakte Fakten, Bildstatus und exakte Bild-URLs. Für bereitgestellte oder synthetische Daten bleibt ein unbekannter ursprünglicher Beobachtungszeitpunkt ausdrücklich offen.

ChatGPT nutzt die Angebotskarten als visuelle Darstellung und ergänzt eine kurze Entscheidungshilfe. Meldet der Client einen Darstellungsfehler oder unterstützt er keine MCP Apps, erhält der Nutzer kompakte Fakten und Original-Links. Benötigte Fotos können gezielt als tatsächliche MCP-Bildinhalte über `inspect_listing_images` mit `mode=images` ausgegeben werden. Der Bildstatus beschreibt den Abruf. Eine sichtbare Darstellung lässt sich anhand der Client-Rückmeldung bestätigen. Die öffentliche Verbindung liefert verifizierbare Bild-Links, der persönliche fotoaktivierte Zugang zusätzlich die Bilddaten für die Oberfläche.

## Raten und Aktualität

Die persönliche MCP-Verbindung erlaubt 120 Aufrufe pro Minute. Diese Zählung gilt für die Verbindung über wechselnde Client-IP-Adressen hinweg. Die tatsächlich ausgehenden Abrufe koordiniert ein gemeinsames SQLite-Durable-Object je Origin. Identische gleichzeitige Suchseiten, Details und Bildsuche-Folgeseiten teilen über atomare TTL-Leases einen Abruf. Der kontrollierte Runtime-Test prüft vier gleichzeitige Cold-Requests gegen genau einen Upstream-Aufruf.

| Datenquelle | Abstand zwischen Anfragen |
| --- | --- |
| willhaben-Such- und Detailseiten | Mindestens zwei Sekunden plus 0–500 ms positiver Jitter |
| Bild-CDN | Mindestens 500 ms plus 0–250 ms positiver Jitter |

Jeder Weiterleitungsschritt und jeder Wiederholungsversuch benötigt einen eigenen Abrufslot. `Retry-After` gilt vollständig als Sekundenwert oder HTTP-Datum. Netzwerkfehler und HTTP 502/503/504 erhalten bis zu zwei Wiederholungen innerhalb der Aufrufzeit. HTTP 429, Zugriffsablehnungen und Challenges führen zu einem gemeinsamen Cooldown mit strukturiertem Rückgabestatus.

Suchseiten, Facetten und Kurzbeobachtungen werden fünf Minuten, Details 15 Minuten wiederverwendet. `fresh=true` fordert eine neue Beobachtung unter derselben Anfragesteuerung an. Ergebnisse enthalten den ursprünglichen Beobachtungszeitpunkt und das Cache-Alter. Studien erhalten diese Zeiten auch für reine Suchseiten-Beobachtungen. Bei der Präsentation entscheidet der jüngste Beobachtungszeitpunkt zwischen Suchkurzfassung und Details. Bei gleichem Zeitpunkt haben Details Vorrang.

## Aussagekraft

Kriterien werden als bestätigt, widersprochen oder unbekannt ausgewiesen. Preisvergleiche berücksichtigen Kategorie, Modell, Zustand, Menge und bekannte Versandkosten. Ein vergleichbarer Median erfordert mindestens fünf geeignete Beobachtungen. `priceContext` ordnet einen Kandidaten innerhalb dieser beobachteten Kohorte ein.

Gespeicherte visuelle Anforderungen verweisen auf die tatsächlich an ChatGPT gelieferten Originalfotos und die zugehörigen Inseratfakten. Neue Befunde ergänzen unabhängige Kriterien. Eine relevante Faktenänderung oder ein ausgetauschtes Foto macht betroffene Befunde veraltet. Die Karten zeigen den Prüfstatus und einen kompakten Auszug. `get_research` mit `section=listings` und gezielten `ids` liefert die vollständigen Nachweise.

`refine_research` wertet den gespeicherten Bestand ohne weitere Marketplace-Anfragen aus. Der Auftrag fixiert Kandidatenumfang, Kriterien und Nutzerentscheidungen. Jeder Schritt verwendet die dann gespeicherte Beobachtung mit ihrem ursprünglichen Zeitpunkt. Wiederholte Cursor liefern die gespeicherte Antwort. `unknownPolicy=exclude` beschränkt Pflichtanforderungen auf ausreichend belegte Kandidaten. Die fertige Sammlung erhält alle passenden IDs in ihrer Bewertungsreihenfolge.

Die Oberfläche unterstützt eine Vergleichsauswahl über mehrere Seiten, persistentes Merken und Ablehnen sowie **Im Chat besprechen**. Diese Aktion übergibt die ausgewählten Inserat-IDs mit ihrer Recherche. Die Übernahme aus Sellpy und die geprüften Alternativen sind dokumentiert. [Sellpy-Transfer](docs/sellpy-transfer.md)

Eine Studie umfasst ihren eigenen Abruflauf. Die Recherchebilanz verbindet mehrere Suchen, Fortsetzungen, Detail- und Fotoaufrufe über die ausdrücklich weitergegebene `researchId`. Sie zeigt je Suche native Gesamtzahl, abgerufene Seiten und eindeutige Inserate sowie zugehörige Details und Fotos. Einzelnachweise enthalten Felder, Beschreibungslängen, Fotoindizes und dokumentierte Modellbefunde. Eine ausgelieferte Bilddatei wird als Lieferung erfasst. Ein visueller Befund erfordert `record_review` nach der Bildprüfung. Die Oberfläche weist ihre eigenen Fotoabrufe gesondert aus. Für eine gemeinsame spätere Auswertung können deduplizierte Daten als `source=provided` mit bis zu 300 Datensätzen eingebracht werden. Der Studienbericht benennt Abdeckung, offene Detailprüfungen und verbleibende Suchpositionen.

## Entwicklung

Node 22 oder neuer verwenden. Die Produktionsmodule verwenden die Workers-Laufzeit. Miniflare ist ausschließlich eine Entwicklungsabhängigkeit für echte workerd- und SQLite-Tests.

```sh
npm ci
npm test
npm run test:runtime
```

Die Abhängigkeiten sind auf das offizielle MCP-SDK 2.4.0 und MCP Apps 2.0.4 festgelegt. `npm run build` erzeugt den Worker und die eingebettete Browser-Bridge. Die Runtime-Suiten arbeiten mit synthetischen Upstreamdaten. Sie prüfen auch parallele Slot-Anforderungen, Cache-Persistenz nach Neustart, lange Cooldowns und tatsächliche Anfrageabstände.

Der Browserharness benötigt zusätzlich eine verfügbare Playwright-Installation mit Chromium. Er prüft die tatsächliche Oberfläche in einem simulierten MCP-Apps-Host, einschließlich Bildzuordnung, Galeriefortsetzung, Ladefehlern, Sortierung und mobilen Ansichten.

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chromium \
npm run test:browser
```

`PLAYWRIGHT_CHROMIUM_EXECUTABLE` wählt eine vorhandene Chromium-Binärdatei. Alternativ liest `PLAYWRIGHT_BROWSER_CONFIG` eine JSON-Datei mit `executablePath` und optionalen `args`. Ohne diese Angaben verwendet der Harness die normale Playwright-Browserinstallation. `UI_SCREENSHOT_DIR` speichert auf Wunsch Desktop- und Mobile-Screenshots.

## Cloudflare-Deployment

Mit `npm run build` das Bundle `dist/index.mjs` erzeugen und als einzelnes Modul `index.mjs` hochladen. `src/index.mjs` exportiert den Worker, `OriginGate` und `ResearchSession`. Die Vorlage in `deployment/metadata.json` beschreibt eine Erstinstallation.

- Den KV-Platzhalter durch den Namespace für Studien ersetzen.
- Bei einer Erstinstallation beide SQLite-Klassen aus der Vorlage anlegen. Für das Upgrade von `origin-gate-v1` nur `ResearchSession` mit `old_tag=origin-gate-v1` und `new_tag=research-v1` anlegen. Nach erfolgreicher Migration bei reinen Code-Uploads den Migrationsblock auslassen.
- `ORIGIN_GATE`, `RESEARCH_SESSIONS`, `IMAGES` und `REQUIRE_ORIGIN_GATE=true` bereitstellen. Die Images-Bindung normalisiert Referenzbilder für die native Bildsuche.
- `global_fetch_strictly_public` für öffentliche Bild-URLs aktivieren.
- Bestehende Geheimnisse mit `keep_bindings: ["secret_text"]` erhalten.
- Für die persönliche Verbindung `PERSONAL_TEST_TOKEN_SHA256` als Secret verwenden. Der Wert ist SHA-256 des 64-stelligen Installationsschlüssels.
- `PERSONAL_TEST_EXPIRES_AT` für einen Zugang bis zur Deaktivierung entfernen.
- Request- und Invocation-Logging deaktiviert halten, da die persönliche URL ein Zugangsgeheimnis trägt.

Die Betriebsentscheidungen und die geprüften GitHub-Implementierungen sind nachvollziehbar dokumentiert. [Upgrade und Architekturvergleich](docs/upgrade-1.4.md) · [Recherche und Funktionsvergleich](docs/research-and-decisions.md) · [Verifikationsübersicht](docs/feature-map.md)
