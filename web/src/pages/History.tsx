import { itemKinds, itemOutcomes, type ItemStatsResponse } from "@maudecode/cowtail-protocol";
import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";

import ItemTable from "../components/items/ItemTable";
import { Badge, Empty, Icon, IconButton, KeyValue, QueryError, Section } from "../components/ui";
import { parseLocalDate, parseLocalDateEnd } from "../lib/dates";
import { formatDuration, formatPercent, formatShortDate } from "../lib/format";
import { outcomeColor } from "../lib/itemPresentation";
import { itemsQuery, sourcesQuery, statsQuery, type ItemFilter } from "../lib/queries";

// The filter lives in the address: ?q=&source=&kind=&outcome=&from=&to=
const FILTER_KEYS = ["q", "source", "kind", "outcome", "from", "to"] as const;
type FilterKey = (typeof FILTER_KEYS)[number];

function chipText(key: FilterKey, value: string) {
  if (key === "from" || key === "to")
    return `${key} ${formatShortDate(parseLocalDate(value).getTime())}`;
  if (key === "q") return `“${value}”`;
  return `${key}: ${value}`;
}

function Outcomes({ stats }: { stats: ItemStatsResponse }) {
  const mix = itemOutcomes.map((outcome) => [outcome, stats.outcomeMix[outcome]] as const);
  return (
    <Section label="Outcomes" detail={`${stats.resolvedCount} resolved`}>
      <div className="mt-2.5 mb-1.5 flex h-2 gap-px" aria-hidden="true">
        {mix
          .filter(([, count]) => count > 0)
          .map(([outcome, count]) => (
            <i key={outcome} style={{ flex: count, background: outcomeColor[outcome] }} />
          ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-[0.6rem] text-gray-600">
        {mix.map(([outcome, count]) => (
          <span key={outcome}>
            <i
              className="mr-1 inline-block size-[7px]"
              style={{ background: outcomeColor[outcome] }}
            />
            {outcome} {count}
          </span>
        ))}
      </div>
    </Section>
  );
}

function Picker({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1 font-mono text-[0.6rem] uppercase tracking-[0.1em] text-gray-600">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-[26px] rounded-lg border border-gray-200 bg-bg px-2 font-sans text-[0.75rem] normal-case tracking-normal text-txt"
      >
        <option value="">Any</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1 font-mono text-[0.6rem] uppercase tracking-[0.1em] text-gray-600">
      {label}
      <input
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-[26px] w-full min-w-0 rounded-lg border border-gray-200 bg-bg px-2 font-sans text-[0.75rem] text-txt"
      />
    </label>
  );
}

function FilterPopup({
  params,
  set,
}: {
  params: URLSearchParams;
  set: (key: FilterKey, value: string) => void;
}) {
  const sources = useQuery(sourcesQuery);
  const value = (key: FilterKey) => params.get(key) ?? "";
  return (
    <dialog
      open
      aria-label="Filter"
      className="absolute top-full left-0 z-10 m-0 mt-1.5 grid w-[270px] max-w-[calc(100vw-32px)] gap-2 rounded-[10px] border border-gray-200 bg-surface-2 p-3 shadow-[0_14px_34px_#000c]"
    >
      <input
        type="search"
        aria-label="Search"
        placeholder="Search"
        value={value("q")}
        onChange={(event) => set("q", event.target.value)}
        className="h-[26px] rounded-lg border border-gray-200 bg-bg px-2 text-[0.75rem]"
      />
      <Picker
        label="Source"
        value={value("source")}
        options={sources.data ?? []}
        onChange={(v) => set("source", v)}
      />
      <Picker
        label="Kind"
        value={value("kind")}
        options={itemKinds}
        onChange={(v) => set("kind", v)}
      />
      <Picker
        label="Outcome"
        value={value("outcome")}
        options={itemOutcomes}
        onChange={(v) => set("outcome", v)}
      />
      <div className="grid grid-cols-2 gap-2">
        <DateField label="From" value={value("from")} onChange={(v) => set("from", v)} />
        <DateField label="To" value={value("to")} onChange={(v) => set("to", v)} />
      </div>
    </dialog>
  );
}

export default function History() {
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState(false);

  const set = (key: FilterKey, value: string) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );

  const from = params.get("from");
  const to = params.get("to");
  const filter: ItemFilter = {
    q: params.get("q") ?? undefined,
    source: params.get("source") ?? undefined,
    kind: params.get("kind") ?? undefined,
    outcome: params.get("outcome") ?? undefined,
    from: from ? parseLocalDate(from).getTime() : undefined,
    to: to ? parseLocalDateEnd(to).getTime() : undefined,
  };
  const items = useInfiniteQuery({ ...itemsQuery(filter), placeholderData: keepPreviousData });
  const stats = useQuery({ ...statsQuery(filter), placeholderData: keepPreviousData });

  const pages = items.data?.pages ?? [];
  const rows = pages.flatMap((page) => page.items);
  const days = [
    ...new Map(pages.flatMap((page) => page.days ?? []).map((day) => [day.date, day])).values(),
  ];
  const active = FILTER_KEYS.flatMap((key) => {
    const value = params.get(key);
    return value ? [[key, value] as const] : [];
  });

  return (
    <>
      <div className="grid gap-x-[30px] min-[960px]:grid-cols-[1.2fr_1fr_.6fr]">
        {stats.data ? <Outcomes stats={stats.data} /> : <Section label="Outcomes" />}
        <Section label="Time to resolve" detail="median · p90">
          {stats.data?.timeToResolve.map((row) => (
            <KeyValue key={row.kind} label={row.kind}>
              <span className="font-mono">
                {formatDuration(row.medianMs)} · {formatDuration(row.p90Ms)}
              </span>
            </KeyValue>
          ))}
        </Section>
        <Section label="Noise rate">
          {stats.data && (
            <>
              <div className="pt-2 font-mono text-lg">{formatPercent(stats.data.noiseRate)}</div>
              <div className="text-[0.7rem] text-gray-600">
                {stats.data.outcomeMix.noise} of {stats.data.resolvedCount}
              </div>
            </>
          )}
        </Section>
      </div>
      {stats.error && <QueryError error={stats.error} />}

      <div className="relative mt-[18px] flex flex-wrap items-center gap-1.5">
        <IconButton
          icon="filter"
          label="Filter"
          tone={active.length > 0 ? "yes" : "plain"}
          aria-expanded={open}
          aria-haspopup="dialog"
          onClick={() => setOpen(!open)}
        />
        {active.map(([key, value]) => (
          <Badge key={key}>
            {chipText(key, value)}
            <button
              type="button"
              title={`Remove ${key} filter`}
              aria-label={`Remove ${key} filter`}
              onClick={() => set(key, "")}
              className="cursor-pointer"
            >
              <Icon name="x" className="size-2.5" />
            </button>
          </Badge>
        ))}
        {items.data && (
          <span className="ml-auto text-[0.7rem] text-gray-600">
            {days.reduce((total, day) => total + day.count, 0)} items
          </span>
        )}
        {open && <FilterPopup params={params} set={set} />}
      </div>

      {items.error && <QueryError error={items.error} />}
      {rows.length > 0 && <ItemTable items={rows} days={days} />}
      {items.data && rows.length === 0 && <Empty>No items match.</Empty>}
      {items.hasNextPage && (
        <div className="flex justify-center pt-3">
          <IconButton
            icon="down"
            label="Load more"
            disabled={items.isFetchingNextPage}
            onClick={() => items.fetchNextPage()}
          />
        </div>
      )}
    </>
  );
}
