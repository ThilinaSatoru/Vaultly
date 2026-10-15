import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PersonBadge, PersonDirectoryContext, PersonProfileHeader } from "./PersonProfile";

describe("person profiles", () => {
  it("resolves a media credit's name from the shared person directory", () => {
    const markup = renderToStaticMarkup(<PersonDirectoryContext.Provider value={[{ id: 1, name: "Current name", gender: "Female" }]}>
      <PersonBadge person={{ id: 1, name: "Old name" }} className="tag-badge" onClick={() => {}} />
    </PersonDirectoryContext.Provider>);
    expect(markup).toContain("View profile for Current name");
    expect(markup).not.toContain("Old name");
  });
  it("shows photo, demographic information, credit counts and source profile", () => {
    const markup = renderToStaticMarkup(<PersonProfileHeader person={{ id: 1, name: "Alex", avatar_url: "https://example.com/alex.png", gender: "Female", country: "Sri Lanka", cast_count: 3, artist_count: 2, set_count: 1, profile_url: "https://example.com/alex" }} />);
    for (const detail of ["alex.png", "Female", "Sri Lanka", "3 cast credits", "2 artist credits", "1 set assignments", "Source profile"]) expect(markup).toContain(detail);
  });
  it("provides explicit fallbacks for missing profile information", () => {
    const markup = renderToStaticMarkup(<PersonProfileHeader person={{ id: 2, name: "Unknown" }} />);
    expect(markup).toContain("No profile photo");
    expect(markup.match(/Not specified/g)).toHaveLength(2);
  });
});
