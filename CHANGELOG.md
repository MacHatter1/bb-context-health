# Changelog

All notable changes to Context Health are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## Unreleased

### Added

- A README logo using the plugin's own icon and mint-to-teal gradient.
- Release history and repository file conventions.
- An `npm run typecheck` alias for the existing `npm run check` command.

### Changed

- Organise the README around features, installation, coverage and settings.
- Align the store listing and package description with the README.
- Add MacHatter1 to the MIT copyright notice, retaining the contributors' notice.

## 0.1.1 - 2026-09-29

### Fixed

- Request thread events in pages of 100 to respect BB's event-list limit,
  while retaining coverage of up to 1,000 relevant events per refresh.

## 0.1.0 - 2026-09-09

### Added

- A thread panel with an overall context usage meter and recorded-text estimates.
- Category filters, text search, sorting and expandable entry previews.
- Separate views for observed skill reads and the available skill inventory.
- Optional Codex session-log inspection on the thread's environment host.
- Coverage notices and automatic refresh every 30 seconds while visible.
- Fictional-data screenshots and source tests.
