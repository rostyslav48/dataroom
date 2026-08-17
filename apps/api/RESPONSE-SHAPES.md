# Response shapes the contract does not name

`packages/contracts` defines request bodies and the response schemas it names explicitly
(`NodeDetailResponse`, `ListChildrenResponse`, `InitUploadResponse`, …). For several endpoints it
defines the *request* and leaves the response implied. Both tracks have to agree on those, and an
agreement that lives only in a message thread is invisible at review and gone next session — so it
is written down here, next to the code that produces it, and asserted by the contract tests in
`test/contract/`.

Nothing below is a new schema: every shape is an existing export of `@dataroom/contracts`.

| Endpoint | Status | Body |
|---|---|---|
| `POST /data-rooms` | 201 | `DataRoomDto` |
| `GET /data-rooms/:id` | 200 | `DataRoomDto` |
| `PATCH /data-rooms/:id` | 200 | `DataRoomDto` |
| `DELETE /data-rooms/:id` | 204 | *(empty)* |
| `GET /nodes/:id/stats` | 200 | `NodeStatsDto` |
| `GET /nodes/:id/delete-preview` | 200 | `DeletePreviewDto` |
| `POST /folders` | 201 | `NodeDto` |
| `PATCH /nodes/:id` | 200 | `NodeDto` |
| `POST /nodes/:id/move` | 200 | `NodeDto` |
| `DELETE /nodes/:id` | 204 | *(empty)* |
| `GET /nodes/:id/content` | 302 | `Location:` a 60-second signed URL, `inline` |
| `GET /nodes/:id/download` | 302 | `Location:` a 60-second signed URL, `attachment` |
| `POST /uploads/init` | 201 | `InitUploadResponse` |
| `POST /uploads/:versionId/complete` | 200 | `CompleteUploadResponse` |
| `POST /uploads/:versionId/retry` | 200 | `RetryUploadResponse` |
| `POST /uploads/:versionId/abort` | 204 | *(empty)* |
| `GET /nodes/:id/shares` | 200 | `ListSharesResponse` |
| `POST /nodes/:id/shares` | 201 | `ShareDto` |
| `GET /data-rooms/:id/shares` | 200 | `ListSharesResponse` |
| `POST /shares/:id/recipients` | 200 | `ShareDto` |
| `DELETE /shares/:id/recipients/:recipientId` | 204 | *(empty)* |
| `DELETE /shares/:id` | 204 | *(empty)* |
| `GET /shared/:token` | 200 | `ResolveShareResponse` |
| `POST /auth/refresh` | 200 | `SessionDto` |
| `POST /auth/logout` | 204 | *(empty)* |
| `GET /me` | 200 | `UserDto` |
| `GET /health` | 200 | `{ status, version, db }` — outside `API_BASE`'s contract surface, for the platform |

Every non-2xx response, without exception, is the `ApiError` envelope.

## Two behaviours worth stating in prose, because a schema cannot

- **`GET /data-rooms` `sharedWithMe[].rootNodeId` is the caller's share root, not the room's root
  node.** A recipient cannot read the room root, so pointing the sidebar there would produce a link
  that 403s on click. `fileCount` and `sizeBytes` are that node's rollups for the same reason: the
  room's totals would disclose the size of content outside the grant. If a caller holds several
  shares in one room, the room appears once, entered at the shallowest of them.

- **`GET /nodes/:id` `breadcrumbs` are truncated at `shareRootId`** and never extend above it. The
  frontend renders what it receives and must not attempt to reconstruct a fuller path.
