import { useQuery } from "@tanstack/react-query";

import ClusterHealth from "../components/dashboard/ClusterHealth";
import ItemRow from "../components/items/ItemRow";
import ItemTable from "../components/items/ItemTable";
import { Empty, QueryError, Section } from "../components/ui";
import { healthQuery, inboxQuery } from "../lib/queries";

export default function Home() {
  const inbox = useQuery(inboxQuery);
  const health = useQuery(healthQuery);
  const data = inbox.data;

  return (
    <>
      <div className="grid gap-x-[30px] min-[960px]:grid-cols-[1.65fr_1fr]">
        <div>
          <Section label="Needs you" detail={data?.counts.needsYou}>
            {inbox.error && <QueryError error={inbox.error} />}
            {data?.needsYou.map((item) => (
              <ItemRow key={item.id} item={item} variant="needsYou" />
            ))}
            {data?.needsYou.length === 0 && <Empty>Nothing needs you.</Empty>}
          </Section>
          <Section label="Hermes is on it" detail={data?.counts.withHermes}>
            {data?.withHermes.map((item) => (
              <ItemRow key={item.id} item={item} variant="withHermes" />
            ))}
            {data?.withHermes.length === 0 && <Empty>Hermes has nothing open.</Empty>}
          </Section>
        </div>
        <div>
          {health.data ? (
            <ClusterHealth health={health.data} layout="home" />
          ) : (
            <Section label="Cluster">{health.error && <QueryError error={health.error} />}</Section>
          )}
        </div>
      </div>
      <Section label="Handled · 24h" detail={data?.counts.handled}>
        {data && data.handled.length > 0 && <ItemTable items={data.handled} />}
        {data?.handled.length === 0 && <Empty>Nothing handled in the last 24 hours.</Empty>}
      </Section>
    </>
  );
}
