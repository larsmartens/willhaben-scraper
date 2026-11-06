# Presenting offers

## Assemble the selection

After research, call `present_listings` for the listings you will individually recommend or discuss. Use the observed IDs in recommendation order, a short title and a concise summary when it adds context. A first comparison usually contains three to six offers. A single-listing question needs one card. Split larger selections into focused groups using the current schema's batch size.

Write each `reason` around the user's actual requirements. Put material unanswered questions in `cautions`. Include the user's explicit `criteria` for evidence-based requirement checks. Use `photoIndex` when an already inspected gallery photo shows the relevant feature better than the cover.

The tool supplies canonical facts and the original observation time from the latest available search or detail observation. When `missingIds` are returned, inspect those IDs and repeat the selection. If a newer search observation leaves specifications open, use `inspect_listings` to establish current detail evidence.

The component displays the selected photos, facts and assessments. Its photo buttons request gallery batches on demand. Its price sorting operates locally. Component photos arrive in widget-only `_meta`. For claims about visible damage, materials or shape, inspect actual image content through the photo tools first.

## Write the accompanying answer

Use the component's rendered cards as the visual presentation. Accompany them with a short recommendation or unresolved decision, material trade-offs and search coverage. Keep each offer's photo, facts, reasoning and original link together in its card. When a photo is unavailable, retain that status on the offer and leave appearance-dependent requirements open.

State quantity and the price's unit explicitly when supported by the listing. Keep unknown quantity or shipping costs visible as open questions. Describe manufacturer, age and authenticity according to the available evidence. For market-price comparisons, name the comparable cohort and sample size.

## Recover when the host cannot display cards

When the host lacks a card renderer or reports a display failure, use `cards` for compact text with each offer's title, price, location, reasoning and original link. For live offers, retrieve only the photos needed for the decision with `inspect_listing_images`, using `id=card.id`, `indices=[card.image.index]` and `mode=images`. Present its returned MCP image blocks through the host's supported image renderer. Keep the photo and listing ID paired and expand the gallery only when another view is needed.

Treat `image.status=ready` as confirmation that the server retrieved the photo bytes. Confirm visibility only after observing the client display or receiving the user's confirmation. If image rendering remains unavailable, state that limitation and keep the original links usable.

## Resolve incomplete photos in any client

For `missing`, state that the observed listing has no available photo. For `pending` or `failed`, show the returned status and follow `image.error.nextAction` or the result's `nextAction`. Respect `retryAt` before a new fetch. Correct an unavailable `photoIndex` using `availableIndices`, or inspect the listing to establish its complete gallery. Keep successful cards and photos usable while resolving the affected offer.

When ending a blocked turn, record the affected listing IDs, selected photo indices and earliest retry time so the next request can resume precisely. A visual recommendation remains provisional while its required photo evidence is unavailable.

## Keep the next action focused

Use search continuations for more candidates, detail tools for uncertain specifications and photo tools for visible features. Repeat `present_listings` when the recommended selection changes or a selected photo becomes available. A gallery continuation uses `nextIndex` or the explicit `remainingIndices` and preserves the photos already returned.
