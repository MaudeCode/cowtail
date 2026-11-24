import { cronJobs } from "convex/server";

import { internal } from "./_generated/api";

const crons = cronJobs();

crons.hourly(
  "scheduled daily roundup",
  { minuteUTC: 0 },
  internal.roundupActions.runScheduledDailyRoundups,
  {},
);

crons.interval(
  "retry Hermes alert-job deliveries",
  { minutes: 1 },
  (internal as any).jobDeliveryActions.retryDue,
  {},
);

crons.interval(
  "delete expired OIDC logins",
  { hours: 1 },
  internal.authSessions.deleteExpiredOidcLogins,
  {},
);

crons.interval(
  "raise an item when the Alertmanager Watchdog goes silent",
  { minutes: 1 },
  (internal as any).pipelineStatus.checkSilence,
  {},
);

crons.interval(
  "prune Hermes hook deliveries",
  { hours: 1 },
  (internal as any).hermesHooks.pruneDeliveries,
  {},
);

crons.interval(
  "expire items past their deadline",
  { minutes: 1 },
  (internal as any).items.expireDueItems,
  {},
);

crons.interval(
  "return snoozed items whose time has come",
  { minutes: 1 },
  (internal as any).items.returnSnoozedItems,
  {},
);

crons.interval(
  "watch the Hermes heartbeat",
  { minutes: 1 },
  (internal as any).hermes.checkHeartbeat,
  {},
);

crons.interval(
  "expire the silences of maintenance windows ended early",
  { minutes: 1 },
  (internal as any).maintenance.expireLeftoverSilences,
  {},
);

export default crons;
