import { cronJobs } from "convex/server";

import { internal } from "./_generated/api";

const crons = cronJobs();

crons.hourly(
  "scheduled daily roundup",
  { minuteUTC: 0 },
  internal.roundupActions.runScheduledDailyRoundups,
  {},
);

export default crons;
