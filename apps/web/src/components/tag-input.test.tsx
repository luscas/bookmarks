import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { TagInput } from "./tag-input";

function Harness() {
  const [tags, setTags] = useState<string[]>([]);
  return <TagInput value={tags} onChange={setTags} suggestions={["react", "dev"]} />;
}

describe("TagInput", () => {
  it("adds a tag when Enter is pressed", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const input = screen.getByLabelText("Adicionar tag");
    await user.type(input, "Web Design{Enter}");

    expect(screen.getByText("Web Design")).toBeInTheDocument();
    expect(input).toHaveValue("");
  });

  it("adds a tag from a suggestion", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: "react" }));

    expect(screen.getByText("react")).toBeInTheDocument();
  });

  it("does not add duplicate tags", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const input = screen.getByLabelText("Adicionar tag");
    await user.type(input, "react{Enter}");
    await user.type(input, "react{Enter}");

    expect(screen.getAllByText("react")).toHaveLength(1);
  });

  it("removes a tag via its remove button", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: "react" }));
    await user.click(screen.getByRole("button", { name: "Remover tag react" }));

    expect(screen.queryByRole("button", { name: "Remover tag react" })).not.toBeInTheDocument();
  });
});
