# Recherche und Entscheidungen für 1.2.0

Stand 6. November 2026. Die Untersuchung umfasst den zugänglichen eigenen Code, aktuelle öffentliche Implementierungen und einzelne anonym lesbare Marktplatzseiten. Die Umsetzung zielt auf interaktive Recherche in ChatGPT.

## Eigene Projekte

### job-crawler-at

Der aktive JCM-Pfad fordert 100 Suchtreffer je Seite an. Der tägliche Ablauf verwendet vier Seiten. Detailabrufe laufen seriell mit mindestens zwei Sekunden Abstand. Ein HTTP 429 beendet weitere Details und erhält den Retry-After-Wert. Der Code dokumentiert frühere Antworten mit 1.800 Sekunden Wartezeit nach 501 beziehungsweise 1.007 Detailanfragen. Diese historischen Beobachtungen stammen aus dem Projekt. [Aktiver willhaben-Adapter](https://github.com/larsmartens/job-crawler-at/blob/935688691e0653be6220b23cfa819f25c7059560/jcm/acquisition/willhaben.py)

Der Adapter priorisiert neue und geänderte Inserate und verwendet unveränderte vollständige Beobachtungen wieder. Die gemeinsame HTTP-Schicht enthält eigene Wiederholungslogik und einen optionalen curl_cffi-Transport. Im geprüften aktiven willhaben-Pfad erfolgt das Pacing über eigenen Code. Die Jitter-Einstellung einer älteren globalen Konfiguration gehört zur LLM-Klassifizierung. [Gemeinsame HTTP-Schicht](https://github.com/larsmartens/job-crawler-at/blob/935688691e0653be6220b23cfa819f25c7059560/jcm/acquisition/common.py)

Für das Plugin wurden Beobachtungszeiten, Wiederverwendung und das konservativere Detail-Pacing übernommen. Der gemeinsame Origin-Koordinator gilt zusätzlich über parallele Worker-Aufrufe hinweg.

### smartphone-market-monitor

Der zugängliche Stand enthält einen Audit eines lokalen willhaben-SDK mit Web-/Mobile-Adaptern, CLI, REST und MCP. Der SDK-Quellcode war weder im Workspace noch in den zugänglichen Repository-Suchergebnissen vorhanden. Diese Quelle belegt den Audit und seine beschriebenen Funktionen. [SDK-Audit](https://github.com/larsmartens/smartphone-market-monitor/blob/19478a50cbb08d56d4350e8ec297921393909cb3/docs/research/marketplace-options.md)

## Öffentliche Implementierungen

| Projekt und geprüfter Stand | Suche und Ausgaben | Anfragesteuerung | Verwendeter Ansatz |
| --- | --- | --- | --- |
| taneron/willmehr, 908a82e | 30 Treffer standardmäßig, maximal 100, dynamische Filter, Preisauswertung | 400 ms Queue-Abstand, drei Wiederholungen, exponentiell ab 500 ms plus 0–250 ms Jitter, Retry-After auf 30 Sekunden begrenzt | Seitengröße, native Filter und gezielte Preisrelationen. [Suchcode](https://github.com/taneron/willmehr/blob/908a82eebc6c204eeae3ccad346f7152dcc0ea4f/src/search.ts) · [HTTP-Code](https://github.com/taneron/willmehr/blob/908a82eebc6c204eeae3ccad346f7152dcc0ea4f/src/http.ts) |
| Samxel/willhaben-mcp, 757459c | Vier Treffer standardmäßig, maximal 50, kompakte Zusammenfassungen, explizite Fotoinhalte | httpx und drei Wiederholungen mit 0,5/1/2 Sekunden, ohne gemeinsame Origin-Taktung im geprüften Pfad | Kleine Suchobjekte, getrennte Detail- und Bildabrufe. [Zusammenfassungen](https://github.com/Samxel/willhaben-mcp/blob/757459c55ea5a7e87a34cce0910780ea4c0465dd/willhaben/summaries.py) · [API-Adapter](https://github.com/Samxel/willhaben-mcp/blob/757459c55ea5a7e87a34cce0910780ea4c0465dd/willhaben/api.py) |
| aliildan/willhaben-mcp, 3ddd9a3 | 30 Treffer standardmäßig, maximal 100, tiefergehende Suche, fünf Minuten Cache | Serialisierte Starts mit mindestens einer Sekunde Abstand, Weiterleitungen zählen einzeln, Backoff mit 25 Prozent Jitter, Retry-After als Sekunden oder Datum mit 60-Sekunden-Obergrenze | Gemeinsame Fetch-Schicht, kanonische Detail-URLs, Cache und strukturierte Abbrüche. [HTTP-Schicht](https://github.com/aliildan/willhaben-mcp/blob/3ddd9a39176a7e72ca255b7e8116b61b5fc6da73/src/api/httpClient.ts) |
| MediaForge-org/Willhaben-Suchagent, 580326b | Einseitige geplante Suche, Such-URL-Import, selektive Detailabrufe | Scheduler-Intervall 60 Sekunden und zwei parallele Aufgaben, Größen- und Zeitgrenzen | Such-URL-Import eigenständig umgesetzt, einschließlich sichtbarer nicht abgebildeter Parameter. [URL-Import](https://github.com/MediaForge-org/Willhaben-Suchagent/blob/580326b3d51053e773e87cba97d1651192dda223/agent/app/willhaben/search_url_import.py) |

Die geprüften relevanten Pfade verwenden eigene Queues und Wiederholungslogik. Eine zusätzliche Limiter-Bibliothek wie Bottleneck, p-limit oder tenacity war dort kein gemeinsamer Standard. Für Cloudflare wird die Koordination als Durable Object umgesetzt, damit alle Isolates denselben Zustand verwenden.

## Praktische Größen und Fortsetzung

Ein gezielter Live-Abruf der Marktplatzsuche für Lampe mit `rows=100` lieferte 100 unterschiedliche Inserat-IDs. BANKAMP lieferte bei angeforderten 50 und 100 Treffern jeweils 40 Ergebnisse. Die Prüfung bestand aus drei seriellen Suchabrufen. Sie begründet die Unterstützung von 100 im verwendeten öffentlichen Seitenpfad.

Die gewählten 50 Standardtreffer bieten eine brauchbare erste Auswahl. `pageSize=100` ist ausdrücklich verfügbar. Die Pagination prüft die tatsächliche Antwort und endet bei einer verifizierten leeren Seite. Eine kleinere Upstream-Seitengröße erhält ihre nächste Seitenposition.

Such-, Detail- und Foto-Fortsetzungen tragen ihren nächsten offenen Stand. Per-Aufruf-Grenzen begrenzen Antwortgröße und Latenz. Weitere Aufrufe können beliebig oft folgen, solange weitere Daten verfügbar sind. Die Zeitgrenze von 35 Sekunden liefert Teilergebnisse und gegebenenfalls den unveränderten nächsten Versuch.

## Raten, Jitter und Bibliotheken

Die 120 persönlichen MCP-Aufrufe pro Minute erlauben kurze Folgefragen, Cache-Lesezugriffe und präzise Werkzeugketten. Die Schlüsselbildung folgt der persönlichen Verbindung. Die ausgehende Rate wird unabhängig davon gemeinsam je Origin gesteuert.

Für HTML gelten zwei Sekunden plus 0–500 ms positiver Jitter, für Bilder 500 ms plus 0–250 ms. Jeder reale Start benötigt eine aktuelle Freigabe. Wartende Aufrufe prüfen den Zustand erneut, sodass ein zwischenzeitlicher Cooldown sie stoppt. Diese Werte sind gewählte Betriebsparameter für das persönliche Plugin.

Retry-After wird vollständig erhalten. Ein gemeldetes 1.800-Sekunden-Fenster bleibt 1.800 Sekunden lang. Netzwerkfehler und 502/503/504 erhalten maximal zwei Wiederholungen mit exponentiellem Backoff und Jitter. HTTP 429 ohne verwertbaren Header erzeugt einen 30-minütigen Cooldown. Zugriffsablehnungen und Challenges erhalten einen einstündigen Cooldown, gegebenenfalls verlängert durch Retry-After.

Die Produktionsmodule verwenden native Workers-APIs. Miniflare 4.20260730.0 ist für die Verifikation mit workerd und SQLite gepinnt. Der Ursprungscache hält normalisierte Beobachtungen mit ursprünglichem Zeitstempel. Suchdaten gelten fünf Minuten, Detaildaten 15 Minuten, beobachtete gelöschte Inserate 60 Sekunden.

## Funktionsauswahl

| Funktion aus den verglichenen Projekten | Umsetzung und Nutzen |
| --- | --- |
| Such-URL-Import | `parse_search_url` übernimmt bekannte Filter, Seitenposition und native Seitengröße. Zusätzliche Parameter werden sichtbar zurückgegeben. |
| Präzise Filterdiscovery | Überblick, Suche innerhalb einer Dimension und paginierte Werte. Ähnlich benannte Orte oder Kategorien bleiben anhand ihrer IDs unterscheidbar. |
| Kompakte Suchausgabe | Feldauswahl erfolgt vor der MCP-Serialisierung. Beschreibungen und Galerien kommen über gezielte Folgeaufrufe. |
| Titelbilder und vollständige Galerie-Navigation | Titelbilder stammen direkt aus der Suchseite. `imageIds` selektiert Kandidaten. Alle verfügbaren Galerieindizes sind in kleinen Paketen erreichbar. |
| Preisrelation eines Angebots | `priceContext` berechnet Abstand zum Median nur innerhalb ausreichend großer, vergleichbarer Kohorten mit bekanntem Stückbezug. |
| Cache und aktuelle Verfügbarkeitsprüfung | Originale Beobachtungszeiten, Cache-Alter und `fresh` unterstützen nachvollziehbare Wiederverwendung. |
| Geplante Benachrichtigungen | Als separate Automationsfunktion eingeordnet. Der aktuelle Ablauf wird durch Chat-Anfragen gestartet. |
| Mobile-, Immobilien- und Job-Endpunkte | Der aktuelle Adapter bedient den Marktplatz. Kategorien und Regionen werden aus diesem Quellbereich aufgelöst. |

## Abschließende AXI- und Skill-Optimierung

AXI wurde nach Abschluss der funktionalen Implementierung im Originalprojekt gefunden und gelesen. Die geprüfte Datei liegt im Commit 37fb6cce0a378706e3fb0eb499e71ab307f0d5b1. Für diesen MCP-Transport werden die Prinzipien als sparsame Projektionen, explizite Auswahl, fortsetzbare Antworten, Zählwerte, frühe Eingabevalidierung und korrigierbare Fehler umgesetzt. [AXI-Skill](https://github.com/kunchenguid/axi/blob/37fb6cce0a378706e3fb0eb499e71ab307f0d5b1/.agents/skills/axi/SKILL.md)

MCP transportiert die strukturierten Ergebnisse als JSON und Fotos als native Bildblöcke. Die TOON-Spezifikation wurde gelesen. Der gewählte MCP-Vertrag bewahrt die bestehenden Client-Schemata und die direkte ChatGPT-Bildverarbeitung. Die Ausgabeoptimierung findet bereits an der Feldauswahl statt. [TOON-Spezifikation](https://github.com/toon-format/spec/blob/main/SPEC.md)

Die Standardsuche enthält sieben entscheidungsrelevante Felder sowie die verfügbare Galerie-Vollständigkeit. Redundantes `hasPhotos`, Zustand und Preisart sind explizit auswählbar. Detailbeschreibungen beginnen mit 1.500 Zeichen und weisen Gesamtlänge und Kürzung aus. Bekannte Suchargumente führen direkt zum Suchtool. Ein Planungsaufruf ist für die Klärung von Umfang oder Fähigkeiten vorgesehen.

Writing for Agents prägt den kurzen Kernablauf und die bedingten Verweise für Fotos, Fortsetzung und Studien. pstack Authoring a Skill prägt die Prüfung von Frontmatter, Referenzen und realen Anwendungsfällen. Encode Lessons in Structure wird durch Cursor-Prüfungen, Schema-Validierung und Regressionstests umgesetzt. [pstack Authoring a Skill](https://github.com/cursor/plugins/blob/c742dd61706fbacc1b95f1a20b7b988cf096ce6c/pstack/skills/poteto-mode/playbooks/authoring-a-skill.md) · [Encode Lessons in Structure](https://github.com/cursor/plugins/blob/c742dd61706fbacc1b95f1a20b7b988cf096ce6c/pstack/skills/principle-encode-lessons-in-structure/SKILL.md)
