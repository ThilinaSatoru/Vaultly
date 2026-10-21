import { AttributeEditorDialog } from "./AttributeEditorDialog";

export function FilenameRefactoringDialog({ sourceNames, onClose, onConfirm }: { sourceNames: string[]; onClose: () => void; onConfirm: () => void }) {
  return <AttributeEditorDialog title="Confirm filename changes" onClose={onClose}>
    <p>This scan will rename media files on disk in {sourceNames.join(", ")}.</p>
    <p>Existing attribute names and aliases are removed from the original filename. Repeated title words are cleaned up, then assigned casts and tags are applied in the new format:</p>
    <p><code>Cast 1, Cast 2 - Cleaned title #tag1 #tag2.ext</code></p>
    <p>Book and comic files use assigned artists as credits. Matching subtitle filenames are updated with their video.</p>
    <p>Library titles will match the full filenames, including credits, tags, and extensions. Library paths will sync automatically. Conflicting filenames are skipped. Image collection folders keep their names.</p>
    <div className="dialog-actions">
      <button className="secondary-button" type="button" onClick={onClose}>Cancel</button>
      <button className="primary-button" type="button" onClick={onConfirm}>Rename files and sync</button>
    </div>
  </AttributeEditorDialog>;
}
