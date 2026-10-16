# Maintenance and quality pass — 2026-10-16

This branch addresses concrete defects and introduces opt-in GitHub auto-updates.
A source review and green CI **do not prove that every bug has been found**.
The deployed administrator UI at a private/customer endpoint was not accessed
or modified. Production smoke tests remain necessary.

## Confirmed and addressed in this branch

| Area | Defect / gap | Change | Validation |
|---|---|---|---|
| Repository links | Installer, CLI and UI pointed to old GitHub owner | Default to `ParsaZali/VeloRay` | Existing installer mocked-network tests updated |
| Unsafe update entrypoint | Manual `update` executed branch HEAD installer without exact-build CI approval | Query pinned commit, require matching green CI, verify downloaded installer Git blob | `scripts/test-auto-update.sh` |
| No unattended updates | No scheduled update check, source commit tracking or automated recovery | Restricted root systemd timer, daily GitHub check, pre-update backup, application rollback and health check | Bash syntax, CLI check, installer tests |
| Update UX | No UI visibility into installed commit or timer state | Superuser-only read-only status API and system Settings card | Go tests, React build + browser regressions |
| CLI locale | `VELORAY_LANGUAGE` was overwritten with `en` in several paths | Preserve configured language on environment reload | Bash syntax / installer tests |
| Keyboard navigation | Portaled dropdown moved focus before becoming visible and captured Tab unpredictably | Schedule focus when visible and close gracefully on Tab | Browser regression suite |
| RTL nav rendering | Navigation groups used translated strings as React keys | Keep group identity stable across language changes | React build |
| Mobile dialogs | Viewport height and padding could crop or crowd forms | Use dynamic viewport height and tighter mobile modal spacing | Browser responsive smoke review required |
| Focus feedback | Menu items lacked the shared visible focus ring selector | Apply :focus-visible to menu items | Browser keyboard review required |
| Subscription template | Copying links required selecting text; a visible status line caused 320px viewport overflow | Localized copy button, screen-reader feedback and smaller mobile layout | Go portal test + Playwright |
| Development proxy | Vite `/sub` proxy prefix incorrectly captured `/subscription-portal.js` | Restrict proxy to actual subscription URL path | Playwright portal test |
| Failed updater rollback | Installer could record a new commit before final health failure, leaving stale installed-version metadata | Restore prior commit marker with binaries and environment | Bash check and staging rollback test needed |
| CI approval specificity | Generic successful workflow run could authorize a non-push candidate | Require completed successful `main` push for the exact SHA | Mocked CI authorization tests |
| Updater cleanup | Function-scope cleanup trap could remain installed after returning | Run the update check in a subshell with `EXIT` cleanup | Bash tests |
| Interface localization | New maintenance card had no Persian translations | Translate all update-status labels and instructions | Frontend build |


## Auto-update threat model and operational contract

- Fixed upstream: `ParsaZali/VeloRay`, branch: `main`.
- Only the exact commit verified to have a successful workflow `ci.yml` run
  on `main` may be installed.
- The installer is downloaded from GitHub at an immutable commit SHA and
  verified against its git-blob digest before being executed.
- The updater creates a restricted backup of database and configuration before
  making changes. That backup may contain sensitive material and must remain
  restricted to trusted administrators.
- On failed installation or failed post-install checks, it attempts to restore
  previous binaries, service units, environment and current-release symlink.
- **PostgreSQL data is never automatically rolled back**, because automated
  restores could overwrite legitimate traffic updates made since the backup.
  An unsuccessful migration therefore requires deliberate operator review.
- An update will not start when GitHub is unreachable, its CI status is
  missing/failed, or there is no usable previous release to recover to.
- The feature is disabled by default. The admin must explicitly enable the
  systemd timer once with `sudo veloray auto-update enable`. Neither UI nor
  public API can run root commands.
- Protect the upstream `main` branch and require review; CI success alone
  cannot defend against an intentionally malicious trusted committer.

## Remaining verification and future audits

- [ ] Staged upgrade from the exact prior publicly deployed release and
      PostgreSQL snapshot, including failure injection after service switch.
- [ ] Test live HTTPS API responses and the real authenticated Settings UI
      (desktop, phone, Persian RTL, English LTR, dark and light).
- [ ] Network tests for GitHub API throttling, outage, stale workflow runs,
      corrupted content response, and branch races.
- [ ] Extend UI unit/Playwright coverage for dropdown Tab/Escape and stacked
      dialogs; validate screen reader labels.
- [ ] Re-test client accounting/quotas and subscription feeds across
      Xray and sing-box against disposable nodes.
- [ ] Verify backup/restore behavior on real cloud instances; tune retention
      and storage monitoring.
- [ ] Run fuzz tests of config parsers, importers, validators and API inputs.
- [ ] Resolve any remaining Playwright intermittency independently of this PR.
- [ ] Ensure audit coverage across security, access control, tenant isolation,
      DB migrations and all side-effecting API routes.
- [ ] Conduct dependency provenance and license checks before adding parity
      features from other panels.
