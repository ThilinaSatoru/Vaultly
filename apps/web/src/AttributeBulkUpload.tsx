import { useState, type ChangeEvent } from "react";
import { api } from "./media";
import { beginRequestActivity } from "./request-activity";
import { uploadAttributeFile, type AttributeImportReport } from "./attribute-upload";
import type { AttributeManagerKind } from "./attribute-manager";

export function AttributeBulkUpload({
  kind,
  onChanged,
}: {
  kind: AttributeManagerKind;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const [progress, setProgress] = useState("");
  const [existingOnly, setExistingOnly] = useState(false);
  const example =
    kind === "people"
      ? {
          scraped_at: "2026-10-13T06:08:45.385Z",
          total: 1,
          records: [
            {
              name: "Example Person",
              gender: "male",
              country_code: "us",
              country: "United States",
              avatar_url: "https://example.com/avatar.jpg",
              source: "directory/people",
              profile_url: "https://example.com/people/example",
              patterns: ["Example Alias"],
            },
          ],
        }
      : {
          records: [
            {
              name: kind === "tags" ? "Favorites" : "Documentaries",
              patterns: [kind === "tags" ? "Favorite" : "Documentary"],
            },
          ],
        };
  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    setError("");
    setResult("");
    setProgress("Checking JSON…");
    let saved = 0;
    const finish = beginRequestActivity(`Uploading ${kind}`, "Reading and validating JSON", kind === "people" ? "people" : "sources");
    try {
      const report = await uploadAttributeFile(file, (body) => api<AttributeImportReport>(`/api/attributes/${kind}/import${existingOnly ? "?existingOnly=true" : ""}`, {
        method: "POST", body,
      }, false), (processed, total) => {
        saved = processed;
        const message = `Importing and indexing ${processed.toLocaleString()} / ${total.toLocaleString()} records`;
        setProgress(message);
        finish.update("Importing and indexing attributes", processed, total);
      });
      setResult(
        `${report.created} created, ${report.updated} updated${report.skipped ? `, ${report.skipped} records skipped` : ""}, ${report.indexed} new media assignments.`,
      );
    } catch (failure) {
      setError(
        failure instanceof SyntaxError ? "Invalid JSON. Check the supported format below." : failure instanceof Error ? failure.message : "Could not import JSON.",
      );
    } finally {
      finish();
      setBusy(false);
      if (saved > 0) onChanged();
    }
  };
  return (
    <div className="attribute-bulk-upload">
      <label>
        Bulk upload {kind}
        <input
          type="file"
          accept=".json,application/json"
          disabled={busy}
          onChange={(event) => void upload(event)}
        />
      </label>
      <label className="attribute-import-existing-only">
        <input type="checkbox" checked={existingOnly} disabled={busy} onChange={(event) => setExistingOnly(event.target.checked)} />
        Update existing names only
      </label>
      <p>{existingOnly ? "Update matching entries and skip names that are not already in your vault. No new entries are created. Supplied fields update existing entries; omitted fields are preserved." : "Enable this option to skip unfamiliar names and keep junk records out of your vault."}</p>
      <p>
        Upload a prepared JSON file. Existing names are matched without case
        sensitivity. {!existingOnly && (kind === "people" ? "Duplicate people are skipped, including repeats within the upload; existing profiles and patterns are preserved." : "Supplied fields update existing entries; omitted fields are preserved.")} Names and patterns are matched against indexed media
        filenames.
      </p>
      <details>
        <summary>Supported JSON format</summary>
        <p>
          Use a records object as shown, or a plain array of records. Name is
          required (up to {kind === "people" ? 100 : 80} characters). Other
          fields are optional. Patterns replace existing patterns when supplied;
          use [] to clear them. Large files are read incrementally and uploaded
          in chunks of up to 10,000 records and 20 MB. Each chunk is saved
          separately; completed chunks remain saved if a later chunk fails.
        </p>
        {kind === "people" && (
          <p>
            Avatar URLs accept HTTP/HTTPS links or base64 PNG, JPEG, GIF, and WebP data URLs. Avatar and profile URLs are saved as references. Avatar previews
            load from their original URL; upload an image separately to keep a
            local copy.
            Use null to clear an optional profile field. scraped_at must be an
            ISO timestamp; total is optional and does not limit the records
            imported.
          </p>
        )}
        <pre>{JSON.stringify(example, null, 2)}</pre>
      </details>
      {busy && <p role="status">{progress}</p>}
      {result && <p role="status">{result}</p>}
      {error && (
        <p className="page-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
