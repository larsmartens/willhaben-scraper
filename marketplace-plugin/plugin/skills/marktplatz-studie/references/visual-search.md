# Visual search

## Select one reference

Call `search_by_image` with exactly one source.

- `image` takes the ChatGPT attachment descriptor supplied by the host. Preserve its real `download_url` and `file_id`. MIME type and file name are optional host fields.
- `imageUrl` takes a public HTTPS image URL that the user supplied or that you retrieved for this task.
- `listingId` with optional zero-based `photoIndex` takes an observed willhaben gallery photo. The default index is zero.

The server normalizes attachment and URL inputs for native willhaben similarity search. Keep the attachment descriptor within the tool input. The returned research record contains source type and search identity.

## Continue and evaluate

Read the first compact page and the effective returned filters. A native listing-photo search can inherit a category from willhaben's similarity link. Use `continuation.arguments` for further pages and preserve `researchId`. A changed filter or page size starts a new first-page call with the reference image.

Similarity ranking identifies candidates. Inspect their actual descriptions and photos before confirming the user's requirements. Present the relevant candidates with `present_listings` and the same research ID. The app can show all observed matches in bounded pages.

If the input is unavailable, expired or unsupported, follow the structured error's corrective action. A fresh attachment descriptor can replace an expired download URL. Preserve the existing research ID when the task remains the same.
