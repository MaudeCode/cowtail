import {
  itemUrgencies,
  type NotificationPreferences,
  type QuietHours,
} from "@maudecode/cowtail-protocol";
import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";

import { Badge, IconButton, KeyValue, QueryError, Section, Switch } from "../components/ui";
import { urgencyTone } from "../lib/itemPresentation";
import { providersQuery, sessionQuery, usePreferencesUpdate, useSignOut } from "../lib/queries";

const field =
  "h-[26px] rounded-lg border border-gray-200 bg-surface-2 px-2 text-[0.75rem] text-txt";

const DEFAULT_QUIET_HOURS = { start: "22:00", end: "07:00" };

function QuietHoursFields({
  hours,
  save,
}: {
  hours: QuietHours;
  save: (hours: QuietHours) => void;
}) {
  const [timeZone, setTimeZone] = useState(hours.timeZone);
  return (
    <KeyValue label="From · to · time zone">
      <input
        type="time"
        aria-label="Quiet hours start"
        value={hours.start}
        onChange={(event) => event.target.value && save({ ...hours, start: event.target.value })}
        className={`${field} font-mono`}
      />
      <input
        type="time"
        aria-label="Quiet hours end"
        value={hours.end}
        onChange={(event) => event.target.value && save({ ...hours, end: event.target.value })}
        className={`${field} font-mono`}
      />
      <input
        aria-label="Time zone"
        list="time-zones"
        value={timeZone}
        onChange={(event) => setTimeZone(event.target.value)}
        onBlur={() => timeZone !== hours.timeZone && save({ ...hours, timeZone })}
        className={`${field} w-36`}
      />
      <datalist id="time-zones">
        {Intl.supportedValuesOf("timeZone").map((zone) => (
          <option key={zone} value={zone}>
            {zone}
          </option>
        ))}
      </datalist>
    </KeyValue>
  );
}

// The server's order, then any key the owner just added and the server has not listed yet.
function shownOrder(overrides: NotificationPreferences["urgencyOverrides"], order: string[]) {
  const listed = order.filter((name) => name in overrides);
  const added = Object.keys(overrides).filter((name) => !order.includes(name));
  return [...listed, ...added].map((name) => [name, overrides[name]] as const);
}

function Overrides({
  overrides,
  order,
  save,
}: {
  overrides: NotificationPreferences["urgencyOverrides"];
  order: string[];
  save: (overrides: NotificationPreferences["urgencyOverrides"]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [key, setKey] = useState("");
  const [urgency, setUrgency] = useState<(typeof itemUrgencies)[number]>("whenever");
  const add = (event: FormEvent) => {
    event.preventDefault();
    if (!key.trim()) return;
    save({ ...overrides, [key.trim()]: urgency });
    setKey("");
    setAdding(false);
  };
  const remove = (name: string) => {
    const { [name]: _removed, ...rest } = overrides;
    save(rest);
  };

  return (
    <Section
      label="Urgency overrides"
      detail={
        <IconButton
          icon="plus"
          label="Add override"
          small
          aria-expanded={adding}
          onClick={() => setAdding(!adding)}
        />
      }
    >
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">Source or source:kind</th>
            <th scope="col">Urgency</th>
            <th scope="col" className="w-[26px]">
              <span className="sr-only">Remove</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {shownOrder(overrides, order).map(([name, value]) => (
            <tr key={name}>
              <td className="font-mono">{name}</td>
              <td>
                <Badge tone={urgencyTone[value]}>{value}</Badge>
              </td>
              <td>
                <IconButton
                  icon="x"
                  label={`Remove override ${name}`}
                  small
                  onClick={() => remove(name)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {adding && (
        <form onSubmit={add} className="flex items-center gap-1.5 py-2">
          <input
            aria-label="Source or source:kind"
            value={key}
            onChange={(event) => setKey(event.target.value)}
            className={`${field} min-w-0 flex-1 font-mono`}
          />
          <select
            aria-label="Urgency"
            value={urgency}
            onChange={(event) => setUrgency(event.target.value as typeof urgency)}
            className={field}
          >
            {itemUrgencies.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <IconButton type="submit" icon="check" label="Save override" disabled={!key.trim()} />
        </form>
      )}
    </Section>
  );
}

export default function Settings() {
  const { data: session } = useQuery(sessionQuery);
  const update = usePreferencesUpdate();
  const signOut = useSignOut();
  const providers = useQuery(providersQuery);
  if (!session) return null;
  const { preferences } = session;
  const hours = preferences.quietHours;

  return (
    <div className="grid gap-x-[30px] min-[960px]:grid-cols-2">
      <div>
        <Section label="Notifications">
          <KeyValue
            label={
              <>
                Quiet hours
                <div className="text-[0.7rem] text-gray-600">
                  Holds back <span className="text-warn">today</span> pushes.{" "}
                  <span className="text-accent-text">now</span> always pushes.
                </div>
              </>
            }
          >
            <Switch
              label="Quiet hours"
              checked={hours !== null}
              onChange={(on) =>
                update.mutate({
                  quietHours: on
                    ? {
                        ...DEFAULT_QUIET_HOURS,
                        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                      }
                    : null,
                })
              }
            />
          </KeyValue>
          {hours && (
            <QuietHoursFields
              key={hours.timeZone}
              hours={hours}
              save={(quietHours) => update.mutate({ quietHours })}
            />
          )}
          <KeyValue
            label={
              <>
                Require Face ID for approvals
                <div className="text-[0.7rem] text-gray-600">Applies on iOS.</div>
              </>
            }
          >
            <Switch
              label="Require Face ID for approvals"
              checked={preferences.requireAuthForApprovals}
              onChange={(requireAuthForApprovals) => update.mutate({ requireAuthForApprovals })}
            />
          </KeyValue>
          <KeyValue label="Daily roundup">
            <Switch
              label="Daily roundup"
              checked={preferences.dailyRoundupEnabled}
              onChange={(dailyRoundupEnabled) => update.mutate({ dailyRoundupEnabled })}
            />
          </KeyValue>
          {update.error && <QueryError error={update.error} />}
        </Section>
        <Section label="Account">
          <KeyValue label={`Signed in with ${providers.data?.oidc?.name ?? "Pocket ID"}`}>
            <IconButton
              icon="out"
              label="Sign out"
              disabled={signOut.isPending}
              onClick={() => signOut.mutate()}
            />
          </KeyValue>
          {signOut.error && <QueryError error={signOut.error} />}
        </Section>
      </div>
      <div>
        <Overrides
          overrides={preferences.urgencyOverrides}
          order={session.urgencyOverrideOrder}
          save={(urgencyOverrides) => update.mutate({ urgencyOverrides })}
        />
      </div>
    </div>
  );
}
