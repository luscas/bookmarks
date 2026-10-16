import { describe, expect, it } from "vitest";
import { folderPathToTagName } from "./folders.js";

describe("folderPathToTagName", () => {
  it("drops the root folder and joins the rest", () => {
    expect(folderPathToTagName(["Bookmarks Bar", "Dev", "React"])).toBe("Dev/React");
  });

  it("handles localized root folders", () => {
    expect(folderPathToTagName(["Barra de favoritos", "Trabalho"])).toBe("Trabalho");
  });

  it("returns undefined when only roots are present", () => {
    expect(folderPathToTagName(["Other Bookmarks"])).toBeUndefined();
  });

  it("returns undefined for empty or missing input", () => {
    expect(folderPathToTagName([])).toBeUndefined();
    expect(folderPathToTagName(undefined)).toBeUndefined();
  });
});
