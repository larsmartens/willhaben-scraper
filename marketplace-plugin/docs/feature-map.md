# Verifikationsübersicht für 1.3.2

Die Node-Suite prüft die Tool- und Protokollverträge. Zwei zusätzliche Miniflare-Suiten prüfen denselben Traffic- und Cache-Code in workerd mit SQLite. Die unabhängigen Reviews verwenden eigene synthetische Repros.

| Nutzerpfad | Erwartetes Verhalten | Wiederholbare Prüfung |
| --- | --- | --- |
| Erste Suche | 50 kompakte Treffer als Standard, optional 100 | `test/tools.test.mjs` prüft Schema, tatsächliche Anzahl und Feldprojektion |
| Weitere Seiten | Fortsetzung über zahlreiche Aufrufe, Bindung an Query, Filter, Seitengröße und Datensatz | Tool-Regressionsfall mit 40 Seiten, unabhängiger Durchlauf mit 205 Seiten |
| Ausgewählte Details | Alle 100 ausgewählten IDs in wiederholten Fünferpaketen erreichbar | Tool-Regressionsfall und unabhängiger Durchlauf mit 20 Aufrufen |
| Such-Titelbilder | Gezieltes Bild eines späteren Treffers ohne Detailabruf | `imageIds`-Regression mit Treffer 12 und falscher Seiten-ID |
| Lange Fotogalerie | Jeder Fotoindex erreichbar und Bildblock korrekt zugeordnet | Galerie-Regressionsfälle, unabhängige Prüfung der Indizes 15 und 19 |
| Foto-Abbruch | Erfolgreiche Bilder behalten und unterbrochenen Index erneut anbieten | Timeout-, TypeError- und ECONNRESET-Regressionsfälle |
| Große Bilder | Gemeinsames Antwortbudget einhalten und aktuelle Position erhalten | Bytebudget-Regressionsfall unter 8 MiB Base64-Ausgabe |
| Echte Miniatur fehlt | Verfügbare Vollbilddatei mit korrektem Größenlabel ausgeben | Provider-, Cover- und Galerie-Regressionsfälle |
| Filterwerte | Große Dimensionen und Wertebestände gezielt erreichbar | Tool- und Provider-Tests jenseits früherer Wertgrenzen |
| Native Such-URL | Query, bekannte Filter, Seitengröße und Position erhalten | URL-Import-Tests einschließlich Kategoriepfad und unbekannten Parametern |
| Cache-Frische | Originale Zeit an Suchseite, Studie und Details erhalten | Engine-Regression und unabhängiger Repro einer 120 Sekunden alten Suchseite |
| Preisvergleich | Geeignete Kohorten und bekannte Stückbasis verwenden | Engine-Tests für Median, Ausschlüsse und `priceContext` |
| Gespeicherte Vergleiche | Abrufpolicy `fresh` lässt die semantische Suchdefinition vergleichbar | Tool-Regressionsfall und unabhängiger +10-EUR-Median-Repro |
| Parallele Requests | Eine gemeinsame Origin-Freigabe für gleichzeitige Bewerber | `test/origin-gate.runtime.mjs` mit 16 gleichzeitigen Anforderungen |
| Lange Wartezeit | 1.800 Sekunden Cooldown vollständig erhalten | Traffic-Tests und beide Workers-Runtime-Suiten |
| SQLite-Neustart | Cooldown und originale Cache-Beobachtungen bleiben vorhanden | OriginGate-Runtime-Neustarttest |
| Provider und echter Cache | Suche, kanonische Details, Facetten und 404-Tombstones funktionieren gemeinsam | `test/provider.runtime.mjs` mit synthetischem Outbound-Service |
| Private Verbindung | Zugang bis zur Deaktivierung, korrekter Scope und stabile Ratenzählung | Personal- und Worker-Tests |
| ChatGPT-Transport | Initialize, tools/list, tools/call, Bilder und strukturierte Fehler | Worker-Tests, offizieller MCP-SDK-Probe und JSON-Schema-Validatoren |
| Auswahl mit Fotos | Ein eigenes Inseratfoto und kanonische Fakten pro ausgewählter Karte | `test/presentation.test.mjs` prüft Reihenfolge, ID-/Index-Zuordnung und fehlende Beobachtungen |
| Zeitlich stimmige Karten | Neueste vollständige Beobachtung samt ursprünglichem Zeitpunkt verwenden | Regression für jüngere Suche, jüngere Details, Gleichstand und Löschmarkierung |
| Kleiner Modellkontext | Fotobytes ausschließlich an die Oberfläche liefern | Worker- und SDK-Prüfung von `content`, `structuredContent` und `_meta` |
| Große oder fehlende Titelbilder | Native Miniatur verwenden oder konkreten Fehler mit Fortsetzung erhalten | Regressionen für 404, 429, Antwortbudget, Thumbnail-Fallback und ungültigen Fotoindex |
| MCP-Apps-Ressource | Versionierte Oberfläche über `resources/list` und `resources/read` bereitstellen | Protokolltests einschließlich aktueller und älterer unterstützter MCP-Versionen |
| MCP-2026-Ressourcenabruf | Pflichtfelder `ttlMs` und `cacheScope` in Ressourcen- und Template-Antworten liefern | Regression und unabhängiger Parent/Head-Vergleich gegen die offiziellen methodenspezifischen JSON-Schemas |
| Tatsächlicher ChatGPT-Client | Vorher fehlschlagende Auswahl mit drei Originalfotos öffnen und Galerie bis Foto 7 fortsetzen | Im betroffenen persönlichen Chat mit Browserdarstellung, dekodierten Bildern und Galerie-Fortsetzung beobachtet |
| Optionaler Clientname | Moderne Discovery- und Ressourcen-Anfragen ohne `clientInfo` annehmen | Worker-Regressionen für öffentlichen und persönlichen Zugang, ungültige vorhandene Metadaten werden geprüft |
| Vorherige Ressourcen-URI | Bereits gespeicherte v1-Toolmetadaten können die korrigierte Oberfläche laden | Präsentations-Regression für v1 und v2 über beide MCP-Protokolle |
| Oberfläche schließen | `ui/resource-teardown` mit derselben Anfrage-ID bestätigen | Browser-Regression und Lifecycle-Prüfung mit offiziellem MCP-Apps-AppBridge |
| Mobiles Kartenkarussell | Fotoidentität, klare Angaben und Navigation bei 360 Pixel Breite | `test/presentation-ui.browser.mjs` mit Chromium und simuliertem MCP-Apps-Host |
| Interaktive Folgeaktionen | Lokal sortieren, Original öffnen und Galerien fortsetzen | Browserprüfungen mit `nextIndex`, `remainingIndices`, Cooldown, Retry und abweichender Fotoidentität |
| Darstellung realer Angebote | Die tatsächlich abgerufenen Tiffany-Fotos richtig darstellen | Unabhängiger Chromiumlauf bei 390 Pixeln, 360 Pixeln im dunklen Modus und 1024 Pixeln in der größeren Ansicht |
| Fehlerhafte Aktualisierung | Vorhandene Karten und Fotos erhalten, Fehler sichtbar machen | Browserprüfungen mit fehlgeschlagener Aktualisierung, ungültigen Antworten und nicht vertrauenswürdigem Text |

## Ausführung

Im Verzeichnis `marketplace-plugin` ausführen.

```sh
npm ci
npm test
npm run test:runtime
```

Die veröffentlichte HTTPS-Verbindung wird zusätzlich mit einer aktuellen Suche, gezieltem Detailabruf und echtem Foto geprüft. Der zugehörige Release-Nachweis wird im Pull Request festgehalten. Der portable Skill wird anhand eines bereitgestellten Katalogs in einem frischen Agentenlauf geprüft.

Der zusätzliche Browserlauf benötigt eine vorhandene Playwright-Installation und einen kompatiblen Chromium-Browser. Die Umgebung kann über `PLAYWRIGHT_CHROMIUM_EXECUTABLE` oder `PLAYWRIGHT_BROWSER_CONFIG` eine Startkonfiguration bereitstellen. Die Browserprüfungen führen die tatsächliche HTML-Ressource mit einem simulierten Host aus. Der Release-Nachweis benennt eine zusätzliche Prüfung im persönlichen ChatGPT-Client, sobald sie dort beobachtet wurde.
