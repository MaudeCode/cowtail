import { Fragment } from "react";

// Hermes's postmortem: headings, paragraphs, bullet and numbered lists, and inline bold,
// italics, code and web links. Everything else shows as text; nothing is parsed as HTML.
// ponytail: a line-based subset; switch to a Markdown library if postmortems need tables.

const inline =
  /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*|_[^_\s][^_]*_|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/;

function Inline({ text }: { text: string }) {
  return (
    <>
      {text.split(inline).map((part, index) => {
        if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
          return <strong key={index}>{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
          return (
            <code key={index} className="font-mono text-[0.85em]">
              {part.slice(1, -1)}
            </code>
          );
        }
        const link = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(part);
        if (link) {
          return (
            <a
              key={index}
              href={link[2]}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              {link[1]}
            </a>
          );
        }
        if (/^(\*[^*].*\*|_[^_].*_)$/.test(part)) return <em key={index}>{part.slice(1, -1)}</em>;
        return <Fragment key={index}>{part}</Fragment>;
      })}
    </>
  );
}

type Block =
  | { kind: "heading"; text: string }
  | { kind: "paragraph"; lines: string[] }
  | { kind: "list"; ordered: boolean; items: string[] };

function blocks(source: string): Block[] {
  const result: Block[] = [];
  for (const raw of source.split("\n")) {
    const line = raw.trim();
    const last = result.at(-1);
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    const bullet = /^[-*+]\s+(.*)$/.exec(line);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(line);
    if (!line) {
      result.push({ kind: "paragraph", lines: [] });
    } else if (heading) {
      result.push({ kind: "heading", text: heading[1] });
    } else if (bullet || numbered) {
      const ordered = Boolean(numbered);
      const text = (bullet ?? numbered)![1];
      if (last?.kind === "list" && last.ordered === ordered) last.items.push(text);
      else result.push({ kind: "list", ordered, items: [text] });
    } else if (last?.kind === "paragraph") {
      last.lines.push(line);
    } else {
      result.push({ kind: "paragraph", lines: [line] });
    }
  }
  return result.filter((block) => block.kind !== "paragraph" || block.lines.length > 0);
}

export default function Markdown({ text }: { text: string }) {
  return (
    <div className="[overflow-wrap:anywhere]">
      {blocks(text).map((block, index) => {
        if (block.kind === "heading") {
          return (
            <h4 key={index} className="mt-3 mb-1 text-[0.8rem] font-semibold first:mt-1">
              <Inline text={block.text} />
            </h4>
          );
        }
        if (block.kind === "list") {
          const List = block.ordered ? "ol" : "ul";
          return (
            <List
              key={index}
              className={`my-1 pl-5 ${block.ordered ? "list-decimal" : "list-disc"}`}
            >
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>
                  <Inline text={item} />
                </li>
              ))}
            </List>
          );
        }
        return (
          <p key={index} className="my-1">
            <Inline text={block.lines.join(" ")} />
          </p>
        );
      })}
    </div>
  );
}
