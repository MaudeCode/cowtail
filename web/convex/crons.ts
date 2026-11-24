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

export default crons;
