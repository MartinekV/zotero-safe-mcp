# 10: Image upload endpoint and images in notes

**What to build:** `POST /safe-mcp/image` (bearer auth; PNG or JPEG validated by magic bytes, max 10 MB) returning an `imageId`; uploads held in memory (with a total cap) and discarded on shutdown; `![caption](image:<imageId>)` in `create_note`/`edit_note` stores the image as an embedded image attachment of the note. Each imageId is single-use.

**Blocked by:** 04, 05

**Status:** resolved

- [x] Unit tests: content validation (magic bytes, size limit, wrong type), id lookup, cap enforcement

## Comments

- **Built:** `src/endpoints/image.ts` (handler behind `createImageUploadHandler`, unit-tested with a fake body reader),
  `src/images/imageFormat.ts` (`sniffImage`: PNG/JPEG by magic bytes + width/height from IHDR / SOF; JPEG EXIF
  orientation 5–8 swaps the sides, as browsers display it), `src/images/uploads.ts` (in-memory store),
  `src/hooks/image-uploads.ts` (clears on shutdown). Wired in `src/notes/zoteroLookups.ts`: `noteLookups()` resolves
  `image:<imageId>` to a pre-generated attachment key + width/height; `importImages(note)` (inside recordWrite, after
  the note is saved) imports them with ticket 05's transaction-free `importEmbeddedImage` (now takes the key);
  `consumeUploads()` after the write commits. End to end in `test/integration/image-upload.itest.ts` (incl. the note
  editor opening/closing the note without rewriting it or erasing the image).
- **Request:** raw bytes as the body, `Content-Type: image/png`, `image/jpeg` or `application/octet-stream` (bytes
  decide; a declared image type that doesn't match the bytes → 415). E.g.
  `curl -H "Authorization: Bearer $T" -H 'Content-Type: image/png' --data-binary @fig.png $BASE/safe-mcp/image`.
  Response: `{ imageId, contentType, width, height, bytes, expiresAt, markdown: "![caption](image:<id>)" }`.
  Ids look like `img-<16 chars>`, never like an attachment key, so edit_note's "own image key" lookup can't collide.
- **Memory bounds (my choice):** 10 MB per image, at most 20 unused uploads and 50 MB in total, unused uploads expire
  after 60 min. Content-Length is checked against all of these before the body is touched, and at most 10 MB + 1 bytes
  are ever copied out of Zotero's buffer (a lying Content-Length still gets 413). Zotero itself still buffers the whole
  body before our handler runs (no way around that from a plugin). Status codes: 413 too large, 415 not PNG/JPEG,
  429 + `Retry-After` when the store is full (reason phrase 429 added to `plugin.ts`).
- **Single use:** an id is consumed only when the create_note/edit_note call that used it succeeds; a call that fails
  (bad citation, rollback) leaves it usable. A used/expired/unknown id fails the call ("Unknown image id").
- **Conservative choices:** image attachments are not recorded with `ownObject` (they are parts of the owned note;
  `undo` of create_note trashes the note, and trashing its images too would break them if the user restores the note;
  it also keeps them out of `trash`). Undo of an edit that added an image restores the old HTML; Zotero erases the
  then-unreferenced image itself when the note is next closed. Write results include `imageKeys` when images were added.

