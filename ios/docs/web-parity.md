# Web Parity Gaps

Snapshot date: 2026-04-13

This is the current list of features that exist in the web app (`web/`) but do not yet exist in the iOS app.

This is based on the current web routes and dashboard behavior in:
- `../../web/src/App.tsx`
- `../../web/src/pages/Dashboard.tsx`
- `../../web/src/pages/Fixes.tsx`
- `../../web/src/pages/Digest.tsx`
- `../../web/src/hooks/useDashboard.ts`
- `../../web/src/hooks/useClusterHealth.ts`

## Easy

- Outcome filter bar
  The web dashboard has `Total`, `Fixed`, `Self-Resolved`, `Noise`, and `Escalated` summary tiles that also act as filters. iOS currently has summary metrics, but no outcome filter state.

- Date range presets
  The web supports `24h`, `7d`, `30d`, and `custom`. iOS currently loads the last 7 days only.

- Automatic cluster-health refresh
  The web refreshes cluster health on an interval. iOS currently refreshes when the user pulls to refresh.

- Richer cluster health presentation
  The web shows per-node CPU and memory bars and a denser health panel. iOS currently uses a simplified cluster card.

- Simple web handoff for digest and fixes
  The web has dedicated `/digest` and `/fixes` routes. iOS currently has no native digest or fixes screen and no obvious shortcut to those pages.

## Medium

- Native fixes screen
  The web has a full fixes page with scope filters (`all`, `reactive`, `weekly`, `monthly`), linked alert counts, timestamps, and optional commit display. iOS only shows fixes inside an alert detail page.

- Native digest screen
  The web has a digest page for a selected date range with grouped outcomes and summary counts. iOS does not have a native digest view.

- Group repeated alerts by alert name
  The web groups repeated alerts by `alertName`, shows counts like `x3`, and lets the user expand a group. iOS currently shows flat lists.

- Sort controls for alerts
  The web can sort alert groups by time, alert, severity, and outcome. iOS does not expose sorting.

- Inline detail expansion in the inbox
  The web can expand alert details and related fixes inline inside the dashboard. iOS always navigates to a separate detail screen.

- Date range state that can be reopened or shared
  The web stores `from` and `to` in URL params. iOS currently has no equivalent range state or shareable range entry point.

## Needs Backend Or Clarification

- Config-driven Ceph dashboard handoff
  The web can expose an external Ceph dashboard link from runtime config. iOS does not have that configuration source yet.

- More live query behavior
  The web uses Convex query patterns for a more live dashboard feel. iOS currently uses one-shot HTTP fetches and local store state.

## Already Covered On iOS

These are no longer parity gaps even though they were earlier in planning:

- Alert detail screen
- Push notification registration
- Open alert detail from a push notification
- Universal links for alert URLs
- Web handoff from alert detail
- Settings screen and theme system
