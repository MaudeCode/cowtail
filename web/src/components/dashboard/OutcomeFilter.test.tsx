import { within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { renderWithProviders } from "../../test/render";
import OutcomeFilter from "./OutcomeFilter";

test("choosing an outcome reports it to onChange", async () => {
  const onChange = vi.fn();
  const { container } = renderWithProviders(<OutcomeFilter value="all" onChange={onChange} />);

  await userEvent.click(within(container).getByRole("button", { name: "Self Resolved" }));

  expect(onChange).toHaveBeenCalledExactlyOnceWith("self-resolved");
});
