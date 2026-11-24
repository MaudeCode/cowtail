import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { useLocation } from "react-router-dom";

import { AppRoutes } from "./App";
import { stubApi } from "./test/api";
import {
  hermesStatus,
  inbox,
  item,
  NOW,
  preferences,
  SESSION,
  signedIn,
  stats,
} from "./test/fixtures";
import { renderWithProviders } from "./test/render";

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
  rootCause: "OOMKilled at 256Mi",
  summary: "Pod crash looped",
  fixes: [{ description: "Raise the limit", rootCause: "OOMKilled", commit: "7be01d4e" }],
};

describe("each area's sections, in its figure's order", () => {
  test.each([
    ["/", ["Needs you", "Hermes is on it", "Cluster", "Hermes", "Handled · 24h"]],
    [
      "/cluster",
      ["Alert pipeline", "Nodes", "Ceph", "Firing by namespace", "Volume · 7 days", "Noisiest"],
    ],
    ["/history", ["Outcomes", "Time to resolve", "Noise rate"]],
    ["/hermes", ["Cron", "Cron incidents", "Recent approvals and answers", "Status"]],
    ["/items/item-9", ["Timeline", "Details", "Fix", "Past occurrences"]],
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

  test("Snooze posts a time in the future", async () => {
    const { calls } = stubApi({
      ...routes(),
      "POST /actions/api/me/items/alert-1/actions": { ok: true, item: alert },
    });
    renderApp("/");

    await userEvent.click(await screen.findByRole("button", { name: "Snooze" }));
    await userEvent.click(screen.getByRole("button", { name: "1h" }));

    await waitFor(() => expect(calls.filter((call) => call.method === "POST")).toHaveLength(1));
    const { type, until } = calls.find((call) => call.method === "POST")!.body as {
      type: string;
      until: number;
    };
    expect([type, until > Date.now()]).toEqual(["snooze", true]);
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

  function renderDetail() {
    stubApi(
      signedIn({
        "GET /actions/api/items/item-9": {
          ok: true,
          item: fixed,
          events: [hermesUpdate],
          fixes: [],
          priorOccurrences: [priorOccurrence],
        },
      }),
    );
    renderApp("/items/item-9");
  }

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

  test("/hermes says when Hermes has never sent a heartbeat", async () => {
    stubApi(signedIn({ "GET /actions/api/hermes/status": { ...hermesStatus, status: null } }));

    renderApp("/hermes");

    expect(await screen.findByText("Hermes has not sent a heartbeat yet.")).toBeInTheDocument();
  });
});
