import type { IncidentGetResponse, ItemInboxResponse } from "@maudecode/cowtail-protocol";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { useLocation } from "react-router-dom";

import { AppRoutes } from "./App";
import { stubApi } from "./test/api";
import {
  hermesStatus,
  inbox,
  incidentDetail,
  incidentSummary,
  item,
  MAINTENANCE,
  maintenanceWindow,
  NOW,
  preferences,
  recentRuns,
  SESSION,
  signedIn,
  stats,
} from "./test/fixtures";
import { renderWithProviders } from "./test/render";
import { formatClock, formatWhen } from "./lib/format";

function Address() {
  const location = useLocation();
  return <output data-testid="address">{location.pathname + location.search}</output>;
}

function renderApp(route: string) {
  return renderWithProviders(
    <>
      <AppRoutes />
      <Address />
    </>,
    { route },
  );
}

const sectionLabels = () =>
  screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.firstChild?.textContent);

const sessionReads = (calls: { method: string; path: string }[]) =>
  calls.filter((call) => `${call.method} ${call.path}` === SESSION).length;

const signedOut = { [SESSION]: { status: 401, body: { ok: false, error: "Unauthorized" } } };

describe("signed out", () => {
  test("every address shows only the login page, whose button starts the Pocket ID sign-in", async () => {
    stubApi({
      ...signedOut,
      "GET /actions/api/auth/providers": { apple: true, oidc: { name: "Pocket ID" } },
    });

    renderApp("/history?source=alertmanager");

    const signIn = await screen.findByRole("link", { name: "Sign in with Pocket ID" });
    expect(signIn).toHaveAttribute("href", "/actions/api/auth/oidc/start?client=web");
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });

  test("without an OIDC provider the login page names the variables that turn it on", async () => {
    stubApi({ ...signedOut, "GET /actions/api/auth/providers": { apple: true } });

    renderApp("/");

    expect(await screen.findByText(/Web sign-in is not configured/)).toBeInTheDocument();
    expect(screen.getByText(/OIDC_ISSUER_URL/).textContent?.split("\n")).toEqual([
      "OIDC_ISSUER_URL",
      "OIDC_CLIENT_ID",
      "OIDC_CLIENT_SECRET",
      "COWTAIL_OWNER_OIDC_SUBJECT",
    ]);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});

const fixed = item({
  id: "item-9",
  state: "resolved",
  needsOwner: false,
  outcome: "fixed",
  resolvedAt: NOW - 60_000,
  resolvedAfterMs: 19 * 60_000,
  createdDate: "2026-11-23",
  fix: {
    id: "fix-1",
    timestamp: NOW,
    alertIds: ["alert-1"],
    description: "Raised the memory limit",
    rootCause: "OOMKilled",
    scope: "reactive",
    commit: "a41c9e2d",
  },
});

const priorOccurrence = {
  alertId: "alert-0",
  firedAt: Date.UTC(2026, 10, 12, 12),
  resolvedAt: Date.UTC(2026, 10, 12, 13),
  outcome: "fixed" as const,
  rootCause: "OOMKilled",
  summary: "Pod crash looped",
  cause: "OOMKilled at 256Mi",
  fixCommit: "7be01d4e",
  fixes: [{ description: "Raise the limit", rootCause: "OOMKilled", commit: "7be01d4e" }],
};

const HOUR = 60 * 60_000;

// The alert item's metric: one series crossing its threshold while it fired.
const graph = {
  ok: true,
  available: true,
  range: "6h",
  query: "container_memory_working_set_bytes",
  from: NOW - 6 * HOUR,
  to: NOW,
  threshold: { op: ">", value: 536870912 },
  firing: { startsAt: NOW - HOUR, endsAt: NOW - 20 * 60_000 },
  series: [
    {
      labels: { pod: "transcoder-7d9f" },
      points: [
        { at: NOW - 6 * HOUR, value: 300_000_000 },
        { at: NOW - HOUR, value: 640_000_000 },
        { at: NOW, value: 400_000_000 },
      ],
    },
  ],
};

describe("each area's sections, in its figure's order", () => {
  test.each([
    ["/", ["Needs you", "Hermes is on it", "Upcoming", "Cluster", "Hermes", "Handled · 24h"]],
    [
      "/cluster",
      ["Alert pipeline", "Nodes", "Ceph", "Firing by namespace", "Volume · 7 days", "Noisiest"],
    ],
    ["/history", ["Outcomes", "Time to resolve", "Noise rate"]],
    [
      "/hermes",
      [
        "Cron",
        "Cron incidents",
        "Recent approvals and answers",
        "Run · Disk usage",
        "Status",
        "Runbook · services",
        "Runbook · diagnostics",
      ],
    ],
    [
      "/items/item-9",
      ["Timeline", "container_memory_working_set_bytes", "Details", "Fix", "Past occurrences"],
    ],
    ["/settings", ["Notifications", "Account", "Urgency overrides"]],
  ])("%s", async (route, labels) => {
    stubApi(
      signedIn({
        "GET /actions/api/items/inbox": inbox({ handled: [fixed] }),
        "GET /actions/api/items/stats": stats,
        "GET /actions/api/items?limit=100": { ok: true, count: 1, items: [fixed], days: [] },
        "GET /actions/api/items/item-9": {
          ok: true,
          item: fixed,
          events: [],
          fixes: fixed.fix ? [fixed.fix] : [],
          priorOccurrences: [priorOccurrence],
        },
        "GET /actions/api/items/item-9/graph?range=6h": graph,
      }),
    );

    renderApp(route);

    await waitFor(() => expect(sectionLabels()).toEqual(labels));
  });
});

test.each(["/", "/cluster"])(
  "%s shows the alert pipeline's state and its last Watchdog",
  async (route) => {
    stubApi(
      signedIn({ "GET /actions/api/items/inbox": inbox(), "GET /actions/api/items/stats": stats }),
    );

    renderApp(route);

    expect(await screen.findByText("pipeline ok")).toBeInTheDocument();
    expect(screen.getByText(/2m ago/)).toBeInTheDocument();
  },
);

describe("acting from Home", () => {
  const approval = item({
    id: "approval-1",
    kind: "approval",
    title: "Restart ingress in edge?",
    body: "kubectl rollout restart deploy/ingress -n edge",
    actions: [{ type: "approve" }, { type: "deny" }],
    availableActions: [{ type: "approve" }, { type: "deny" }],
  });
  const question = item({
    id: "question-1",
    kind: "question",
    title: "Rebalance now or wait?",
    availableActions: [{ type: "choose", options: ["Rebalance now", "Wait"] }, { type: "reply" }],
  });
  const alert = item({
    id: "alert-1",
    occurrenceCount: 6,
    availableActions: [{ type: "ack" }, { type: "snooze" }],
  });
  const routes = () =>
    signedIn({ "GET /actions/api/items/inbox": inbox({ needsYou: [approval, question, alert] }) });

  test("every action is an icon button with a name and a tooltip; only a choice's options are words", async () => {
    stubApi(routes());

    renderApp("/");

    const needsYou = (await screen.findByText("Restart ingress in edge?")).closest("section")!;
    const buttons = within(needsYou).getAllByRole("button");
    expect(buttons.map((button) => [button.getAttribute("aria-label"), button.title])).toEqual([
      ["Approve", "Approve"],
      ["Deny", "Deny"],
      [null, ""],
      [null, ""],
      ["Reply", "Reply"],
      ["Acknowledge", "Acknowledge"],
      ["Snooze", "Snooze"],
    ]);
    expect(
      buttons.filter((button) => button.textContent).map((button) => button.textContent),
    ).toEqual(["Rebalance now", "Wait"]);
  });

  test.each([
    ["approval-1", "Approve", [], { type: "approve" }],
    ["approval-1", "Deny", [], { type: "deny" }],
    ["question-1", "Wait", [], { type: "choose", option: "Wait" }],
    [
      "question-1",
      "Reply",
      ["Reply:Rebalance on Friday", "Send reply"],
      { type: "reply", text: "Rebalance on Friday" },
    ],
    ["alert-1", "Acknowledge", [], { type: "ack" }],
  ])("%s: %s posts the owner's action", async (id, name, follow, body) => {
    const { calls } = stubApi({
      ...routes(),
      [`POST /actions/api/me/items/${id}/actions`]: { ok: true, item: item({ id }) },
    });
    renderApp("/");

    await userEvent.click(await screen.findByRole("button", { name }));
    for (const step of follow) {
      const [label, text] = step.split(":");
      if (text) await userEvent.type(screen.getByRole("textbox", { name: label }), text);
      else await userEvent.click(screen.getByRole("button", { name: label }));
    }

    await waitFor(() =>
      expect(calls.filter((call) => call.method === "POST")).toEqual([
        { method: "POST", path: `/actions/api/me/items/${id}/actions`, body },
      ]),
    );
  });

  test("a script action is its label beside a play glyph, and runs the script for the item once confirmed", async () => {
    const failure = item({
      id: "failure-1",
      source: "cowtail",
      kind: "failure",
      title: "Gateway is not answering",
      availableActions: [
        {
          type: "run",
          scriptId: "gateway-restart",
          label: "Restart Hermes gateway",
          confirmText: "Restart the Hermes gateway?",
          needsAuth: false,
        },
      ],
    });
    const { calls } = stubApi(
      signedIn({
        "GET /actions/api/items/inbox": inbox({ needsYou: [failure] }),
        "POST /actions/api/me/runbook/runs": {
          ok: true,
          run: { ...recentRuns[0], itemId: "failure-1" },
        },
      }),
    );
    renderApp("/");

    const button = await screen.findByRole("button", { name: "Restart Hermes gateway" });
    expect(button.querySelector("svg")).not.toBeNull();
    await userEvent.click(button);
    await userEvent.click(
      within(screen.getByRole("dialog", { name: "Run Restart Hermes gateway" })).getByRole(
        "button",
        { name: "Run" },
      ),
    );

    await waitFor(() =>
      expect(calls.filter((call) => call.method === "POST")).toEqual([
        {
          method: "POST",
          path: "/actions/api/me/runbook/runs",
          body: {
            requestId: expect.any(String),
            scriptId: "gateway-restart",
            itemId: "failure-1",
            confirmed: true,
          },
        },
      ]),
    );
  });

  test("an approval that needs Face ID is left to the iOS app", async () => {
    stubApi(
      signedIn({
        "GET /actions/api/items/inbox": inbox({
          needsYou: [{ ...approval, approvalNeedsAuth: true }],
        }),
      }),
    );

    renderApp("/");

    const approve = await screen.findByRole("button", {
      name: "Approve in the iOS app, with Face ID",
    });
    const deny = screen.getByRole("button", { name: "Deny in the iOS app, with Face ID" });
    expect([approve, deny].map((button) => button.hasAttribute("disabled"))).toEqual([true, true]);
  });

  const timeZone = encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const SNOOZE_OPTIONS = `GET /actions/api/me/snooze-options?timeZone=${timeZone}`;
  const tomorrow = new Date(2030, 0, 2, 9, 0).getTime();
  const options = {
    ok: true,
    options: [
      { preset: "1h", until: new Date(2030, 0, 1, 10, 41).getTime() },
      { preset: "4h", until: new Date(2030, 0, 1, 13, 41).getTime() },
      { preset: "tomorrow", until: tomorrow },
      { preset: "next_monday", until: new Date(2030, 0, 7, 9, 0).getTime() },
    ],
  };

  test("Snooze opens the server's four presets, each with its time, then a custom time", async () => {
    stubApi({ ...routes(), [SNOOZE_OPTIONS]: options });
    renderApp("/");

    await userEvent.click(await screen.findByRole("button", { name: "Snooze" }));

    const picker = screen.getByRole("dialog", { name: "Snooze until" });
    await within(picker).findByText("Next Monday");
    expect(
      within(picker)
        .getAllByRole("button")
        .map((button) => [...button.children].map((part) => part.textContent)),
    ).toEqual([
      ["1 hour", "01 Jan 10:41"],
      ["4 hours", "01 Jan 13:41"],
      ["Tomorrow", "02 Jan 09:00"],
      ["Next Monday", "07 Jan 09:00"],
      [""],
    ]);
    expect(within(picker).getByLabelText("Custom")).toHaveAttribute("type", "datetime-local");
  });

  test("a preset posts the time the server gave it", async () => {
    const { calls } = stubApi({
      ...routes(),
      [SNOOZE_OPTIONS]: options,
      "POST /actions/api/me/items/alert-1/actions": { ok: true, item: alert },
    });
    renderApp("/");

    await userEvent.click(await screen.findByRole("button", { name: "Snooze" }));
    await userEvent.click(await screen.findByRole("button", { name: /^Tomorrow/ }));

    await waitFor(() =>
      expect(calls.filter((call) => call.method === "POST")).toEqual([
        {
          method: "POST",
          path: "/actions/api/me/items/alert-1/actions",
          body: { type: "snooze", until: tomorrow },
        },
      ]),
    );
  });

  test("a custom snooze posts the local time the owner entered", async () => {
    const { calls } = stubApi({
      ...routes(),
      [SNOOZE_OPTIONS]: options,
      "POST /actions/api/me/items/alert-1/actions": { ok: true, item: alert },
    });
    renderApp("/");

    await userEvent.click(await screen.findByRole("button", { name: "Snooze" }));
    await userEvent.type(screen.getByLabelText("Custom"), "2030-01-02T09:00");
    await userEvent.click(screen.getByRole("button", { name: "Snooze until this time" }));

    await waitFor(() =>
      expect(calls.filter((call) => call.method === "POST")).toEqual([
        {
          method: "POST",
          path: "/actions/api/me/items/alert-1/actions",
          body: { type: "snooze", until: new Date(2030, 0, 2, 9, 0).getTime() },
        },
      ]),
    );
  });

  test("a snooze moves the item into Upcoming before the server answers", async () => {
    stubApi({
      ...routes(),
      [SNOOZE_OPTIONS]: options,
      "POST /actions/api/me/items/alert-1/actions": new Promise(() => {}),
    });
    renderApp("/");

    await userEvent.click(await screen.findByRole("button", { name: "Snooze" }));
    await userEvent.click(await screen.findByRole("button", { name: /^Tomorrow/ }));

    const upcoming = screen.getByRole("heading", { name: /Upcoming/ }).closest("section")!;
    expect(within(upcoming).getByText("KubePodCrashLooping")).toBeInTheDocument();
    expect(within(upcoming).getByText("02 Jan 09:00")).toBeInTheDocument();
  });
});

describe("overlapping snoozes", () => {
  const first = item({
    id: "first-1",
    title: "First alert",
    availableActions: [{ type: "snooze" }],
  });
  const second = item({
    id: "second-1",
    title: "Second alert",
    availableActions: [{ type: "snooze" }],
  });
  const timeZone = encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const section = (label: RegExp) =>
    screen.getByRole("heading", { name: label }).closest("section")!;
  const snooze = async (title: string) => {
    const row = (await screen.findByText(title)).closest<HTMLElement>("div.flex")!;
    await userEvent.click(within(row).getByRole("button", { name: "Snooze" }));
    await userEvent.click(await screen.findByRole("button", { name: /^Tomorrow/ }));
  };

  test("a refusal puts back only its own item, and a write still in flight keeps its place", async () => {
    let refuseFirst!: (reply: unknown) => void;
    stubApi({
      ...signedIn({ "GET /actions/api/items/inbox": inbox({ needsYou: [first, second] }) }),
      [`GET /actions/api/me/snooze-options?timeZone=${timeZone}`]: {
        ok: true,
        options: [
          { preset: "1h", until: new Date(2030, 0, 1, 10, 41).getTime() },
          { preset: "4h", until: new Date(2030, 0, 1, 13, 41).getTime() },
          { preset: "tomorrow", until: new Date(2030, 0, 2, 9, 0).getTime() },
          { preset: "next_monday", until: new Date(2030, 0, 7, 9, 0).getTime() },
        ],
      },
      "POST /actions/api/me/items/first-1/actions": new Promise((resolve) => {
        refuseFirst = resolve;
      }),
      "POST /actions/api/me/items/second-1/actions": new Promise(() => {}),
    });
    renderApp("/");

    await snooze("First alert");
    await snooze("Second alert");
    refuseFirst({ status: 409, body: { ok: false, error: "Item is closed" } });

    expect(await within(section(/Needs you/)).findByRole("alert")).toHaveTextContent(
      "Item is closed",
    );
    expect(within(section(/Needs you/)).getByText("First alert")).toBeInTheDocument();
    expect(within(section(/Upcoming/)).getByText("Second alert")).toBeInTheDocument();
  });
});

describe("Upcoming on Home", () => {
  const snoozed = item({
    id: "snoozed-1",
    state: "snoozed",
    needsOwner: false,
    needsOwnerWhenOpen: true,
    title: "CephOSDNearFull",
    availableActions: [{ type: "ack" }],
    snoozedUntil: new Date(2030, 0, 2, 9, 0).getTime(),
  });
  const routes = () => signedIn({ "GET /actions/api/items/inbox": inbox({ upcoming: [snoozed] }) });
  const section = (label: RegExp) =>
    screen.getByRole("heading", { name: label }).closest("section")!;

  test("lists each snoozed item's return time, and Unsnooze posts unsnooze", async () => {
    const { calls } = stubApi({
      ...routes(),
      "POST /actions/api/me/items/snoozed-1/actions": { ok: true, item: snoozed },
    });
    renderApp("/");

    const upcoming = (await screen.findByText("CephOSDNearFull")).closest("section")!;
    expect(within(upcoming).getByText("02 Jan 09:00")).toBeInTheDocument();
    await userEvent.click(within(upcoming).getByRole("button", { name: "Unsnooze" }));

    await waitFor(() =>
      expect(calls.filter((call) => call.method === "POST")).toEqual([
        {
          method: "POST",
          path: "/actions/api/me/items/snoozed-1/actions",
          body: { type: "unsnooze" },
        },
      ]),
    );
  });

  test("Unsnooze moves the item to the section the server said it returns to, before it answers", async () => {
    stubApi({ ...routes(), "POST /actions/api/me/items/snoozed-1/actions": new Promise(() => {}) });
    renderApp("/");

    await userEvent.click(await screen.findByRole("button", { name: "Unsnooze" }));

    expect(within(section(/Needs you/)).getByText("CephOSDNearFull")).toBeInTheDocument();
    expect(within(section(/Upcoming/)).queryByText("CephOSDNearFull")).not.toBeInTheDocument();
  });

  test("an inbox reread while the unsnooze is on its way keeps the item where it moved", async () => {
    stubApi({ ...routes(), "POST /actions/api/me/items/snoozed-1/actions": new Promise(() => {}) });
    const { queryClient } = renderApp("/");

    await userEvent.click(await screen.findByRole("button", { name: "Unsnooze" }));
    await queryClient.refetchQueries({ queryKey: ["inbox"] });

    // The reread inbox is what the page renders next.
    const shown = queryClient.getQueryData<ItemInboxResponse>(["inbox"])!;
    expect([shown.needsYou, shown.upcoming].map((list) => list?.map((entry) => entry.id))).toEqual([
      ["snoozed-1"],
      [],
    ]);
  });

  test("a second action on an item waits for the first one's reply before it is sent", async () => {
    let answerUnsnooze!: (reply: unknown) => void;
    const { calls } = stubApi({
      ...routes(),
      "POST /actions/api/me/items/snoozed-1/actions": new Promise((resolve) => {
        answerUnsnooze = resolve;
      }),
    });
    renderApp("/");
    const posts = () => calls.filter((call) => call.method === "POST").map((call) => call.body);

    await userEvent.click(await screen.findByRole("button", { name: "Unsnooze" }));
    await userEvent.click(
      within(section(/Needs you/)).getByRole("button", { name: "Acknowledge" }),
    );

    expect(posts()).toEqual([{ type: "unsnooze" }]);
    answerUnsnooze({ ok: true, item: { ...snoozed, state: "open", snoozedUntil: undefined } });
    await waitFor(() => expect(posts()).toEqual([{ type: "unsnooze" }, { type: "ack" }]));
  });

  test("a refused unsnooze puts the item back in Upcoming and says why", async () => {
    stubApi({
      ...routes(),
      "POST /actions/api/me/items/snoozed-1/actions": {
        status: 409,
        body: { ok: false, error: "Item is not snoozed" },
      },
    });
    renderApp("/");

    await userEvent.click(await screen.findByRole("button", { name: "Unsnooze" }));

    const upcoming = section(/Upcoming/);
    expect(await within(upcoming).findByRole("alert")).toHaveTextContent("Item is not snoozed");
    expect(within(upcoming).getByText("CephOSDNearFull")).toBeInTheDocument();
  });
});

describe("maintenance windows", () => {
  const running = maintenanceWindow();
  const routes = (windows = [running]) =>
    signedIn({
      "GET /actions/api/items/inbox": inbox(),
      [MAINTENANCE]: { ok: true, active: windows, recent: [], sourceChoices: ["cron", "hermes"] },
    });
  const banner = async () =>
    (await screen.findByText("Cluster upgrade")).closest("div.rounded-lg") as HTMLElement;

  test("a running window's banner sits above Needs you with what it silences and the time left", async () => {
    stubApi(routes());
    renderApp("/");

    const shown = await banner();
    expect(shown).toHaveTextContent("All alerts silenced · 42m left");
    expect(
      shown.compareDocumentPosition(screen.getByRole("heading", { name: /Needs you/ })) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("a window Alertmanager did not silence says so in its banner", async () => {
    stubApi(routes([{ ...running, silenceIds: [], silenceError: "Alertmanager answered 503" }]));
    renderApp("/");

    expect(within(await banner()).getByRole("alert")).toHaveTextContent(
      "Alertmanager did not silence these alerts: Alertmanager answered 503",
    );
  });

  test("End window hides the banner before the server answers", async () => {
    const { calls } = stubApi({
      ...routes(),
      "POST /actions/api/me/maintenance-windows/window-1/end": new Promise(() => {}),
    });
    renderApp("/");

    await userEvent.click(within(await banner()).getByRole("button", { name: "End window" }));

    expect(screen.queryByText("Cluster upgrade")).not.toBeInTheDocument();
    expect(calls.filter((call) => call.method === "POST").map((call) => call.path)).toEqual([
      "/actions/api/me/maintenance-windows/window-1/end",
    ]);
  });

  test("a refused End window brings the banner back and says why", async () => {
    stubApi({
      ...routes(),
      "POST /actions/api/me/maintenance-windows/window-1/end": {
        status: 404,
        body: { ok: false, error: "Maintenance window not found" },
      },
    });
    renderApp("/");

    await userEvent.click(within(await banner()).getByRole("button", { name: "End window" }));

    expect(await screen.findByText("Maintenance window not found")).toBeInTheDocument();
    expect(screen.getByText("Cluster upgrade")).toBeInTheDocument();
  });

  test("the wrench's dialog starts a window named by its length with the chosen scope", async () => {
    const started = maintenanceWindow({
      id: "window-2",
      title: "Disk swap",
      matchers: [{ label: "namespace", value: "media" }],
      sources: ["hermes"],
      allAlerts: false,
      heldSources: ["hermes"],
      endsAt: NOW + 120 * 60_000,
    });
    // The list serves the started window once the POST has made it.
    let active: (typeof started)[] = [];
    const { calls } = stubApi({
      ...routes([]),
      get [MAINTENANCE]() {
        return { ok: true, active, recent: [], sourceChoices: ["cron", "hermes"] };
      },
      get "POST /actions/api/me/maintenance-windows"() {
        active = [started];
        return { ok: true, window: started };
      },
    });
    renderApp("/");

    await userEvent.click(
      await screen.findByRole("button", { name: "Start a maintenance window" }),
    );
    const dialog = screen.getByRole("dialog", { name: "Maintenance window" });
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Title" }), "Disk swap");
    await userEvent.click(within(dialog).getByRole("radio", { name: "2h" }));
    await userEvent.click(within(dialog).getByRole("checkbox", { name: "A namespace" }));
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Namespace" }), "media");
    await userEvent.click(await within(dialog).findByRole("button", { name: "hermes" }));
    expect(within(dialog).getByText("Cowtail's own watchdog items still push.")).toBeVisible();
    await userEvent.click(within(dialog).getByRole("button", { name: "Start 2h window" }));

    expect(await screen.findByText("Disk swap")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Maintenance window" })).not.toBeInTheDocument();
    expect(calls.filter((call) => call.method === "POST").map((call) => call.body)).toEqual([
      {
        title: "Disk swap",
        durationMs: 2 * 60 * 60_000,
        matchers: [{ label: "namespace", value: "media" }],
        sources: ["hermes"],
        requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      },
    ]);
  });

  test("a History row recorded during a window carries a wrench", async () => {
    const held = item({ id: "held-1", title: "Held alert", maintenanceWindowId: "window-1" });
    const plain = item({ id: "plain-1", title: "Plain alert" });
    stubApi(
      signedIn({
        "GET /actions/api/items/stats": stats,
        "GET /actions/api/items?limit=100": {
          ok: true,
          count: 2,
          items: [held, plain],
          days: [],
        },
      }),
    );
    renderApp("/history");

    const row = (title: string) => screen.getByText(title).closest("tr")!;
    await screen.findByText("Held alert");
    expect(
      [row("Held alert"), row("Plain alert")].map(
        (tr) => within(tr).queryAllByText("Recorded during a maintenance window").length,
      ),
    ).toEqual([1, 0]);
  });
});

describe("History's filter", () => {
  const historyRoutes = (query: string) =>
    signedIn({
      "GET /actions/api/items/sources": { ok: true, sources: ["alertmanager", "hermes"] },
      [`GET /actions/api/items/stats${query ? `?${query}` : ""}`]: stats,
      [`GET /actions/api/items?${query ? `${query}&` : ""}limit=100`]: {
        ok: true,
        count: 1,
        items: [fixed],
        days: [{ date: "2026-11-23", count: 1 }],
      },
    });
  const address = () => screen.getByTestId("address").textContent;

  test("choosing a source adds its chip and its parameter, and removing the chip removes both", async () => {
    const { calls } = stubApi({ ...historyRoutes(""), ...historyRoutes("source=alertmanager") });
    renderApp("/history");

    await userEvent.click(await screen.findByRole("button", { name: "Filter" }));
    await userEvent.selectOptions(
      await screen.findByRole("combobox", { name: "Source" }),
      "alertmanager",
    );

    expect(await screen.findByText("source: alertmanager")).toBeInTheDocument();
    expect(address()).toBe("/history?source=alertmanager");
    await waitFor(() =>
      expect(calls.map((call) => call.path)).toContain(
        "/actions/api/items?source=alertmanager&limit=100",
      ),
    );

    await userEvent.click(screen.getByRole("button", { name: "Remove source filter" }));

    expect(screen.queryByText("source: alertmanager")).not.toBeInTheDocument();
    expect(address()).toBe("/history");
  });

  test("an address with filters restores their chips and lists what they match", async () => {
    const query = "source=alertmanager&outcome=fixed&from=2026-11-16";
    const from = new Date("2026-11-16T00:00:00").getTime();
    const serverQuery = `source=alertmanager&outcome=fixed&from=${from}`;
    const { calls } = stubApi(historyRoutes(serverQuery));

    renderApp(`/history?${query}`);

    expect(await screen.findByText("source: alertmanager")).toBeInTheDocument();
    expect(screen.getByText("outcome: fixed")).toBeInTheDocument();
    expect(screen.getByText("from 16 Nov")).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "KubePodCrashLooping" })).toBeInTheDocument();
    expect(calls.map((call) => call.path)).toContain(`/actions/api/items?${serverQuery}&limit=100`);
  });
});

test("Sign out posts the logout and returns to the login page", async () => {
  // The server forgets the session once it answers the logout.
  let signedOutYet = false;
  const { calls } = stubApi({
    ...signedIn(),
    get [SESSION]() {
      return signedOutYet ? signedOut[SESSION] : { ok: true, preferences };
    },
    get "POST /actions/api/auth/logout"() {
      signedOutYet = true;
      return { ok: true };
    },
  });
  renderApp("/settings");

  await userEvent.click(await screen.findByRole("button", { name: "Sign out" }));

  expect(await screen.findByRole("link", { name: "Sign in with Pocket ID" })).toBeInTheDocument();
  expect(calls.filter((call) => call.method === "POST").map((call) => call.path)).toEqual([
    "/actions/api/auth/logout",
  ]);
});

test("a refused setting shows at once, then rolls back and says why", async () => {
  stubApi(
    signedIn({
      "PUT /actions/api/me/notification-preferences": {
        status: 400,
        body: { ok: false, error: "Preferences are read-only" },
      },
    }),
  );
  renderApp("/settings");
  const roundup = await screen.findByRole("switch", { name: "Daily roundup" });

  await userEvent.click(roundup);

  expect(await screen.findByText("Preferences are read-only")).toBeInTheDocument();
  expect(roundup).toHaveAttribute("aria-checked", String(preferences.dailyRoundupEnabled));
});

test("a setting whose write may have landed keeps what the server holds", async () => {
  // The server commits the write, then the reply is lost to a gateway error.
  let committed = false;
  stubApi({
    ...signedIn(),
    get [SESSION]() {
      return {
        ok: true,
        preferences: { ...preferences, dailyRoundupEnabled: !committed },
      };
    },
    get "PUT /actions/api/me/notification-preferences"() {
      committed = true;
      return { status: 502, body: { ok: false, error: "Bad gateway" } };
    },
  });
  renderApp("/settings");
  const roundup = await screen.findByRole("switch", { name: "Daily roundup" });

  await userEvent.click(roundup);

  await waitFor(() => expect(roundup).toHaveAttribute("aria-checked", "false"));
  expect(await screen.findByText("Bad gateway")).toBeInTheDocument();
});

test("two refused settings in flight together both return to the server's value", async () => {
  const refusals: ((reply: unknown) => void)[] = [];
  const { calls } = stubApi({
    ...signedIn(),
    get "PUT /actions/api/me/notification-preferences"() {
      return new Promise((resolve) => refusals.push(resolve));
    },
  });
  renderApp("/settings");
  const roundup = await screen.findByRole("switch", { name: "Daily roundup" });
  const faceId = screen.getByRole("switch", { name: "Require Face ID for approvals" });

  await userEvent.click(roundup);
  await userEvent.click(faceId);
  await waitFor(() => expect(calls.filter((call) => call.method === "PUT")).toHaveLength(2));
  const reads = sessionReads(calls);
  for (const refuse of refusals) refuse({ status: 400, body: { ok: false, error: "Refused" } });

  await waitFor(() => expect(sessionReads(calls)).toBeGreaterThan(reads));
  await waitFor(() =>
    expect([roundup, faceId].map((control) => control.getAttribute("aria-checked"))).toEqual([
      String(preferences.dailyRoundupEnabled),
      String(preferences.requireAuthForApprovals),
    ]),
  );
});

test("two saved settings whose replies arrive out of order show what the server stored", async () => {
  // The server stores each write as it arrives; the replies come back newest first.
  const replies: (() => void)[] = [];
  let writes = 0;
  const stored = () => ({
    ...preferences,
    dailyRoundupEnabled: writes < 1,
    requireAuthForApprovals: writes < 2,
  });
  const { calls } = stubApi({
    ...signedIn(),
    get [SESSION]() {
      return { ok: true, preferences: stored() };
    },
    get "PUT /actions/api/me/notification-preferences"() {
      writes += 1;
      const atWrite = stored();
      return new Promise((resolve) => {
        replies.push(() => resolve({ ok: true, preferences: atWrite }));
      });
    },
  });
  renderApp("/settings");
  const roundup = await screen.findByRole("switch", { name: "Daily roundup" });
  const faceId = screen.getByRole("switch", { name: "Require Face ID for approvals" });

  await userEvent.click(roundup);
  await userEvent.click(faceId);
  await waitFor(() => expect(calls.filter((call) => call.method === "PUT")).toHaveLength(2));
  const reads = sessionReads(calls);
  for (const reply of [...replies].reverse()) reply();

  // The end state is what the page shows once it has reread the server.
  await waitFor(() => expect(sessionReads(calls)).toBeGreaterThan(reads));
  await waitFor(() =>
    expect([roundup, faceId].map((control) => control.getAttribute("aria-checked"))).toEqual([
      "false",
      "false",
    ]),
  );
});

test("urgency overrides list in the server's order", async () => {
  stubApi(
    signedIn({
      [SESSION]: {
        ok: true,
        preferences: { ...preferences, urgencyOverrides: { "2": "now", "10": "whenever" } },
        urgencyOverrideOrder: ["10", "2"],
      },
    }),
  );

  renderApp("/settings");

  const table = (await screen.findByRole("columnheader", { name: "Urgency" })).closest("table")!;
  await waitFor(() =>
    expect(
      within(table)
        .getAllByRole("row")
        .slice(1)
        .map((row) => row.firstChild?.textContent),
    ).toEqual(["10", "2"]),
  );
});

test("Cluster stacks and lists volume sources in the server's order", async () => {
  stubApi(
    signedIn({
      "GET /actions/api/items/stats": { ...stats, volumeSources: ["hermes", "alertmanager"] },
    }),
  );

  renderApp("/cluster");

  await waitFor(() => {
    const volume = screen.getByRole("heading", { name: /Volume/ }).closest("section")!;
    expect(
      within(volume)
        .getAllByText(/^(hermes|alertmanager)$/)
        .map((legend) => legend.textContent),
    ).toEqual(["hermes", "alertmanager"]);
  });
});

describe("item detail", () => {
  const hermesUpdate = {
    id: "event-1",
    itemId: "item-9",
    at: NOW - 5 * 60_000,
    type: "hermes_update" as const,
    actor: "hermes",
    payload: { text: "Raised the memory limit to 1Gi." },
    evidence: [
      {
        step: "Read the last termination state",
        command: "kubectl -n media describe pod transcoder-7d9f",
        output: "Reason: OOMKilled",
      },
      { step: "Raise the limit in GitOps and wait for rollout" },
    ],
  };

  function renderDetail(graphRoutes: Record<string, unknown> = {}) {
    const api = stubApi(
      signedIn({
        "GET /actions/api/items/item-9": {
          ok: true,
          item: fixed,
          events: [hermesUpdate],
          fixes: [],
          priorOccurrences: [priorOccurrence],
        },
        ...graphRoutes,
      }),
    );
    renderApp("/items/item-9");
    return api;
  }

  test("the metric graph draws the alert's threshold and firing interval", async () => {
    renderDetail({ "GET /actions/api/items/item-9/graph?range=6h": graph });

    const chart = await screen.findByRole("img", { name: /^container_memory_working_set_bytes/ });
    const firing = `firing ${formatClock(graph.firing.startsAt)}–${formatClock(graph.firing.endsAt)}`;
    expect(chart).toHaveAccessibleName(
      `container_memory_working_set_bytes over 6h, > 537M, ${firing}`,
    );
    expect([...chart.querySelectorAll("text")].map((text) => text.textContent)).toEqual([
      "> 537M",
      formatWhen(graph.from, graph.to),
      firing,
      formatClock(graph.to),
    ]);
    expect([...chart.querySelectorAll("polyline, line, rect")].map((mark) => mark.tagName)).toEqual(
      ["rect", "line", "polyline"],
    );
  });

  test("choosing a range asks the server for that range's graph", async () => {
    const { calls } = renderDetail({
      "GET /actions/api/items/item-9/graph?range=6h": graph,
      "GET /actions/api/items/item-9/graph?range=24h": { ...graph, range: "24h" },
    });

    await userEvent.click(await screen.findByRole("radio", { name: "24h" }));

    expect(await screen.findByRole("img", { name: /over 24h/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "24h" })).toBeChecked();
    expect(calls.map((call) => call.path)).toContain("/actions/api/items/item-9/graph?range=24h");
  });

  test("the metric graph is hidden when the server has none", async () => {
    renderDetail({
      "GET /actions/api/items/item-9/graph?range=6h": {
        ok: true,
        available: false,
        range: "6h",
        reason: "The alert has no generator URL",
      },
    });

    await screen.findByRole("heading", { name: "Past occurrences" });
    expect(sectionLabels()).toEqual(["Timeline", "Details", "Past occurrences"]);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  test("Hermes's evidence is a collapsed disclosure of numbered steps, each command with its output", async () => {
    renderDetail();

    const disclosure = (await screen.findByText("Evidence · 2 steps")).closest("details")!;
    expect(disclosure).not.toHaveAttribute("open");
    await userEvent.click(within(disclosure).getByText("Evidence · 2 steps"));

    expect(disclosure).toHaveAttribute("open");
    expect(within(disclosure).getByText("1 · Read the last termination state")).toBeVisible();
    expect(
      within(disclosure).getByText("2 · Raise the limit in GitOps and wait for rollout"),
    ).toBeVisible();
    expect(disclosure.querySelectorAll("pre")).toHaveLength(1);
    expect(disclosure.querySelector("pre")?.textContent).toBe(
      "$ kubectl -n media describe pod transcoder-7d9f\nReason: OOMKilled",
    );
  });

  test("each past occurrence shows its date, outcome, root cause and fix commit", async () => {
    renderDetail();

    const section = (await screen.findByRole("heading", { name: "Past occurrences" })).closest(
      "section",
    )!;
    expect(
      within(section)
        .getAllByRole("cell")
        .map((cell) => cell.textContent),
    ).toEqual(["12 Nov", "fixed", "OOMKilled at 256Mi", "7be01d4"]);
  });
});

test("an alert's old address opens its item", async () => {
  stubApi(
    signedIn({
      "GET /actions/api/items?alertId=alert-1&limit=1": { ok: true, count: 1, items: [fixed] },
      "GET /actions/api/items/item-9": { ok: true, item: fixed, events: [] },
    }),
  );

  renderApp("/alerts/alert-1");

  await waitFor(() => expect(screen.getByTestId("address").textContent).toBe("/items/item-9"));
  expect(
    await screen.findByRole("heading", { level: 1, name: "KubePodCrashLooping" }),
  ).toBeInTheDocument();
});

describe("Hermes", () => {
  test("the top bar links Hermes between History and Settings, with its dot in the server's level", async () => {
    stubApi(signedIn({ "GET /actions/api/items/inbox": inbox() }));

    renderApp("/");

    const nav = await screen.findByRole("navigation");
    expect(
      within(nav)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Home", "Cluster", "History", "Hermes", "Settings"]);
    const chip = screen.getByText("hermes").parentElement!;
    await waitFor(() => expect(chip.querySelector("i")).toHaveClass("bg-warn"));
  });

  test("Home's Hermes block shows the heartbeat with the model, then the failing cron count", async () => {
    // Ages read the clock: hold it at the fixtures' time, and leave timers real.
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    stubApi(signedIn({ "GET /actions/api/items/inbox": inbox() }));

    renderApp("/");

    expect(await screen.findByText("Heartbeat 38s ago")).toBeInTheDocument();
    expect(screen.getAllByText("opus-5.5 · anthropic")).toHaveLength(1);
    expect(screen.getByText("1 failing ·")).toBeInTheDocument();
    expect(screen.getByText("2 jobs")).toBeInTheDocument();
  });

  test("/hermes lists cron jobs in the server's order and links each incident to its item", async () => {
    stubApi(signedIn());

    renderApp("/hermes");

    const incident = await screen.findByRole("link", { name: "Nightly backup verify failed" });
    expect(incident).toHaveAttribute("href", "/items/item-7");
    const jobs = within(screen.getAllByRole("table")[0]).getAllByRole("row").slice(1);
    expect(jobs.map((row) => row.firstChild?.textContent)).toEqual([
      "backup-verify",
      "roundup-digest",
    ]);
  });

  test("/hermes words each recent answer: approved, the chosen option, denied", async () => {
    stubApi(signedIn());

    renderApp("/hermes");

    const table = (await screen.findByRole("link", { name: "Restart ingress in edge?" })).closest(
      "table",
    )!;
    const answers = within(table)
      .getAllByRole("row")
      .slice(1)
      .map((row) => row.children[1].textContent);
    expect(answers).toEqual(["approved", "Wait", "denied"]);
  });

  test("/hermes lists each runbook script with a Run button, red and noted when it asks to confirm, waiting while it runs", async () => {
    stubApi(signedIn());

    renderApp("/hermes");

    const restart = await screen.findByRole("button", { name: "Run Restart Hermes gateway" });
    expect(restart.closest("div.border-b")).toHaveTextContent(
      "Restart Hermes gatewayAsks to confirm",
    );
    expect(restart).toHaveClass("text-accent-text");
    const runner = screen.getByRole("button", { name: "Run Restart script runner" });
    expect(runner.closest("div.border-b")).not.toHaveTextContent("Asks to confirm");
    expect(runner).not.toHaveClass("text-accent-text");
    expect(screen.getByRole("button", { name: "Run Disk usage" })).toBeDisabled();
  });

  test("/hermes shows a script's prompt before it runs, then follows the new run's output", async () => {
    const started = {
      ...recentRuns[0],
      id: "run-4",
      scriptId: "gateway-restart",
      scriptName: "Restart Hermes gateway",
      status: "queued" as const,
      startedAt: undefined,
    };
    const { calls } = stubApi(
      signedIn({
        "POST /actions/api/me/runbook/runs": { ok: true, run: started },
        "GET /actions/api/me/runbook/runs/run-4": {
          ok: true,
          run: { ...started, status: "running", startedAt: NOW },
          output: "Stopping gateway…\n",
        },
      }),
    );
    renderApp("/hermes");

    await userEvent.click(
      await screen.findByRole("button", { name: "Run Restart Hermes gateway" }),
    );
    const prompt = screen.getByRole("dialog", { name: "Run Restart Hermes gateway" });
    expect(prompt).toHaveTextContent("Restart the Hermes gateway?");
    expect(calls.some((call) => call.method === "POST")).toBe(false);
    await userEvent.click(within(prompt).getByRole("button", { name: "Run" }));

    expect(await screen.findByText("Stopping gateway…")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /^Run · Restart Hermes gateway/ }),
    ).toBeInTheDocument();
    expect(calls.filter((call) => call.method === "POST").map((call) => call.body)).toEqual([
      { requestId: expect.any(String), scriptId: "gateway-restart", confirmed: true },
    ]);
  });

  test("/hermes shows the newest run's output and ends each recent run in its exit code and time", async () => {
    stubApi(signedIn());

    renderApp("/hermes");

    const output = await screen.findByLabelText("Run output");
    await waitFor(() => expect(output).toHaveTextContent("/dev/nvme0n1p2 916G 604G 266G 70% /"));
    const rows = ["Disk usage", "Restart script runner", "Tail gateway log"].map(
      (name) => screen.getByRole("button", { name }).closest("div.border-b")!.textContent,
    );
    expect(rows[0]).toMatch(/^Disk usagerunning · 0:0\d·/);
    expect(rows[1]).toMatch(/^Restart script runnerexit 0·\d\d:\d\d$/);
    expect(rows[2]).toMatch(/^Tail gateway logexit 1·\d\d:\d\d$/);
  });

  test("/hermes sends a run whose reply was lost again under the same request, so it queues once", async () => {
    let attempts = 0;
    const { calls } = stubApi({
      ...signedIn(),
      get "POST /actions/api/me/runbook/runs"() {
        attempts += 1;
        return attempts === 1
          ? Promise.reject(new TypeError("Failed to fetch"))
          : { ok: true, run: { ...recentRuns[1], id: "run-4" } };
      },
    });
    renderApp("/hermes");

    const run = await screen.findByRole("button", { name: "Run Restart script runner" });
    await userEvent.click(run);
    await waitFor(() => expect(run).toBeEnabled());
    await userEvent.click(run);

    await waitFor(() => expect(attempts).toBe(2));
    const [first, again] = calls
      .filter((call) => call.method === "POST")
      .map((call) => (call.body as { requestId: string }).requestId);
    expect(first).toEqual(expect.any(String));
    expect(again).toBe(first);
  });

  test("/hermes leaves a script that needs Face ID to the iOS app", async () => {
    const [services, ...rest] = hermesStatus.status!.runbook!;
    const guarded = {
      ...services,
      scripts: [{ ...services.scripts[0], needsAuth: true }, ...services.scripts.slice(1)],
    };
    stubApi(
      signedIn({
        "GET /actions/api/hermes/status": {
          ...hermesStatus,
          status: { ...hermesStatus.status!, runbook: [guarded, ...rest] },
        },
      }),
    );

    renderApp("/hermes");

    expect(
      await screen.findByRole("button", {
        name: "Run Restart Hermes gateway in the iOS app, with Face ID",
      }),
    ).toBeDisabled();
  });

  test("/hermes says when Hermes has never sent a heartbeat", async () => {
    stubApi(signedIn({ "GET /actions/api/hermes/status": { ...hermesStatus, status: null } }));

    renderApp("/hermes");

    expect(await screen.findByText("Hermes has not sent a heartbeat yet.")).toBeInTheDocument();
  });
});

describe("incidents", () => {
  const INCIDENT = "GET /actions/api/incidents/incident-1";

  test("an incident in the inbox is one row with its member count, worst urgency and duration, and opens it", async () => {
    stubApi(
      signedIn({
        "GET /actions/api/items/inbox": inbox({
          needsYou: [item({ incident: incidentSummary() })],
        }),
        [INCIDENT]: incidentDetail(),
      }),
    );
    renderApp("/");

    const row = await screen.findByRole("link", { name: /Storage outage/ });
    expect(row).toHaveTextContent("Incident · 11 items · now · 47m");
    expect(screen.queryByText("KubePodCrashLooping")).not.toBeInTheDocument();
    await userEvent.click(row);
    expect(screen.getByTestId("address")).toHaveTextContent("/incidents/incident-1");
  });

  test("an item in an incident links to it from its header", async () => {
    stubApi(
      signedIn({
        "GET /actions/api/items/item-9": {
          ok: true,
          item: item({ id: "item-9", incident: incidentSummary() }),
          events: [],
        },
      }),
    );
    renderApp("/items/item-9");

    const chip = await screen.findByRole("link", { name: "Storage outage" });
    expect(chip).toHaveAttribute("href", "/incidents/incident-1");
  });

  test("incident detail shows the header, the merged timeline, the postmortem and the members", async () => {
    stubApi(signedIn({ [INCIDENT]: incidentDetail() }));
    renderApp("/incidents/incident-1");

    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Storage outage");
    expect(sectionLabels()).toEqual(["Timeline", "Postmortem", "Members"]);
    expect(screen.getByText("item_added · CephHealthErr")).toBeInTheDocument();
    expect(screen.getByText("Same Alertmanager group")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 4, name: "Summary" })).toBeInTheDocument();
    expect(screen.getByText("47 minutes").tagName).toBe("STRONG");
    expect(screen.getByText("Replace the drive cable").tagName).toBe("LI");
    expect(screen.getAllByRole("button", { name: "Remove from incident" })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Add an item" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Request postmortem again" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Resolve" })).not.toBeInTheDocument();
  });

  test("an open incident offers Resolve and waits for its postmortem", async () => {
    stubApi(
      signedIn({
        [INCIDENT]: incidentDetail({
          state: "open",
          resolvedAt: undefined,
          postmortemState: "none",
          postmortem: undefined,
          postmortemAt: undefined,
          availableActions: ["resolve"],
        }),
      }),
    );
    renderApp("/incidents/incident-1");

    expect(await screen.findByRole("button", { name: "Resolve" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Request postmortem again" })).toBeDisabled();
    expect(
      screen.getByText("Hermes writes the postmortem once the incident resolves."),
    ).toBeInTheDocument();
  });

  test("Remove from incident takes the member out before the server answers", async () => {
    const { calls } = stubApi(
      signedIn({
        [INCIDENT]: incidentDetail(),
        "DELETE /actions/api/me/incidents/incident-1/items/item-2": new Promise(() => {}),
      }),
    );
    renderApp("/incidents/incident-1");

    const [first] = await screen.findAllByRole("button", { name: "Remove from incident" });
    await userEvent.click(first);

    expect(screen.queryByRole("link", { name: "CephHealthErr" })).not.toBeInTheDocument();
    // The removal shows its result, so Add an item stays usable.
    expect(screen.getByRole("button", { name: "Add an item" })).toBeEnabled();
    expect(calls.filter((call) => call.method === "DELETE").map((call) => call.path)).toEqual([
      "/actions/api/me/incidents/incident-1/items/item-2",
    ]);
  });

  test("a reread while a removal is on its way keeps the member gone", async () => {
    stubApi(
      signedIn({
        [INCIDENT]: incidentDetail(),
        "DELETE /actions/api/me/incidents/incident-1/items/item-2": new Promise(() => {}),
      }),
    );
    const { queryClient } = renderApp("/incidents/incident-1");

    const [first] = await screen.findAllByRole("button", { name: "Remove from incident" });
    await userEvent.click(first);
    await queryClient.refetchQueries({ queryKey: ["incident", "incident-1"], exact: true });

    const shown = queryClient.getQueryData<IncidentGetResponse>(["incident", "incident-1"])!;
    expect(shown.members.map((member) => member.id)).toEqual(["item-1"]);
  });

  test("a removal whose reply is lost stays shown until a read says what the server kept", async () => {
    const routes: Record<string, unknown> = signedIn({
      [INCIDENT]: incidentDetail(),
      "DELETE /actions/api/me/incidents/incident-1/items/item-2": {
        status: 502,
        body: { ok: false, error: "Bad gateway" },
      },
    });
    stubApi(routes);
    const { queryClient } = renderApp("/incidents/incident-1");
    const [first] = await screen.findAllByRole("button", { name: "Remove from incident" });
    routes[INCIDENT] = { status: 503, body: { ok: false, error: "Unavailable" } };

    await userEvent.click(first);
    await screen.findByText("Bad gateway");
    expect(screen.queryByRole("link", { name: "CephHealthErr" })).not.toBeInTheDocument();

    routes[INCIDENT] = incidentDetail();
    await queryClient.refetchQueries({ queryKey: ["incident", "incident-1"], exact: true });
    expect(await screen.findByRole("link", { name: "CephHealthErr" })).toBeInTheDocument();
  });

  test("a later refusal keeps a removal whose reply was lost until a read settles it", async () => {
    const routes: Record<string, unknown> = signedIn({
      [INCIDENT]: incidentDetail(),
      "DELETE /actions/api/me/incidents/incident-1/items/item-2": {
        status: 502,
        body: { ok: false, error: "Bad gateway" },
      },
      "POST /actions/api/me/incidents/incident-1/postmortem": {
        status: 409,
        body: { ok: false, error: "A postmortem is already on its way" },
      },
    });
    stubApi(routes);
    renderApp("/incidents/incident-1");
    const [first] = await screen.findAllByRole("button", { name: "Remove from incident" });
    routes[INCIDENT] = { status: 503, body: { ok: false, error: "Unavailable" } };
    await userEvent.click(first);
    await screen.findByText("Bad gateway");

    await userEvent.click(screen.getByRole("button", { name: "Request postmortem again" }));
    await screen.findByText("A postmortem is already on its way");

    // No read has said whether the removal landed, so it stays shown.
    expect(screen.queryByRole("link", { name: "CephHealthErr" })).not.toBeInTheDocument();
  });

  test("a reread from before a removal settled neither shows nor restores the member", async () => {
    let answerRemoval!: (reply: unknown) => void;
    let answerRead!: (reply: unknown) => void;
    const routes: Record<string, unknown> = signedIn({
      "DELETE /actions/api/me/incidents/incident-1/items/item-2": new Promise((resolve) => {
        answerRemoval = resolve;
      }),
      "POST /actions/api/me/incidents/incident-1/postmortem": {
        status: 409,
        body: { ok: false, error: "A postmortem is already on its way" },
      },
    });
    // The page's first read, then a reread held until the removal settled, then reads that fail.
    const reads: unknown[] = [
      incidentDetail(),
      new Promise((resolve) => {
        answerRead = resolve;
      }),
    ];
    Object.defineProperty(routes, INCIDENT, {
      get: () => reads.shift() ?? { status: 503, body: { ok: false, error: "Unavailable" } },
    });
    stubApi(routes);
    const { queryClient } = renderApp("/incidents/incident-1");
    const [first] = await screen.findAllByRole("button", { name: "Remove from incident" });
    await userEvent.click(first);
    const reread = queryClient.refetchQueries({
      queryKey: ["incident", "incident-1"],
      exact: true,
    });
    await waitFor(() => expect(reads).toHaveLength(0));
    const removed = incidentDetail();
    removed.members = removed.members.filter((member) => member.id !== "item-2");
    answerRemoval(removed);
    await waitFor(() => expect(queryClient.isMutating()).toBe(0));
    answerRead(incidentDetail());
    await reread;
    const shown = queryClient.getQueryData<IncidentGetResponse>(["incident", "incident-1"])!;
    expect(shown.members.map((member) => member.id)).toEqual(["item-1"]);

    await userEvent.click(screen.getByRole("button", { name: "Request postmortem again" }));
    await screen.findByText("A postmortem is already on its way");

    expect(screen.queryByRole("link", { name: "CephHealthErr" })).not.toBeInTheDocument();
  });

  test("a refused removal puts the member back and says why", async () => {
    stubApi(
      signedIn({
        [INCIDENT]: incidentDetail(),
        "DELETE /actions/api/me/incidents/incident-1/items/item-2": {
          status: 404,
          body: { ok: false, error: "Item is not in this incident" },
        },
      }),
    );
    renderApp("/incidents/incident-1");

    const [first] = await screen.findAllByRole("button", { name: "Remove from incident" });
    await userEvent.click(first);

    expect(await screen.findByText("Item is not in this incident")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "CephHealthErr" })).toBeInTheDocument();
  });

  test("Add an item lists the server's candidates and adds the chosen one", async () => {
    const { calls } = stubApi(
      signedIn({
        [INCIDENT]: incidentDetail(),
        "GET /actions/api/incidents/incident-1/candidates": {
          ok: true,
          items: [item({ id: "item-7", title: "Nightly backup verify failed" })],
        },
        "POST /actions/api/me/incidents/incident-1/items": incidentDetail(),
      }),
    );
    renderApp("/incidents/incident-1");

    await userEvent.click(await screen.findByRole("button", { name: "Add an item" }));
    await userEvent.click(
      await screen.findByRole("button", { name: /Nightly backup verify failed/ }),
    );

    await waitFor(() =>
      expect(calls.filter((call) => call.method === "POST")).toEqual([
        {
          method: "POST",
          path: "/actions/api/me/incidents/incident-1/items",
          body: { itemId: "item-7" },
        },
      ]),
    );
    expect(screen.queryByRole("dialog", { name: "Add an item" })).not.toBeInTheDocument();
  });

  test("History shows an incident as one row that opens it", async () => {
    stubApi(
      signedIn({
        "GET /actions/api/items?limit=100": {
          ok: true,
          count: 1,
          items: [
            item({
              state: "resolved",
              createdDate: "2026-11-22",
              incident: incidentSummary({ state: "resolved", resolvedAt: NOW }),
            }),
          ],
          days: [{ date: "2026-11-22", count: 1 }],
        },
      }),
    );
    renderApp("/history");

    const link = await screen.findByRole("link", { name: "Storage outage" });
    expect(link).toHaveAttribute("href", "/incidents/incident-1");
    expect(link.closest("tr")).toHaveTextContent("Incident · 11 items · now · 47m");
  });
});
