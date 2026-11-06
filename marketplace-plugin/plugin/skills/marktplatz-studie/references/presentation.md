# Presenting offers

## Assemble the selection

After research, call `present_listings` for the listings you will individually recommend or discuss. Use the observed IDs in recommendation order, a short title and a concise summary when it adds context. A first comparison usually contains three to six offers. A single-listing question needs one card. Split larger selections into focused groups using the current schema's batch size.

Write each `reason` around the user's actual requirements. Put material unanswered questions in `cautions`. Include the user's explicit `criteria` for evidence-based requirement checks. Use `photoIndex` when an already inspected gallery photo shows the relevant feature better than the cover.

The tool supplies canonical facts and the original observation time from the latest available search or detail observation. When `missingIds` are returned, inspect those IDs and repeat the selection. If a newer search observation leaves specifications open, use `inspect_listings` to establish current detail evidence.

The component displays the selected photos, facts and assessments. Its photo buttons request gallery batches on demand. Its price sorting operates locally. Component photos arrive in widget-only `_meta`. For claims about visible damage, materials or shape, inspect actual image content through the photo tools first.

## Write the accompanying answer

Lead with the recommendation or the unresolved decision. Present the cards together, then explain only material trade-offs, evidence and search coverage. Each individually mentioned offer needs its own listing photo and original link. Use the same listing ID for the displayed photo, facts and reasoning. When a photo is unavailable, retain that status on the offer and leave appearance-dependent requirements open.

State quantity and the price's unit explicitly when supported by the listing. Keep unknown quantity or shipping costs visible as open questions. Describe manufacturer, age and authenticity according to the available evidence. For market-price comparisons, name the comparable cohort and sample size.

## Handle a text-only client

Use `cards` to write consistent compact offer blocks. For each ready or `not_enabled` photo, embed the exact `card.image.url` as a Markdown image beside its title, price, location, reasoning and original link. The URL identifies that listing's actual photo.

## Resolve incomplete photos in any client

For `missing`, state that the observed listing has no available photo. For `pending` or `failed`, show the returned status and follow `image.error.nextAction` or the result's `nextAction`. Respect `retryAt` before a new fetch. Correct an unavailable `photoIndex` using `availableIndices`, or inspect the listing to establish its complete gallery. Keep successful cards and photos usable while resolving the affected offer.

When ending a blocked turn, record the affected listing IDs, selected photo indices and earliest retry time so the next request can resume precisely. A visual recommendation remains provisional while its required photo evidence is unavailable.

## Keep the next action focused

Use search continuations for more candidates, detail tools for uncertain specifications and photo tools for visible features. Repeat `present_listings` when the recommended selection changes or a selected photo becomes available. A gallery continuation uses `nextIndex` or the explicit `remainingIndices` and preserves the photos already returned.
