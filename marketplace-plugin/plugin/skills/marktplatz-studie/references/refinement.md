# Refine an existing selection

Use `refine_research` with the existing `researchId` when the user changes requirements or wants to reconsider discovered offers. The tool evaluates retained observations and saved findings. Use search continuations separately when the task needs additional candidates.

## Set the criteria

Use `criteria` for explicit structured facts, such as `price` with an inclusive `max`. Use `requirements` for exact saved visual labels. Set `mode=require` for a mandatory feature, `avoid` for an excluded feature and `prefer` for a ranking preference. Preserve the label's words and negation across photo review and refinement.

Choose `unknownPolicy=exclude` when the user requests verified-only matches. The default `include` keeps unresolved candidates available. Report `unknownCount` with its scope. A preference changes the ordering of eligible offers. A hard contradiction excludes the offer even when the user has marked it for the shortlist.

Use `queryIds` to restrict the starting cohort to selected searches. Use `feedbackFilter=shortlisted` when the user asks for the saved shortlist. Explicitly rejected offers are excluded. Store a user's decision with `set_listing_feedback` and choose `neutral` to clear it.

## Complete the evaluation

Each call evaluates at most 256 candidates. Continue with the returned `continuation.arguments` until `completed=true`. Keep `researchId`, `refinementId` and `cursor` together. The response reports total candidates, evaluated, eligible, excluded and unknown counts.

The job fixes its cohort, criteria and feedback at the start. Each step evaluates retained source observations with their original `observedAt`. Repeated cursors return the saved step response. Start a new job after changed requirements, new findings or a new user decision.

When a strict requirement leaves too few candidates, use `reviewNeeded` to select unresolved offers worth checking. Retrieve their original photos, record the actual requirement evidence, and start a new refinement. Use the full targeted research audit when a compact card omits relevant findings.

Open the completed result with its returned `presentation` arguments. Preserve the result's `collectionId` so every eligible offer remains reachable. For zero eligible offers, state the evaluated scope and unresolved requirements, then continue only where additional evidence or candidates can resolve the user's request.
