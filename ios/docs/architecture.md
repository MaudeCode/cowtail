# Architecture Notes

## Current Cowtail endpoints
The native app consumes deployment-specific endpoint values from `Config/project.env` during project generation.

Runtime lookup is centralized in `CowtailApp/Sources/App/AppConfig.swift`.

## Native app shape
The iPhone app should stay thin and sit on top of the existing Cowtail backend and data model, not replace it.

## Notification path
Push delivery is always:
1. Cowtail backend sends to APNs
2. APNs delivers to the phone

This path does not care whether the phone is home, on VPN, or away.

## Data and command path
Use two transport paths for app traffic:

### Direct / private path
Use when a private endpoint is reachable:
- home LAN
- VPN / tailnet
- private cluster address

### Public / relay path
Use when private reachability fails:
- public HTTPS API
- normal remote fallback

## Routing rule
Choose the path by reachability, not by SSID.

The app should try the private endpoint first with a short timeout, then fall back to the public path. That covers home Wi-Fi and VPN without needing brittle Wi-Fi-name logic.

## Future feature hooks
Planned, but not fully built out here:
- push notifications
- ack / snooze actions
- Siri / App Intents
- Action Button launch flow
- voice-to-Maude
- structured command actions back to OpenClaw
