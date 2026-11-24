import type { ReactNode } from "react";

// A table under a section label: mono column heads, when it has them, over rows split by
// hairlines.
export default function DataTable({
  columns,
  children,
}: {
  columns?: string[];
  children: ReactNode;
}) {
  return (
    <table className="data-table">
      {columns && (
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
      )}
      <tbody>{children}</tbody>
    </table>
  );
}
