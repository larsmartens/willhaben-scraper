# Angebotsdarstellung für 1.3.0

## Ziel

Jedes im Chat empfohlene oder einzeln besprochene Angebot erhält sein eigenes Inseratfoto, den Original-Link, Preis, Ort und eine knappe nachvollziehbare Einordnung. Die erste Übersicht umfasst gewöhnlich zwölf relevante Angebote. Such- und Detailwerkzeuge unterstützen die Recherche, ein gezielter Präsentationsaufruf stellt die ausgewählten Ergebnisse dar.

## Entscheidung

Ein zusätzliches `present_listings` verbindet die geprüfte Auswahl mit einer versionierten MCP-Apps-Ressource. Die Karten verwenden vorhandene Beobachtungen aus dem Provider. Empfehlungsgründe und offene Fragen sind als Einordnung des Assistenten gekennzeichnet. Die Modellantwort enthält kompakte Kartenfakten und konkrete Bild-URLs. Der normale Antwortpfad verweist knapp auf die App-Karten. Bilddaten für die Oberfläche werden ausschließlich in Tool-Result-`_meta` übertragen.

Die Oberfläche zeigt unbeschnittene Produktfotos, Preis und bekannte Versandkosten, Ort, Zustand, Beobachtungszeit und offene Anforderungen. Lokales Sortieren benötigt keinen neuen Abruf. Galerie und Originalinserat sind gezielte Folgeaktionen. Ein fehlendes Foto oder ein Abruffehler bleibt am zugehörigen Angebot sichtbar.

## Datenform

`present_listings` erhält die Datenquelle und eine Recherche-ID. Die Sammlung kann alle beobachteten Inserate, ausgewählte Suchläufe oder bis zu 1.000 ausdrücklich geordnete Inserat-IDs umfassen. Gründe, offene Fragen und ausgewählte Fotoindizes ergänzen einzelne Karten. Kanonische Inseratfakten und Bildzuordnungen stammen aus dem Provider. Einträge außerhalb des vorhandenen Beobachtungsbestands werden als erneut zu prüfende IDs ausgewiesen.

Die kompakte Antwort enthält Quelle, Titel, Auswahl, Fehler und offene IDs. Jede Karte verbindet Inserat-ID, Original-Link, Beobachtungszeit, verifizierte Fakten, Assistenteneinordnung und Bildstatus. Die UI-Hydration enthält die tatsächlichen Bilddaten. Der Worker trennt diese Metadaten vor der modelllesbaren Serialisierung ab.

## Betriebsparameter

Die Bildfunktion liefert zwei Titelbilder vorab. Die App fordert sichtbare Hauptbilder in Viererpaketen sowie Galerien und Details über `browse_collection` an. CDN-Pacing und Antwortbudget gelten gemeinsam. Eine Seite erzeugt zwölf oder vierundzwanzig Karten. Der offizielle MCP-Apps-Client steuert Host-Kommunikation und Lifecycle. Generation-Prüfungen verhindern, dass verspätete Antworten eine neuere Auswahl überschreiben.

## Arbeitsfolge

- [x] Blocking first steps. Aktuelle OpenAI-Verträge, bestehende Provider und konkrete GitHub-UI-Implementierungen prüfen.
- [x] Independent workstreams. Backend und Oberfläche wurden anhand derselben Datenform implementiert. Ein unabhängiger Review prüfte den Backend-Vertrag, ein eigener Browserlauf prüfte die Oberfläche mit tatsächlich abgerufenen Fotos.
- [x] Shared mutable state. Ein Implementierungs-Owner koordinierte Tool-Schemata und Worker-Serialisierung. Die Oberfläche hatte einen eigenen Owner und der abschließende Anleitungsdurchlauf getrennte Dateien.
- [x] Smallest safe decomposition. Ein fokussiertes Präsentationstool und eine selbständige Oberfläche verwenden die bestehende Foto- und Cache-Logik.

## Verifikation

Protokolltests prüfen Ressourcen, Metadaten und die Trennung der Bilddaten. Verhaltenstests prüfen Fotozuordnung, fehlende Bilder, Eingabevalidierung und die Wiederverwendung von Beobachtungen. Ein Browser mit simuliertem MCP-Apps-Host prüft Darstellung bei mobiler Breite, dunkles Theme, Sortierung, sichere Texte, Linköffnung, Galeriefortsetzung und sichtbare Fehler. Nach Deployment folgen Ressourcen- und Live-Prüfungen gegen den veröffentlichten Worker.

Die eingebettete Oberfläche benötigt aktualisierte Tool- und Resource-Metadaten in der ChatGPT-Verbindung. Der Release-Nachweis benennt die tatsächlich geprüften Client-Oberflächen.

## Abschließende Agent-Anleitung

AXI wurde nach der funktionalen Implementierung auf kompakte Kartendaten, genaue Fotoidentität und korrigierbare Fehler angewandt. Die bestehenden MCP-Schemata bleiben die maßgebliche Argumentreferenz. Bildbytes stehen ausschließlich im für die Oberfläche bestimmten `_meta`.

Writing for Agents und die pstack-Autorenregeln prägen den kurzen Kernablauf und bedingt geladene Referenzen. Die Präsentationsreferenz beschreibt Auswahl, Bildzuordnung, Text-Fallback und Fehlerfortsetzung. Tatsächliche visuelle Aussagen setzen weiterhin ein geprüftes Bild im Modellkontext voraus. Eine unabhängige Auswertung mit frischem Kontext prüft die Anleitung anhand von Auswahl, fehlenden Fotos, abgelaufenen Beobachtungen und visuellen Rückfragen.

## Quellen

- OpenAI empfiehlt getrennte Daten- und Renderwerkzeuge. [MCP-UI](https://developers.openai.com/plugins/build/chatgpt-ui)
- Tool-Result-`_meta` liefert widget-spezifische Daten. [Referenz](https://developers.openai.com/plugins/reference)
- aliildan zeigt einen konkreten MCP-Apps-Build mit Fotokarten und Host-Aktionen. [Implementierung](https://github.com/aliildan/willhaben-mcp/blob/3ddd9a39176a7e72ca255b7e8116b61b5fc6da73/ui/app.js)
- MediaForge verwendet klar beschriftete deutsche Angebotskarten. [Dashboard](https://github.com/MediaForge-org/Willhaben-Suchagent/blob/580326b3d51053e773e87cba97d1651192dda223/extension/src/dashboard.ts)
