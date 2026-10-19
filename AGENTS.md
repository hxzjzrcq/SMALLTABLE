# SMALLTABLE repository instructions

Read README.md and docs/ARCHITECTURE.md before making changes. For UI work also read docs/UI.md; for dependency or deployment changes read docs/DEPENDENCIES.md. Configuration lives in docs/CONFIGURATION.md; authorization, credentials and reset live in docs/SECURITY.md. Historical files under docs/history/ are for version-specific investigation, not required current contracts.

## Boundaries

- Keep room rules and wire contracts in src/shared; keep DNDROLL generation rules in the unchanged local packages/dndroll-core dependency. Do not duplicate dice algorithms, authorization or server state in React components.
- Room UI components call SmalltableClient; the isolated local DNDROLL feature calls its Core session controller, never the room socket. Other room components do not open independent WebSockets or add direct persistence/network paths.
- Passwords use the independent credential store and offline reset path; never add credentials to room schema, public messages, logs or backups. Reuse the authoritative server policy and preserve session revocation semantics.
- Private notes stay in browser storage. Never send note content in activity messages, logs, backups or diagnostics.
- Ordinary player snapshots must exclude DM private fields. Hiding text in the DOM is insufficient.
- No account system, room directory, chat, token ownership, undo or drag locks unless the user explicitly changes scope.
- Units are cells, measurement displays integers. Do not introduce feet/metres or RPG success rules.

## Changes

- Treat src/shared/model.ts as the current protocol/schema authority. If backup structure changes, bump schemaVersion and write an explicit migration or reject incompatible files.
- Update relevant tests for behavioral changes, especially permission projection, ordering, bounds and save/restore.
- Keep presentation changes in client components/styles where possible. Theme variables live at the top of styles.css.
- Use npm run format after editing source. Run npm run build for TypeScript/frontend changes. Run relevant tests; for embedded tools/mobile work use npm run test:stage; for backup/image work run test/storage-integration.test.ts; for lifecycle/lock work run test/lifecycle.test.ts and test/passwords.test.ts. Do not rerun the entire baseline or upstream suites without an affected behavior. npm test remains the full room suite and expects dist from a completed build.
- Follow the documentation ownership table in README.md. Update current rules in their owning current document and link from other documents instead of duplicating them. Keep docs/history/ files as historical records; do not append new current rules there. Distinguish implemented behavior from proposals.
- Do not commit .env, data, node_modules, generated credentials or user backups. package-lock.json should be retained.
- Do not deploy unless requested. The project currently targets one local Node process with durable filesystem storage.

- Player UI must work on phones (touch gestures, large controls, collapsible panel); DM authoring need not be phone-optimized.
- Preserve upstream source hashes; change the adapter UI rather than forking Core rules. Document necessary Core changes explicitly if the user later requests them.

Test ownership and fixtures are described in docs/TESTING.md.
