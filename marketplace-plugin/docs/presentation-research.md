# Recherche zur Ergebnisdarstellung

Stand 6. November 2026. Anlass ist der tatsächliche Einsatz von Marktplatz-Livetest zur Suche nach günstigen Tiffany-Lampen. Der Nutzer möchte zu jedem einzeln besprochenen Angebot ein Bild sowie eine übersichtliche, konsistente Darstellung.

## Geprüfte Ansätze

| Quelle | Geprüfter Ansatz | Übernahme |
| --- | --- | --- |
| aliildan/willhaben-mcp, 3ddd9a3 | MCP-Apps-Ressource mit Bildkarten, Detailansicht und Host-Aktionen | Versionierte UI-Ressource und gezielte Galerie- und Linkaktionen |
| aliildan Recherche-Skill | Geordnete Shortlist mit knappen Gründen und offenen Punkten, sichtbarer Rechercheumfang | Kurze Assistenteneinordnung und offene Anforderungen je Angebot |
| Samxel/willhaben-mcp, 757459c | Kompakte Suchobjekte und separate echte Fotoinhalte | Kleiner Modellkontext während der Recherche, bewusste visuelle Prüfung ausgewählter Angebote |
| taneron/willmehr, 908a82e | Stichprobengröße, Median, Quartile und relative Preisposition | Preisurteile auf die belegte Vergleichskohorte beziehen |
| MediaForge-org/Willhaben-Suchagent, 580326b | Deutsche Bildkarten mit Titel, Preis, Ort, Zustand und eindeutiger Original-Aktion | Einheitliches Informationsraster und verständliche Beschriftungen |

Die aktuellen HEADs entsprechen den bereits für 1.2.0 geprüften Ständen. Die Codeprüfung der fremden Oberflächen war lesend. Die eigenen Verhaltensprüfungen sind im Release-Nachweis festgehalten.

- [aliildan Server](https://github.com/aliildan/willhaben-mcp/blob/3ddd9a39176a7e72ca255b7e8116b61b5fc6da73/src/server.ts)
- [aliildan UI](https://github.com/aliildan/willhaben-mcp/blob/3ddd9a39176a7e72ca255b7e8116b61b5fc6da73/ui/app.js)
- [aliildan Recherche-Skill](https://github.com/aliildan/willhaben-mcp/blob/3ddd9a39176a7e72ca255b7e8116b61b5fc6da73/.claude/skills/apartment-hunt/SKILL.md)
- [Samxel Zusammenfassungen](https://github.com/Samxel/willhaben-mcp/blob/757459c55ea5a7e87a34cce0910780ea4c0465dd/willhaben/summaries.py)
- [taneron Preisstatistik](https://github.com/taneron/willmehr/blob/908a82eebc6c204eeae3ccad346f7152dcc0ea4f/src/deals.ts)
- [MediaForge Dashboard](https://github.com/MediaForge-org/Willhaben-Suchagent/blob/580326b3d51053e773e87cba97d1651192dda223/extension/src/dashboard.ts)

## Wahl der Oberfläche

| Form | Eignung für diese Aufgabe |
| --- | --- |
| Markdown mit exakt zugeordnetem Inseratfoto | Ein direkt verwendbarer Chat-Fallback mit Bild, Preis, Einordnung und Original-Link je Angebot |
| Generische Bildsuch-Karussells | Die verfügbare Schnittstelle nimmt Suchbegriffe entgegen. Die feste Zuordnung eines konkreten Inseratfotos zu seiner Inserat-ID benötigt einen anderen Datenvertrag. |
| MCP-Apps-Karten für die finale Auswahl | Unterstützen genaue Bildzuordnung, lokale Sortierung, Galerie-Fortsetzung und Host-Aktionen direkt im Chat |
| UI an jedem Suchaufruf | Würde Zwischenstände und breite Suchseiten wiederholt darstellen. Das fokussierte Präsentationstool erhält stattdessen die vom Assistenten geprüfte Auswahl. |

OpenAI empfiehlt getrennte Daten- und Renderwerkzeuge. Die ausgewählte Umsetzung verwendet `present_listings` mit `_meta.ui.resourceUri` und einer Ressource vom Typ `text/html;profile=mcp-app`. Die vorhandenen Suchwerkzeuge liefern weiterhin Daten für die Recherche. [Offizielle UI-Anleitung](https://developers.openai.com/plugins/build/chatgpt-ui)

Die Oberfläche nutzt tatsächlich abgerufene Inseratfotos. Bildbytes werden über das vorhandene Bildbudget und CDN-Pacing geladen und ausschließlich im Tool-Result-`_meta` an die Oberfläche übertragen. Die modelllesbare Antwort enthält kompakte Fakten, Bildstatus und konkrete Quellen-URLs. [Tool-Result-Metadaten](https://developers.openai.com/plugins/reference)

## Inhaltliche Regeln

- Jedes einzeln empfohlene oder diskutierte Angebot erhält die zugehörige Inserat-ID, sein Bild, Preis, Ort und Original-Link.
- Die erste Auswahl umfasst gewöhnlich drei bis sechs Angebote. Weitere Angebote folgen in eigenen Paketen.
- Inseratfakten, Assistenteneinordnung und offene Fragen bleiben erkennbar. Hersteller- und Echtheitsangaben benötigen explizite Belege.
- Angebotspreis, bekannte Stückzahl, berechenbarer Stückpreis und bekannte Versandkosten werden präzise beschriftet.
- Eine Preisaussage bezieht sich auf eine bekannte Vergleichsbasis mit Stichprobengröße. Die ausgewählte Shortlist allein beschreibt ihre eigene Preisverteilung.
- Fehlende oder fehlerhafte Fotos erhalten einen ausdrücklichen Status am Angebot. Bereits nutzbare Karten bleiben sichtbar.
- Die Rechercheabdeckung wird knapp mit tatsächlichem Umfang und offenen Prüfungen benannt.

## Verbesserungen gegenüber beobachteten Details

Produktbilder verwenden `object-fit: contain`, damit der gesamte Gegenstand sichtbar bleibt. Unbekannte Anbieterart behält ihren unbekannten Zustand. Galerie-Fortsetzungen verwenden die zurückgegebene nächste Position. Ladefehler erscheinen an der betroffenen Aktion. Ein ungewöhnlich niedriger Preis wird als Anlass zur genaueren Prüfung eingeordnet.

## Prüfbarer Abschluss

Der Serververtrag muss die Ressource und Bilder korrekt zuordnen. Ein Browserlauf muss Sortierung, Foto-Fortsetzung, Linköffnung, sichere Textdarstellung, Fehlerzustände und mobile Breite anhand des tatsächlich ausgelieferten HTML prüfen. Ein zusätzlicher HTTPS-Lauf prüft den veröffentlichten Worker. Die tatsächliche Darstellung im persönlichen ChatGPT-Client wird nur dann als beobachtet bezeichnet, wenn sie dort ausgeführt wurde.
