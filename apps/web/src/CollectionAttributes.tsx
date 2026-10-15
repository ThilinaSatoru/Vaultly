import { AttributeBadge } from "./AttributeBadge";
import type { MediaType, SeriesSummary } from "./media";

export function CollectionAttributes({ attributes, mediaType }: { attributes: SeriesSummary["card_attributes"]; mediaType?: MediaType }) {
  if (!attributes) return null;
  return <div className="media-card-tags" aria-label="Combined collection attributes">
    {attributes.tags.map((tag) => <AttributeBadge kind="tag" key={`tag-${tag.id}`} {...tag} mediaType={mediaType} />)}
    {attributes.categories.map((category) => <AttributeBadge kind="category" key={`category-${category.id}`} {...category} mediaType={mediaType} />)}
    {attributes.people.map((person) => <AttributeBadge kind={mediaType === "video" ? "cast" : "artist"} key={`person-${person.id}`} {...person} mediaType={mediaType} />)}
  </div>;
}
