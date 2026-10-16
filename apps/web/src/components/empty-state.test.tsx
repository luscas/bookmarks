import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EmptyState } from "./empty-state";
import { Button } from "./ui/button";

describe("EmptyState", () => {
  it("renders the title, description and action", () => {
    render(
      <EmptyState
        icon={<span data-testid="icon" />}
        title="Nenhum favorito ainda"
        description="Salve seu primeiro link para começar."
        action={<Button>Adicionar favorito</Button>}
      />,
    );

    expect(screen.getByRole("heading", { name: "Nenhum favorito ainda" })).toBeInTheDocument();
    expect(screen.getByText("Salve seu primeiro link para começar.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Adicionar favorito" })).toBeInTheDocument();
  });

  it("omits the action when none is provided", () => {
    render(<EmptyState icon={<span />} title="Vazio" description="Nada por aqui." />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
