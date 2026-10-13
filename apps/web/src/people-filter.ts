import type { MediaType, Person } from "./media";

export type PeopleCreditFilter = "all" | "cast" | "artist";
export function defaultPeopleCreditFilter(mediaType?: MediaType): PeopleCreditFilter {
  return mediaType === "video" ? "cast" : mediaType === "comic" || mediaType === "story" ? "artist" : "all";
}
export function filterPeopleCredits(people: Person[], filter: PeopleCreditFilter) {
  return people.filter((person) => filter === "all" || (filter === "cast" ? person.cast_count ?? 0 : person.artist_count ?? 0) > 0);
}
