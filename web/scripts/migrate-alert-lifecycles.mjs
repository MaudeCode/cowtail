import { spawnSync } from "node:child_process";

const convexCommand = process.env.COWTAIL_CONVEX_COMMAND ?? "bunx";

function runConvex(functionName, args) {
  const result = spawnSync(convexCommand, ["convex", "run", functionName, JSON.stringify(args)], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
  return JSON.parse(result.stdout.trim());
}

const groups = runConvex("alerts:listLifecycleDuplicateGroups", {});
for (const group of groups) {
  const args = { fingerprint: group.fingerprint };
  if (group.startsAt !== undefined) args.startsAt = group.startsAt;
  runConvex("alerts:mergeLifecycleDuplicateGroup", args);
}

console.log(`Merged ${groups.length} duplicate Alertmanager lifecycle group(s).`);
