# Cowtail iOS Plan

## Goal
Bring Cowtail to iPhone as a native shell around the existing site and backend, with room for richer alert handling later.

## Current repo scope
- native alert inbox and detail flows
- Apple sign-in session handling
- push registration and notification routing
- universal links and settings UI
- XcodeGen project definition
- planning docs for future parity work

## Product direction
### V1
- native app shell
- alert inbox and detail views
- open alerts from push notifications
- acknowledgement and snooze flows
- open or hand off to the existing Cowtail web experience when useful

### V2
- structured commands back to Maude
- examples: reinvestigate, check cluster health, silence family, refresh status
- action-first design, not freeform chat first

### V3
- Siri / App Intents entry points
- Action Button launch flow
- voice-to-Maude interaction
- richer notification actions and incident workflows

## Design notes
- keep the first native version focused and operational
- treat the existing Cowtail service as the source of truth
- prefer concise, scannable screens over dense dashboards
- build around reliable actions before fancy conversational UI

## TestFlight note
TestFlight builds expire after 90 days. If this becomes daily-driver infrastructure, add a build refresh automation so the app never quietly ages out.
