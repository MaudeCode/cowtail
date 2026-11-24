import type { SourceInfo } from "@maudecode/cowtail-protocol";

import { Icon } from "../ui";

// A source's uploaded icon, or a glyph while it has none.
export default function SourceIcon({
  source,
  large = false,
}: {
  source: SourceInfo;
  large?: boolean;
}) {
  const size = large ? "size-[30px]" : "size-[22px]";
  return (
    <span
      className={`grid shrink-0 place-items-center overflow-hidden rounded-md border border-gray-200 bg-surface-2 text-gray-600 ${size}`}
    >
      {source.iconUrl ? (
        <img src={source.iconUrl} alt="" className="size-full object-cover" />
      ) : (
        <Icon name="box" />
      )}
    </span>
  );
}
