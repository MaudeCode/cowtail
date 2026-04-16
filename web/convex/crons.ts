import { cronJobs } from "convex/server";

import { internal } from "./_generated/api";

const crons = cronJobs();

crons.hourly(
  "scheduled daily digest",
  { minuteUTC: 0 },
  internal.digestActions.runScheduledDailyDigests,
  {},
);

export default crons;
