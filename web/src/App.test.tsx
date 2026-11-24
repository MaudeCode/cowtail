import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";
import { useLocation } from "react-router-dom";

import { AppRoutes } from "./App";
import { stubApi } from "./test/api";
import { inbox, item, NOW, preferences, SESSION, signedIn, stats } from "./test/fixtures";
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

describe("each area's sections, in its figure's order", () => {
  test.each([
    ["/", ["Needs you", "Hermes is on it", "Cluster", "Handled · 24h"]],
    [
      "/cluster",
      ["Alert pipeline", "Nodes", "Ceph", "Firing by namespace", "Volume · 7 days", "Noisiest"],
    ],
    ["/history", ["Outcomes", "Time to resolve", "Noise rate"]],
    ["/items/item-9", ["Timeline", "Details", "Fix"]],
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
