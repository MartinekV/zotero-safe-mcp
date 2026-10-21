# 10: Image upload endpoint and images in notes

**What to build:** `POST /safe-mcp/image` (bearer auth; PNG or JPEG validated by magic bytes, max 10 MB) returning an `imageId`; uploads held in memory (with a total cap) and discarded on shutdown; `![caption](image:<imageId>)` in `create_note`/`edit_note` stores the image as an embedded image attachment of the note. Each imageId is single-use.

**Blocked by:** 04, 05

**Status:** ready-for-agent

- [ ] Unit tests: content validation (magic bytes, size limit, wrong type), id lookup, cap enforcement
