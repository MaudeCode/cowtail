# Apple Setup

Portal and distribution items only.

## Required
- Apple Developer Program membership
- App Store Connect app record for `Cowtail`
- Bundle ID / App ID: set in local `Config/project.env`
- Push Notifications enabled on the App ID
- APNs auth key (`.p8`) with saved Key ID and Team ID
- TestFlight enabled for private distribution

## Likely later
- Siri capability, if Cowtail gets Siri phrases or App Intents entry points

## Only if truly needed later
- Critical Alerts entitlement, if time-sensitive notifications are not enough and Apple approval is justified

## Not Apple portal items
These are app or runtime choices, not portal setup:
- local network behavior
- home Wi-Fi vs VPN routing logic
- microphone access
- speech recognition
- background modes
