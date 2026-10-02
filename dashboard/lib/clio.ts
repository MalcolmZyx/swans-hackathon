import type { Source } from "./types";

// Links into the Clio web app. Contacts and matters link to the record itself; everything
// else links to the matter tab that lists it (the citation popover shows the record ID).
// All Clio routes live here so they can be corrected in one place.
export function clioUrl(source: Source, matterId: number, base: string): string {
  const matter = `${base}/nc/#/matters/${matterId}`;
  switch (source.kind) {
    case "matter":
    case "custom_field":
      return `${matter}/dashboard`;
    case "contact":
      return `${base}/nc/#/contacts/${source.recordId}`;
    case "relationship":
      return `${matter}/contacts`;
    case "note":
      return `${matter}/notes`;
    case "communication":
      return `${matter}/communications`;
    case "calendar_entry":
      return `${matter}/calendar`;
    case "task":
      return `${matter}/tasks`;
    case "document":
      return `${matter}/documents`;
    case "activity":
      return `${matter}/activities`;
  }
}
