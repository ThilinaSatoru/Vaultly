import { YoutubeLibrary, type YoutubePlayback } from "./YoutubeLibrary";
import { YoutubePlayer } from "./YoutubePlayer";
import { MusicSourceCard } from "./MusicSourceCard";
import type { MusicSource } from "./music";
import { ClearableInput } from "./ClearableField";
import { Select } from "./Select";
import { MusicWorkspace } from "./MusicWorkspace";
import { SidebarResizeHandle, useCompactHeader } from "./AppChrome";
import { defaultPeopleCreditFilter, type PeopleCreditFilter } from "./people-filter";
import { VaultProfiles } from "./VaultProfiles";
import type { VaultProfiles as ProfileList } from "./vault-session";
import {
  SourceAttributesDialog,
  SourceAttributeFields,
  type SourceAttributeOptions,
} from "./SourceAttributesDialog";
import { SourceConversion } from "./SourceConversion";
import { FilenameRefactoringDialog } from "./FilenameRefactoringDialog";
import { SourcesBrowser } from "./SourcesBrowser";
import { AttributeBadge, AttributeBrowseProvider } from "./AttributeBadge";
import { PersonDirectoryContext } from "./PersonProfile";
import { ManagementDrawer, type ManagementTab } from "./ManagementDrawer";
import { BackgroundStatus } from "./BackgroundStatus";
import { AttributeEditorDialog } from "./AttributeEditorDialog";
import { CategoriesView } from "./CategoriesView";
import { TagsView } from "./TagsView";
import { PeopleView } from "./PeopleView";
import {
  AttributeManagerContext,
  type AttributeManagerKind,
} from "./attribute-manager";
import {
  NavigationContext,
  useNavigation,
  useNavigationField,
} from "./navigation";
import type { GalleryVideoContext } from "./video-playlist";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  CircleHelp,
  Clapperboard,
  Folder,
  FolderOpen,
  Grid2X2,
  HardDrive,
  Heart,
  Home,
  Image,
  Library,
  Layers3,
  ListVideo,
  LoaderCircle,
  MoreHorizontal,
  Music2,
  PanelLeftClose,
  PanelLeftOpen,
  Orbit,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Tag as TagIcon,
  Trash2,
  X,
} from "lucide-react";
import {
  type FormEvent,
  type ReactNode,
  type CSSProperties,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { GalleryView } from "./GalleryView";
import { ThemeToggle } from "./DesktopTitleBar";
import { MediaViewer } from "./MediaViewer";
import { SeriesView } from "./SeriesView";
import { SettingsView } from "./SettingsView";
import { useUiState } from "./ui-state";
import { HelpView } from "./HelpView";
import { ScanProgress, type SourceScanProgress } from "./ScanProgress";
import {
  api,
  formatCount,
  type Category,
  type MediaItem,
  type MediaType,
  type Person,
  type SeriesViewerContext,
  type Tag,
} from "./media";

type SourceStatus = "idle" | "scanning" | "ready" | "error";

interface LibrarySource {
  enabled?: number;
  filename_refactoring?: number;
  prefix_grouping?: number;
  directory_grouping?: number;
  filename_metadata_matching?: number;
  hash_favorite_markers?: number;
  id: number;
  name: string;
  root_path: string;
  media_type: string;
  status: SourceStatus;
  last_error: string | null;
  last_scanned_at: string | null;
  scan_progress: SourceScanProgress | null;
  item_count: number;
  comic_count: number;
  video_count: number;
  story_count: number;
  tags?: Tag[];
  categories?: Category[];
  path_available: boolean;
  path_error: string | null;
}

type Section =
  | "home"
  | "music"
  | "youtube"
  | "all"
  | MediaType
  | "categories"
  | "tags"
  | "people"
  | "sources"
  | "settings"
  | "help";
export type LibraryView =
  | "browse"
  | "categories"
  | "favorites"
  | "series"
  | "circles";

function LibraryNav({
  active,
  view,
  icon,
  label,
  count,
  onBrowse,
  onView,
}: {
  active: boolean;
  view: LibraryView;
  icon: ReactNode;
  label: string;
  count?: string;
  onBrowse: () => void;
  onView: (view: LibraryView) => void;
}) {
  return (
    <div className={`library-nav-group${active ? " is-active" : ""}`}>
      <button
        className={active && view === "browse" ? "nav-active" : "nav-link"}
        type="button"
        onClick={onBrowse}>
        {icon} {label}
        {count && <span>{count}</span>}
      </button>
      {active && (
        <div className="library-submenu">
          <button
            className={view === "categories" ? "active" : ""}
            type="button"
            onClick={() => onView("categories")}>
            <Folder size={14} /> Categories
          </button>
          <button
            className={view === "favorites" ? "active" : ""}
            type="button"
            onClick={() => onView("favorites")}>
            <Heart size={14} /> Favorites
          </button>
          <button
            className={view === "series" ? "active" : ""}
            type="button"
            onClick={() => onView("series")}>
            <Layers3 size={14} /> Series & sets
          </button>
          <button
            className={view === "circles" ? "active" : ""}
            type="button"
            onClick={() => onView("circles")}>
            <Orbit size={14} /> Circles
          </button>
        </div>
      )}
    </div>
  );
}

const formatScanDate = (value: string | null) => {
  if (!value) return "Not scanned yet";
  const date = new Date(`${value.replace(" ", "T")}Z`);
  if (Number.isNaN(date.getTime())) return "Scan date unavailable";
  const minutes = Math.round((date.getTime() - Date.now()) / 60000);
  const relativeTime = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (Math.abs(minutes) < 60) return relativeTime.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return relativeTime.format(hours, "hour");
  return relativeTime.format(Math.round(hours / 24), "day");
};

function AddSourceDialog({
  onClose,
  onAdded,
  initialMediaType = "",
  ...attributeOptions
}: SourceAttributeOptions & { onClose: () => void; onAdded: () => void; initialMediaType?: string }) {
  const [rootPath, setRootPath] = useState("");
  const [tagIds, setTagIds] = useState<number[]>([]);
  const [categoryIds, setCategoryIds] = useState<number[]>([]);
  const [name, setName] = useState("");
  const [mediaType, setMediaType] = useState(initialMediaType);
  const [prefixGrouping, setPrefixGrouping] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);

  const chooseFolder = async () => {
    setPicking(true);
    setError("");
    try {
      const result = await api<{ path: string | null }>(
        "/api/system/pick-directory",
        { method: "POST" },
      );
      if (result.path) setRootPath(result.path);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not open the folder picker.",
      );
    } finally {
      setPicking(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!rootPath.trim()) {
      setError("Choose or enter a folder path.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await api(mediaType === "music" ? "/api/music/sources" : "/api/sources", {
        method: "POST",
        body: JSON.stringify({
          rootPath: rootPath.trim(),
          name: name.trim() || undefined,
          mediaType,
          prefixGrouping,
          tagIds,
          categoryIds,
        }),
      });
      onAdded();
      onClose();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not add this folder.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <AttributeEditorDialog
      title="Add a library source"
      onClose={onClose}
      busy={saving || picking}>
      <div className="dialog-icon">
        <FolderOpen size={24} />
      </div>
      <p className="dialog-intro">
        Choose a media type, then its root folder. Nested folders keep their
        structure and unrelated files are skipped.
      </p>

      <form onSubmit={submit}>
        <label htmlFor="source-media-type">Media type</label>
        <Select
          id="source-media-type"
          required
          value={mediaType}
          onChange={(event) => setMediaType(event.target.value)}>
          <option value="" disabled>
            Choose a media type…
          </option>
          <option value="movies">Movies</option>
          <option value="tv">TV series</option>
          <option value="anime">Anime</option>
          <option value="manga">Manga / comics</option>
          <option value="ebooks">E-books / documents</option>
          <option value="pictures">Pictures</option>
          <option value="music">Music / music videos</option>
        </Select>
        <label htmlFor="source-path">Folder path</label>
        <div className="path-control">
          <ClearableInput
            id="source-path"
            value={rootPath}
            onChange={(event) => setRootPath(event.target.value)}
            placeholder={"D:\\Media"}
            autoFocus
          />
          <button
            className="browse-button"
            type="button"
            onClick={chooseFolder}
            disabled={picking}>
            {picking ? (
              <LoaderCircle className="spin" size={17} />
            ) : (
              <FolderOpen size={17} />
            )}
            Browse
          </button>
        </div>

        <label htmlFor="source-name">
          Display name <span>Optional</span>
        </label>
        <ClearableInput
          id="source-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Uses the folder name by default"
        />

        {mediaType !== "music" && <SourceAttributeFields
          {...attributeOptions}
          tagIds={tagIds}
          categoryIds={categoryIds}
          onTagsChange={setTagIds}
          onCategoriesChange={setCategoryIds}
          disabled={saving}
        />}

        <p className="attribute-help"><strong>Initial scan option</strong></p>
        <label className="source-refactoring-option">
          <input type="checkbox" checked={prefixGrouping} onChange={(event) => setPrefixGrouping(event.target.checked)} />
          Group files by shared filename prefixes
        </label>
        <p className="attribute-help">Disable this for sources where filenames share generic words. Folder and numbered sequence grouping still works.</p>

        <div className="mixed-note">
          <Grid2X2 size={18} />
          <div>
            <strong>{mediaType === "music" ? "Scan audio and music videos" : "Scan only the selected media"}</strong>
            <span>
              {mediaType === "music" ? "Audio files and videos in this folder appear in Music, with embedded titles, artists, albums, and artwork." : "Movie and series scans skip cover images, subtitles, and unrelated documents. Seasons, chapters, and custom subfolders stay browsable."}
            </span>
          </div>
        </div>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <div className="dialog-actions">
          <button className="secondary-button" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" type="submit" disabled={saving}>
            {saving ? (
              <LoaderCircle className="spin" size={18} />
            ) : (
              <Plus size={18} />
            )}
            Add & scan
          </button>
        </div>
      </form>
    </AttributeEditorDialog>
  );
}

function SourceCard({
  source,
  onChanged,
  expanded,
  onToggle,
  ...attributeOptions
}: SourceAttributeOptions & {
  source: LibrarySource;
  onChanged: () => void;
  expanded: boolean;
  onToggle: () => void;
}) {
  const [converting, setConverting] = useState(false);
  const [attributesOpen, setAttributesOpen] = useState(false);
  const [confirmRefactoring, setConfirmRefactoring] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [working, setWorking] = useState(false);
  const [actionError, setActionError] = useState("");
  const enabled = source.enabled !== 0;
  const displayStatus = !enabled
    ? "disabled"
    : source.path_available
      ? converting
        ? "converting"
        : source.status
      : "unavailable";
  const toggleEnabled = async () => {
    setWorking(true);
    setActionError("");
    try {
      await api(`/api/sources/${source.id}/enabled`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !enabled }),
      });
      onChanged();
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "Could not change source availability.",
      );
    } finally {
      setWorking(false);
    }
  };

  const rescan = async (englishAttributes = true, refactorFilenames = false, confirmed = false) => {
    if (refactorFilenames && !confirmed) { setConfirmRefactoring(true); return; }
    setConfirmRefactoring(false);
    setWorking(true);
    setMenuOpen(false);
    setActionError("");
    try {
      await api(`/api/sources/${source.id}/scan`, {
        method: "POST",
        body: JSON.stringify({ englishAttributes, refactorFilenames, confirmFilenameChanges: confirmed }),
      });
      onChanged();
    } catch (requestError) {
      setActionError(
        requestError instanceof Error
          ? requestError.message
          : "Could not scan this source.",
      );
    } finally {
      setWorking(false);
    }
  };

  const cancelScan = async () => {
    setWorking(true);
    setMenuOpen(false);
    setActionError("");
    try {
      await api(`/api/sources/${source.id}/scan/cancel`, { method: "POST" });
      onChanged();
    } catch (requestError) {
      setActionError(
        requestError instanceof Error
          ? requestError.message
          : "Could not cancel this scan.",
      );
    } finally {
      setWorking(false);
    }
  };

  const remove = async () => {
    if (
      !window.confirm(
        `Remove “${source.name}” from Vaultly? Your files will not be deleted.`,
      )
    )
      return;
    setWorking(true);
    setActionError("");
    try {
      await api(`/api/sources/${source.id}`, { method: "DELETE" });
      onChanged();
    } catch (requestError) {
      setActionError(
        requestError instanceof Error
          ? requestError.message
          : "Could not remove this source.",
      );
    } finally {
      setWorking(false);
    }
  };

  const relocate = async () => {
    setWorking(true);
    setMenuOpen(false);
    setActionError("");
    try {
      const picked = await api<{ path: string | null }>(
        "/api/system/pick-directory",
        { method: "POST" },
      );
      if (!picked.path) return;
      await api(`/api/sources/${source.id}`, {
        method: "PATCH",
        body: JSON.stringify({ rootPath: picked.path, name: source.name }),
      });
      onChanged();
    } catch (requestError) {
      setActionError(
        requestError instanceof Error
          ? requestError.message
          : "Could not relocate this source.",
      );
    } finally {
      setWorking(false);
    }
  };

  return (
    <article
      className={`source-card${expanded ? " is-expanded" : ""}${enabled ? "" : " is-disabled"}`}>
      <div className="source-card-top">
        <button
          className="source-expand"
          type="button"
          aria-expanded={expanded}
          aria-controls={`source-details-${source.id}`}
          aria-label={`${expanded ? "Collapse" : "Expand"} ${source.name}`}
          onClick={onToggle}>
          <ChevronRight size={17} />
        </button>
        <div className="drive-icon">
          <HardDrive size={19} />
        </div>
        <div className="source-heading">
          <div className="source-title-line">
            <h3>
              <button
                className="source-name-toggle"
                type="button"
                aria-expanded={expanded}
                aria-controls={`source-details-${source.id}`}
                onClick={onToggle}>
                {source.name}
              </button>
            </h3>
            <span className={`status status-${displayStatus}`}>
              {displayStatus === "scanning" ||
              displayStatus === "converting" ? (
                <LoaderCircle className="spin" size={13} />
              ) : displayStatus === "ready" ? (
                <Check size={13} />
              ) : displayStatus === "unavailable" ? (
                <AlertTriangle size={13} />
              ) : null}
              {displayStatus}
            </span>
          </div>
          <p title={source.root_path}>{source.root_path}</p>
        </div>
        <span className="source-item-count">
          {formatCount(source.item_count)} items
        </span>
        <button
          type="button"
          className="source-enabled-toggle"
          role="switch"
          aria-checked={enabled}
          aria-label={`${enabled ? "Disable" : "Enable"} ${source.name}`}
          title={
            enabled
              ? "Disable source and hide its content"
              : "Enable source and show its content"
          }
          disabled={working}
          onClick={() => void toggleEnabled()}>
          <span />
        </button>
        <div className="menu-wrap">
          <button
            className="icon-button"
            type="button"
            aria-label={`Actions for ${source.name}`}
            onClick={() => setMenuOpen(!menuOpen)}
            disabled={working}>
            <MoreHorizontal size={20} />
          </button>
          {menuOpen && (
            <div className="source-menu">
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  setAttributesOpen(true);
                }}>
                <TagIcon size={16} /> Common attributes
              </button>
              <button
                type="button"
                onClick={() => void relocate()}
                disabled={converting || source.status === "scanning"}>
                <FolderOpen size={16} /> Relocate source
              </button>
              <button
                className="danger"
                type="button"
                onClick={remove}
                disabled={converting || source.status === "scanning"}>
                <Trash2 size={16} /> Remove source
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="source-stats" hidden={!expanded}>
        <div>
          <Image size={17} />
          <span>Comics</span>
          <strong>{formatCount(source.comic_count)}</strong>
        </div>
        <div>
          <Clapperboard size={17} />
          <span>Videos</span>
          <strong>{formatCount(source.video_count)}</strong>
        </div>
        <div>
          <BookOpen size={17} />
          <span>Stories</span>
          <strong>{formatCount(source.story_count)}</strong>
        </div>
      </div>

      <div hidden={!expanded}>
        <SourceConversion
          sourceId={source.id}
          enabled={
            enabled &&
            source.video_count > 0 &&
            source.path_available &&
            source.status !== "scanning" &&
            Boolean(source.last_scanned_at)
          }
          scanEnabled={
            enabled && source.path_available && source.status !== "scanning"
          }
          scanBusy={working}
          filenameRefactoring={Boolean(source.filename_refactoring)}
          expanded={expanded}
          onScan={rescan}
          onExpand={onToggle}
          onChanged={onChanged}
          onRunning={setConverting}
        />
      </div>
      <div
        id={`source-details-${source.id}`}
        className="source-details"
        hidden={!expanded}>
        <label>
          Media type{" "}
          <Select
            aria-label={`Media type for ${source.name}`}
            value={source.media_type ?? "mixed"}
            disabled={working || converting || source.status === "scanning"}
            onChange={(event) => {
              const mediaType = event.target.value;
              setWorking(true);
              void api(`/api/sources/${source.id}`, {
                method: "PATCH",
                body: JSON.stringify({ rootPath: source.root_path, mediaType }),
              })
                .then(onChanged)
                .catch((reason: unknown) =>
                  setActionError(
                    reason instanceof Error
                      ? reason.message
                      : "Could not change media type.",
                  ),
                )
                .finally(() => setWorking(false));
            }}>
            <option value="mixed">Legacy mixed media</option>
            <option value="movies">Movies</option>
            <option value="tv">TV series</option>
            <option value="anime">Anime</option>
            <option value="manga">Manga / comics</option>
            <option value="ebooks">E-books / documents</option>
            <option value="pictures">Pictures</option>
          </Select>
        </label>
        <p className="attribute-help"><strong>Grouping rules</strong> · Each source can use a different combination.</p>
        <label className="source-refactoring-option">
          <input type="checkbox" checked={source.prefix_grouping !== 0} disabled={working || converting || source.status === "scanning"}
            onChange={(event) => {
              setWorking(true); setActionError("");
              void api(`/api/sources/${source.id}`, { method: "PATCH", body: JSON.stringify({ rootPath: source.root_path, prefixGrouping: event.target.checked }) })
                .then(onChanged)
                .catch((reason: unknown) => setActionError(reason instanceof Error ? reason.message : "Could not change prefix grouping."))
                .finally(() => setWorking(false));
            }} />
          Group remaining files by shared filename prefixes (two-word, then one-word matches)
        </label>
        <label className="source-refactoring-option">
          <input type="checkbox" checked={source.directory_grouping !== 0} disabled={working || converting || source.status === "scanning"}
            onChange={(event) => {
              setWorking(true); setActionError("");
              void api(`/api/sources/${source.id}`, { method: "PATCH", body: JSON.stringify({ rootPath: source.root_path, directoryGrouping: event.target.checked }) })
                .then(onChanged)
                .catch((reason: unknown) => setActionError(reason instanceof Error ? reason.message : "Could not change directory grouping."))
                .finally(() => setWorking(false));
            }} />
          Group files by directory structure (season, episode, chapter, and folder ordering)
        </label>
        <p className="attribute-help"><strong>Filename matching and naming rules</strong></p>
        <label className="source-refactoring-option">
          <input type="checkbox" checked={source.filename_metadata_matching !== 0} disabled={working || converting || source.status === "scanning"}
            onChange={(event) => {
              setWorking(true); setActionError("");
              void api(`/api/sources/${source.id}`, { method: "PATCH", body: JSON.stringify({ rootPath: source.root_path, filenameMetadataMatching: event.target.checked }) })
                .then(onChanged)
                .catch((reason: unknown) => setActionError(reason instanceof Error ? reason.message : "Could not change filename metadata matching."))
                .finally(() => setWorking(false));
            }} />
          Match people, tags, and categories from filenames
        </label>
        <label className="source-refactoring-option">
          <input type="checkbox" checked={source.hash_favorite_markers !== 0} disabled={working || converting || source.status === "scanning"}
            onChange={(event) => {
              setWorking(true); setActionError("");
              void api(`/api/sources/${source.id}`, { method: "PATCH", body: JSON.stringify({ rootPath: source.root_path, hashFavoriteMarkers: event.target.checked }) })
                .then(onChanged)
                .catch((reason: unknown) => setActionError(reason instanceof Error ? reason.message : "Could not change hash marker handling."))
                .finally(() => setWorking(false));
            }} />
          Treat leading # in filenames as favorite markers and remove it
        </label>
        <p className="attribute-help">Filename matching assigns existing people, tags, and categories by names and aliases. Comic archive metadata is read independently. Leading # markers set favorites and are removed from files when enabled.</p>
        <label className="source-refactoring-option">
          <input type="checkbox" checked={Boolean(source.filename_refactoring)} disabled={working || converting || source.status === "scanning"}
            onChange={(event) => {
              setWorking(true); setActionError("");
              void api(`/api/sources/${source.id}/filename-refactoring`, { method: "PATCH", body: JSON.stringify({ enabled: event.target.checked }) })
                .then(onChanged)
                .catch((reason: unknown) => setActionError(reason instanceof Error ? reason.message : "Could not change filename refactoring."))
                .finally(() => setWorking(false));
            }} />
          Rename files using matched people and tags
        </label>
        <p className="attribute-help">Off by default. A confirmed “Scan + refactor filenames” run names supported files across media types using the remaining title words, matched cast, and tags. It renames files on disk and syncs library paths; image-folder items are not renamed.</p>
        <div className="source-common-attributes">
          <div className="attribute-badges">
            {(source.tags ?? []).map((tag) => (
              <AttributeBadge key={`tag-${tag.id}`} kind="tag" {...tag} />
            ))}
            {(source.categories ?? []).map((category) => (
              <AttributeBadge
                key={`category-${category.id}`}
                kind="category"
                {...category}
              />
            ))}
          </div>
          <button
            className="source-attributes-edit"
            type="button"
            onClick={() => setAttributesOpen(true)}>
            <TagIcon size={15} />
            {source.tags?.length || source.categories?.length
              ? "Edit common attributes"
              : "Add common tags or categories"}
          </button>
        </div>
        {source.status === "scanning" && source.scan_progress && (
          <ScanProgress progress={source.scan_progress} />
        )}
      </div>
      {attributesOpen && (
        <SourceAttributesDialog
          source={source}
          {...attributeOptions}
          onClose={() => setAttributesOpen(false)}
          onSaved={onChanged}
        />
      )}
      {confirmRefactoring && <FilenameRefactoringDialog sourceNames={[source.name]} onClose={() => setConfirmRefactoring(false)} onConfirm={() => void rescan(true, true, true)} />}
      <footer hidden={!expanded && source.status !== "scanning"}>
        <span>
          {source.status === "scanning"
            ? "Scan in progress…"
            : formatScanDate(source.last_scanned_at)}
        </span>
        {source.status === "scanning" ? (
          <button
            className="source-attributes-edit"
            type="button"
            onClick={() => void cancelScan()}
            disabled={working}>
            {working ? (
              <LoaderCircle className="spin" size={15} />
            ) : (
              <X size={15} />
            )}
            {working ? "Cancelling…" : "Cancel scan"}
          </button>
        ) : (
          <strong>{formatCount(source.item_count)} items</strong>
        )}
      </footer>
      {expanded && source.last_error && (
        <p className="scan-error">{source.last_error}</p>
      )}
      {expanded && !source.path_available && (
        <p className="source-unavailable">
          <AlertTriangle size={15} />{" "}
          {source.path_error || "The source path or drive is unavailable."}
        </p>
      )}
      {actionError && (
        <p className="scan-error" role="alert">
          {actionError}
        </p>
      )}
    </article>
  );
}

function HomeView({
  sources,
  categories,
  onOpenLibrary,
  onOpenCategories,
  onAddSource,
}: {
  sources: LibrarySource[];
  categories: Category[];
  onOpenLibrary: (type: MediaType) => void;
  onOpenCategories: () => void;
  onAddSource: () => void;
}) {
  const connectedSources = sources.filter(
    (source) => source.enabled !== 0 && source.path_available,
  );
  const totals = connectedSources.reduce(
    (result, source) => ({
      all: result.all + source.item_count,
      comic: result.comic + source.comic_count,
      video: result.video + source.video_count,
      story: result.story + source.story_count,
    }),
    { all: 0, comic: 0, video: 0, story: 0 },
  );
  const libraries = [
    {
      type: "comic" as const,
      label: "Comics",
      description: "Issues, image folders, and archives",
      count: totals.comic,
      icon: <Image size={25} />,
    },
    {
      type: "video" as const,
      label: "Videos",
      description: "Movies, episodes, and local clips",
      count: totals.video,
      icon: <Clapperboard size={25} />,
    },
    {
      type: "story" as const,
      label: "E-books",
      description: "PDF, EPUB, books, and documents",
      count: totals.story,
      icon: <BookOpen size={25} />,
    },
  ];
  const availableCategories = categories.filter(
    (category) => category.item_count > 0,
  );
  const visibleCategories = availableCategories.slice(0, 8);

  return (
    <>
      <div className="page-heading home-heading">
        <div>
          <p className="eyebrow">Your library</p>
          <h1>Your library, your rules.</h1>
          <p>Pick up where you left off, or jump into a media library.</p>
        </div>
        {!sources.length && (
          <button
            className="primary-button"
            type="button"
            onClick={onAddSource}>
            <Plus size={18} /> Add source
          </button>
        )}
      </div>

      <section className="home-stats" aria-label="Library statistics">
        <div>
          <span>Available media</span>
          <strong>{formatCount(totals.all)}</strong>
        </div>
        <div>
          <span>Categories</span>
          <strong>{formatCount(availableCategories.length)}</strong>
        </div>
        <div>
          <span>Connected sources</span>
          <strong>
            {connectedSources.length}
            <small> / {sources.length}</small>
          </strong>
        </div>
      </section>

      <section className="home-section">
        <div className="home-section-heading">
          <div>
            <p className="eyebrow">Browse</p>
            <h2>Libraries</h2>
          </div>
        </div>
        <div className="home-library-grid">
          {libraries.map((library) => (
            <button
              key={library.type}
              className={`home-library-card home-library-${library.type}`}
              type="button"
              onClick={() => onOpenLibrary(library.type)}>
              <span className="home-library-icon">{library.icon}</span>
              <span className="home-library-copy">
                <strong>{library.label}</strong>
                <small>{library.description}</small>
              </span>
              <span className="home-library-count">
                {formatCount(library.count)}
              </span>
              <ArrowRight size={19} />
            </button>
          ))}
        </div>
      </section>

      <section className="home-section">
        <div className="home-section-heading">
          <div>
            <p className="eyebrow">Organize</p>
            <h2>Categories</h2>
          </div>
          <button type="button" onClick={onOpenCategories}>
            View all <ArrowRight size={16} />
          </button>
        </div>
        {visibleCategories.length ? (
          <div className="home-category-list">
            {visibleCategories.map((category) => (
              <AttributeBadge key={category.id} kind="category" {...category}>
                <Folder size={18} />
                <span>{category.name}</span>
                <strong>{formatCount(category.item_count)}</strong>
                <ChevronRight size={17} />
              </AttributeBadge>
            ))}
          </div>
        ) : (
          <div className="home-empty-categories">
            <Folder size={24} />
            <span>Categories with available media will appear here.</span>
          </div>
        )}
      </section>
    </>
  );
}

export function App({ profiles }: { profiles: ProfileList }) {
  const navigation = useNavigation();
  return (
    <NavigationContext.Provider value={navigation}>
      <LibraryApp profiles={profiles} />
    </NavigationContext.Provider>
  );
}

function LibraryApp({ profiles }: { profiles: ProfileList }) {
  const navigation = useContext(NavigationContext)!;
  const [section] = useNavigationField<Section>("section", "home");
  const [sidebarHidden, setSidebarHidden] = useUiState("vaultly.ui.sidebarHidden", false);
  const [sidebarWidth, setSidebarWidth] = useUiState("vaultly.ui.sidebarWidth", 252);
  const [musicSidebarHost, setMusicSidebarHost] = useState<HTMLDivElement | null>(null);
  const compactHeader = useCompactHeader();
  useEffect(() => {
    const titles: Record<Section, string> = {
      home: "A world within your vault", music: "Music library", youtube: "YouTube library", all: "The discovery lounge", video: "The screening room",
      comic: "The panel studio", story: "The reading nook", categories: "The collection compass",
      tags: "Threads of discovery", people: "The creative constellation", sources: "Roots of your library",
      settings: "Make it yours", help: "Your field guide",
    };
    document.title = `Vaultly · ${titles[section]}`;
  }, [section]);
  const [libraryView] = useNavigationField<LibraryView>(
    "libraryView",
    "browse",
  );
  const [search, setSearch] = useNavigationField("search", "");
  const [sources, setSources] = useState<LibrarySource[]>([]);
  const [musicSources, setMusicSources] = useState<MusicSource[]>([]);
  const [newSourceType, setNewSourceType] = useState("");
  const combinedSources: Array<LibrarySource & { music_count?: number }> = [...sources, ...musicSources.map((source) => ({
    id: -source.id, name: source.name, root_path: source.root_path, media_type: "music", status: source.status as SourceStatus,
    last_error: source.last_error, last_scanned_at: null, scan_progress: null, item_count: source.track_count, music_count: source.track_count,
    comic_count: 0, video_count: 0, story_count: 0, path_available: source.path_available !== false, path_error: null,
  }))];
  const [categories, setCategories] = useState<Category[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showAddSource, setShowAddSource] = useState(false);
  const [managementOpen, setManagementOpen] = useUiState("vaultly.ui.managementOpen", false);
  const [managementMinimized, setManagementMinimized] = useUiState("vaultly.ui.managementMinimized", false);
  const [managementExpanded, setManagementExpanded] = useUiState("vaultly.ui.managementExpanded", false);
  const [managementTab, setManagementTab] = useUiState<ManagementTab>("vaultly.ui.managementTab", "tags");
  const [managementVisited, setManagementVisited] = useUiState<ManagementTab[]>("vaultly.ui.managementVisited",
    [],
  );
  const [attributeRevision, setAttributeRevision] = useState(0);
  const [peopleFilterRequest, setPeopleFilterRequest] = useState<{ filter: PeopleCreditFilter; revision: number }>({ filter: "all", revision: 0 });
  const openManagement = useCallback((kind: ManagementTab, mediaType?: MediaType) => {
    if (kind === "people") {
      const fields = navigation.current.current.fields;
      const section = fields.section;
      const libraryType = mediaType ?? (section === "video" || section === "comic" || section === "story" ? section
        : section === "all" ? fields[`gallery.all.${fields.libraryView ?? "browse"}.selectedType`] : undefined);
      const filter = defaultPeopleCreditFilter(libraryType === "video" || libraryType === "comic" || libraryType === "story" ? libraryType : undefined);
      setPeopleFilterRequest((current) => ({ filter, revision: current.revision + 1 }));
    }
    setManagementTab(kind);
    setManagementVisited((current) =>
      current.includes(kind) ? current : [...current, kind],
    );
    setManagementMinimized(false);
    setManagementOpen(true);
  }, []);
  const openAttributeManager = useCallback(
    (kind: AttributeManagerKind, mediaType?: MediaType) => openManagement(kind, mediaType),
    [openManagement],
  );
  const addSource = () => {
    openManagement("sources");
    setShowAddSource(true);
  };
  const [selectedItemId] = useNavigationField<number | null>(
    "selectedItemId",
    null,
  );
  const [temporaryPlaylist, setTemporaryPlaylist] = useUiState<MediaItem[]>("vaultly.ui.playlist", []);
  const youtubePageKey = `${navigation.entry.id}:${section}`;
  const [youtubeSession, setYoutubeSession] = useState<{ playback: YoutubePlayback; floating: boolean; pageKey: string } | null>(null);
  const [floatingSession, setFloatingSession] = useState<{
    id: number;
    series: SeriesViewerContext | null;
    gallery: GalleryVideoContext | null;
  } | null>(null);
  const viewerFloating = floatingSession !== null;
  const activeViewerId = floatingSession?.id ?? selectedItemId;
  const navigateViewer = (id: number) => {
    if (floatingSession) setFloatingSession({ ...floatingSession, id });
    else navigation.push({ selectedItemId: id }, `File ${id}`);
  };
  // "full" restores the page viewer; "floating" restores the pop-out window.
  const [viewerMinimized, setViewerMinimized] = useState<false | "full" | "floating">(false);
  const toggleFloating = () => {
    if (floatingSession) {
      navigation.update({
        selectedItemId: floatingSession.id,
        viewerSeriesContext: floatingSession.series,
        viewerGalleryContext: floatingSession.gallery,
      });
      setFloatingSession(null);
    } else if (selectedItemId !== null) {
      setFloatingSession({
        id: selectedItemId,
        series: viewerSeriesContext,
        gallery: viewerGalleryContext,
      });
      navigation.update({ selectedItemId: null });
    }
  };
  const minimizeViewer = () => {
    if (!floatingSession) { toggleFloating(); setViewerMinimized("full"); }
    else setViewerMinimized("floating");
  };
  const restoreViewer = () => {
    const from = viewerMinimized;
    setViewerMinimized(false);
    if (from === "full" && floatingSession) toggleFloating();
  };
  const [viewerSeriesContext, setViewerSeriesContext] =
    useNavigationField<SeriesViewerContext | null>("viewerSeriesContext", null);
  const [viewerGalleryContext] = useNavigationField<GalleryVideoContext | null>(
    "viewerGalleryContext",
    null,
  );
  const [selectedSeriesId] = useNavigationField<number | null>(
    "selectedSeriesId",
    null,
  );

  const [refreshKey, setRefreshKey] = useState(0);
  const [rescanningAll, setRescanningAll] = useState(false);
  const [rescanMediaType, setRescanMediaType] = useState("");
  const previousScanningSourceKey = useRef("");

  const loadSources = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const [media, music] = await Promise.all([api<LibrarySource[]>("/api/sources"), api<MusicSource[]>("/api/music/sources")]);
      setSources(media); setMusicSources(music);
      setError("");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not load your sources.",
      );
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  const loadCategories = useCallback(async () => {
    try {
      setCategories(await api<Category[]>("/api/categories"));
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not load categories.",
      );
    }
  }, []);

  const loadTags = useCallback(async () => {
    try {
      setTags(await api<Tag[]>("/api/tags"));
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not load tags.",
      );
    }
  }, []);

  const loadPeople = useCallback(async () => {
    try {
      setPeople(await api<Person[]>("/api/people"));
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not load people.",
      );
    }
  }, []);

  const createTag = async (name: string): Promise<Tag> => {
    const created = await api<Tag>("/api/tags", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    setTags((current) =>
      [...current, created].sort((a, b) => a.name.localeCompare(b.name)),
    );
    return created;
  };

  const createCategory = async (name: string): Promise<Category> => {
    const created = await api<Category>("/api/categories", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    setCategories((current) =>
      [...current, created].sort((a, b) => a.name.localeCompare(b.name)),
    );
    return created;
  };

  const createPerson = async (name: string): Promise<Person> => {
    const created = await api<Person>("/api/people", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    setPeople((current) =>
      [...current, created].sort((a, b) => a.name.localeCompare(b.name)),
    );
    return created;
  };

  const [initializing, setInitializing] = useState(true);
  const startupScanned = useRef(false);
  useEffect(() => {
    let mounted = true;
    void Promise.all([loadSources(), loadCategories(), loadTags(), loadPeople()]).finally(() => { if (mounted) setInitializing(false); });
    return () => { mounted = false; };
  }, [loadSources, loadCategories, loadTags, loadPeople]);

  // Pick up new media once per app launch; failures are silent because a manual rescan reports errors.
  useEffect(() => {
    if (initializing || startupScanned.current) return;
    startupScanned.current = true;
    void (async () => {
      try {
        await api("/api/sources/scan", { method: "POST", body: JSON.stringify({ englishAttributes: true, refactorFilenames: false, confirmFilenameChanges: false }) });
        const music = await api<Array<{ id: number; enabled?: number; path_available?: boolean; status: string }>>("/api/music/sources");
        await Promise.all(music.filter((source) => source.enabled !== 0 && source.path_available !== false && source.status !== "scanning").map((source) => api(`/api/music/sources/${source.id}/scan`, { method: "POST" })));
        await loadSources(true);
      } catch { /* ignored */ }
    })();
  }, [initializing, loadSources]);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let wasRunning = false;
    const poll = async () => {
      try {
        const repair = await api<{ status: string } | null>("/api/people/matching/repair");
        if (stopped) return;
        if (repair?.status === "running") { wasRunning = true; timer = setTimeout(() => void poll(), 1500); }
        else if (wasRunning) { void loadPeople(); setRefreshKey((value) => value + 1); }
      } catch { if (!stopped && wasRunning) timer = setTimeout(() => void poll(), 3000); }
    };
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [loadPeople]);

  // Older history entries may still point to the former standalone management pages.
  useEffect(() => {
    if (
      section === "tags" ||
      section === "categories" ||
      section === "people" ||
      section === "sources" ||
      section === "settings"
    ) {
      openManagement(section);
      navigation.update({ section: "home" }, "Home");
    }
  }, [section, openManagement]);

  const isScanning = useMemo(
    () => sources.some((source) => source.status === "scanning") || musicSources.some((source) => source.status === "scanning"),
    [sources, musicSources],
  );
  const scanningSourceKey = useMemo(
    () =>
      sources
        .filter((source) => source.status === "scanning")
        .map((source) => source.id)
        .sort((a, b) => a - b)
        .join(","),
    [sources],
  );
  const availableSourceKey = useMemo(
    () =>
      sources
        .filter((source) => source.enabled !== 0 && source.path_available)
        .map((source) => source.id)
        .sort((a, b) => a - b)
        .join(","),
    [sources],
  );
  const previousAvailableSourceKey = useRef<string | null>(null);
  useEffect(() => {
    if (previousAvailableSourceKey.current === null) {
      previousAvailableSourceKey.current = availableSourceKey;
      return;
    }
    if (previousAvailableSourceKey.current !== availableSourceKey) {
      previousAvailableSourceKey.current = availableSourceKey;
      setRefreshKey((value) => value + 1);
      void loadCategories();
      void loadTags();
      void loadPeople();
    }
  }, [availableSourceKey, loadCategories, loadTags, loadPeople]);
  useEffect(() => {
    // During rescan-all, refresh large attribute lists once after the final source finishes.
    if (previousScanningSourceKey.current && !scanningSourceKey) {
      void loadSources(true);
      setRefreshKey((value) => value + 1);
      void loadCategories();
      void loadTags();
      void loadPeople();
    }
    previousScanningSourceKey.current = scanningSourceKey;
  }, [scanningSourceKey, loadSources, loadCategories, loadTags, loadPeople]);
  useEffect(() => {
    let polling = false;
    let stopped = false;
    const timer = window.setInterval(
      async () => {
        if (polling) return;
        polling = true;
        try {
          if (isScanning) {
            setMusicSources(await api<MusicSource[]>("/api/music/sources"));
            const updates = await api<
              Array<
                Pick<
                  LibrarySource,
                  | "id"
                  | "status"
                  | "last_error"
                  | "last_scanned_at"
                  | "scan_progress"
                >
              >
            >("/api/sources/scan/progress");
            if (stopped) return;
            const byId = new Map(updates.map((update) => [update.id, update]));
            setSources((current) =>
              current.map((source) => ({ ...source, ...byId.get(source.id) })),
            );
          } else await loadSources(true);
        } catch {
          if (!stopped) await loadSources(true);
        } finally {
          polling = false;
        }
      },
      isScanning ? 1000 : 5000,
    );
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [isScanning, loadSources]);

  const attributeOptions: SourceAttributeOptions = {
    tags,
    categories,
    onTagCreated: createTag,
    onCategoryCreated: createCategory,
  };
  const totalItems = sources
    .filter((source) => source.enabled !== 0 && source.path_available)
    .reduce((total, source) => total + source.item_count, 0);
  const sectionNames: Record<Section, string> = {
    home: "Home",
    music: "Music library",
    youtube: "YouTube library",
    all: "All media",
    comic: "Comics & pictures",
    video: "Videos",
    story: "E-books",
    categories: "Categories",
    tags: "Tags",
    people: "Cast & artists",
    sources: "Sources",
    settings: "Settings",
    help: "Help & shortcuts",
  };
  const selectSection = (nextSection: Section) => {
    navigation.reset(
      { section: nextSection, libraryView: "browse", search: "" },
      sectionNames[nextSection],
    );
  };
  const selectLibraryView = (view: LibraryView) => {
    navigation.reset(
      {
        section,
        libraryView: view,
        search: "",
        "SeriesView.entityView": view === "circles" ? "circles" : "sets",
      },
      sectionNames[section] + " · " + view,
    );
  };
  const openSeries = (id: number) =>
    navigation.push(
      {
        selectedSeriesId: id,
        "SeriesView.selectedId": id,
        "SeriesView.entityView": "sets",
        selectedItemId: null,
        viewerSeriesContext: null,
        viewerFloating: false,
        libraryView: "series",
      },
      "Collection",
    );
  const refreshMedia = () => {
    setRefreshKey((value) => value + 1);
    void loadCategories();
    void loadTags();
    void loadPeople();
  };
  const attributesChanged = () => {
    refreshMedia();
    setAttributeRevision((value) => value + 1);
  };
  const openItem = (
    id: number,
    context: SeriesViewerContext | null = null,
    gallery: GalleryVideoContext | null = null,
  ) => {
    // Opening another file replaces whatever player was floating or minimized.
    setViewerMinimized(false);
    setFloatingSession(null);
    setYoutubeSession(null);
    navigation.push(
      {
        selectedItemId: id,
        viewerSeriesContext: context,
        viewerGalleryContext: gallery,
        viewerFloating: false,
      },
      gallery?.videos.find((item) => item.id === id)?.title ??
        context?.items.find((item) => item.id === id)?.title ??
        `File ${id}`,
    );
  };
  const closePageViewer = () => {
    const origin = [...navigation.entry.breadcrumbs]
      .reverse()
      .find((crumb) => !crumb.viewer);
    if (origin) navigation.goTo(origin.id);
    else
      navigation.update({
        selectedItemId: null,
        viewerSeriesContext: null,
        viewerGalleryContext: null,
        viewerFloating: false,
      });
  };
  const queueVideo = (item: MediaItem) => {
    setTemporaryPlaylist((current) =>
      current.some((entry) => entry.id === item.id)
        ? current
        : [...current, item],
    );
    if (activeViewerId === null)
      setFloatingSession({ id: item.id, series: null, gallery: null });
    else if (!floatingSession && selectedItemId !== null)
      setFloatingSession({
        id: selectedItemId,
        series: viewerSeriesContext,
        gallery: viewerGalleryContext,
      });
  };
  const [refactorAllFilenames, setRefactorAllFilenames] = useState(false);
  const [confirmAllRefactoring, setConfirmAllRefactoring] = useState(false);
  const refactoringSources = sources.filter((source) => source.enabled !== 0 && source.filename_refactoring && (!rescanMediaType || source.media_type === rescanMediaType));
  const rescanAll = async (englishAttributes = true, confirmed = false) => {
    if (refactorAllFilenames && refactoringSources.length && !confirmed) { setConfirmAllRefactoring(true); return; }
    setConfirmAllRefactoring(false);
    setRescanningAll(true);
    setError("");
    try {
      if (!rescanMediaType || rescanMediaType === "music") await Promise.all(musicSources.map((source) => api(`/api/music/sources/${source.id}/scan`, { method: "POST" })));
      if (rescanMediaType !== "music") await api("/api/sources/scan", {
        method: "POST",
        body: JSON.stringify({ englishAttributes, refactorFilenames: refactorAllFilenames && refactoringSources.length > 0, confirmFilenameChanges: confirmed, ...(rescanMediaType && { mediaType: rescanMediaType }) }),
      });
      await loadSources(true);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not rescan all sources.",
      );
    } finally {
      setRescanningAll(false);
    }
  };

  const cancelAllScans = async () => {
    setRescanningAll(true);
    setError("");
    try {
      await Promise.all(musicSources.filter((source) => source.status === "scanning").map((source) => api(`/api/music/sources/${source.id}/cancel`, { method: "POST" })));
      await api("/api/sources/scan/cancel", { method: "POST" });
      await loadSources(true);
      refreshMedia();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not cancel scans.",
      );
    } finally {
      setRescanningAll(false);
    }
  };

  const viewerCommonProps = {
    attributeRevision,
    categories,
    tags,
    people,
    playlist: temporaryPlaylist.map(({ id, title }) => ({ id, title })),
    onRemoveFromPlaylist: (id: number) =>
      setTemporaryPlaylist((current) =>
        current.filter((item) => item.id !== id),
      ),
    onClearPlaylist: () => setTemporaryPlaylist([]),
    onCategoryCreated: createCategory,
    onTagCreated: createTag,
    onPersonCreated: createPerson,
    onOpenSeries: openSeries,
    onChanged: refreshMedia,
  };

  const sourcesPanel = (
    <div className="sources-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Library setup</p>
          <h1>Sources</h1>
          <p>
            Browse folders by drive and path. Disable a source to hide its
            content. Expand a source for attributes, scanning, and conversion.
          </p>
        </div>
        <div className="page-heading-actions">
          {isScanning ? (
            <button
              className="secondary-button"
              type="button"
              onClick={() => void cancelAllScans()}
              disabled={rescanningAll}>
              {rescanningAll ? (
                <LoaderCircle className="spin" size={18} />
              ) : (
                <X size={18} />
              )}{" "}
              {rescanningAll ? "Cancelling…" : "Cancel all scans"}
            </button>
          ) : (<>
            <Select aria-label="Rescan media type" value={rescanMediaType} onChange={(event) => setRescanMediaType(event.target.value)} disabled={rescanningAll}>
              <option value="">All source media types</option>
              <option value="movies">Movies only</option>
              <option value="tv">TV series only</option>
              <option value="anime">Anime only</option>
              <option value="manga">Manga / comics only</option>
              <option value="ebooks">E-books / documents only</option>
              <option value="pictures">Pictures only</option>
              <option value="music">Music / music videos only</option>
              <option value="mixed">Legacy mixed media only</option>
            </Select>
            <Select aria-label="Scan options" value={refactorAllFilenames ? "refactor" : "scan"} onChange={(event) => setRefactorAllFilenames(event.target.value === "refactor")} disabled={rescanningAll}>
              <option value="scan">Scan</option>
              <option value="refactor" disabled={!refactoringSources.length}>Scan + refactor enabled sources</option>
            </Select>
            <button
              className="secondary-button"
              type="button"
              onClick={() => void rescanAll()}
              disabled={rescanningAll || combinedSources.length === 0}>
              {rescanningAll ? (
                <LoaderCircle className="spin" size={18} />
              ) : (
                <RefreshCw size={18} />
              )}{" "}
              Rescan all
            </button>
          </>)}
          <button
            className="primary-button"
            type="button"
            onClick={() => { setNewSourceType(""); setShowAddSource(true); }}>
            <Plus size={18} /> Add source
          </button>
        </div>
      </div>

      <section className="summary-strip" aria-label="Source summary">
        <div>
          <span>Folders</span>
          <strong>{formatCount(combinedSources.length)}</strong>
        </div>
        <div>
          <span>Indexed items</span>
          <strong>{formatCount(totalItems + musicSources.reduce((sum, source) => sum + source.track_count, 0))}</strong>
        </div>
        <div>
          <span>Storage</span>
          <strong>Local</strong>
        </div>
        <div className="summary-message">
          <span className="pulse-dot" /> Your media stays on this computer
        </div>
      </section>

      {error && (
        <div className="page-error" role="alert">
          {error}
          <button type="button" onClick={() => loadSources()}>
            Try again
          </button>
        </div>
      )}

      {loading && combinedSources.length === 0 ? (
        <div className="loading-state">
          <LoaderCircle className="spin" size={28} />
          <span>Loading sources…</span>
        </div>
      ) : combinedSources.length > 0 ? (
        <SourcesBrowser
          sources={combinedSources}
          renderSource={(source, expanded, toggle) => source.media_type === "music" ? (
            <MusicSourceCard source={musicSources.find((entry) => entry.id === -source.id)!} expanded={expanded} onToggle={toggle} onChanged={() => void loadSources(true)} />
          ) : (
            <SourceCard
              key={source.id}
              source={source}
              expanded={expanded}
              onToggle={toggle}
              {...attributeOptions}
              onChanged={() => {
                void loadSources(true);
                refreshMedia();
              }}
            />
          )}
        />
      ) : (
        <section className="empty-state">
          <div className="empty-visual">
            <div className="folder-back" />
            <div className="folder-front">
              <Image size={29} />
              <Clapperboard size={29} />
              <BookOpen size={29} />
            </div>
          </div>
          <h2>Connect your media folders</h2>
          <p>
            Add one or more folders. Choose a media type for each source to keep
            books, pictures, and videos organized.
          </p>
          <button
            className="primary-button"
            type="button"
            onClick={() => setShowAddSource(true)}>
            Choose a folder <ChevronRight size={18} />
          </button>
          <span>Nothing is uploaded or moved.</span>
        </section>
      )}

      {confirmAllRefactoring && <FilenameRefactoringDialog sourceNames={refactoringSources.map((source) => source.name)} onClose={() => setConfirmAllRefactoring(false)} onConfirm={() => void rescanAll(true, true)} />}
      {showAddSource && (
        <AddSourceDialog
          initialMediaType={newSourceType}
          {...attributeOptions}
          onClose={() => setShowAddSource(false)}
          onAdded={() => {
            void loadSources(true);
            refreshMedia();
          }}
        />
      )}
    </div>
  );

  return (
    <AttributeManagerContext.Provider
      value={{
        open: openAttributeManager,
        isOpen: managementOpen && !managementMinimized,
      }}>
      <PersonDirectoryContext.Provider value={people}>
      <AttributeBrowseProvider>
        <div className={`app-shell${section === "music" ? " app-shell--music" : section === "youtube" ? " app-shell--youtube" : ""}${sidebarHidden ? " app-shell--sidebar-hidden" : ""}`} style={{ "--app-sidebar-width": `${Math.max(200, Math.min(400, sidebarWidth))}px` } as CSSProperties}>
          {initializing && <div className="app-startup-overlay" role="status" aria-live="polite"><LoaderCircle className="spin" size={32} /><strong>Loading your library…</strong><span>Reading sources and metadata</span></div>}
          <aside className="sidebar" id="app-navigation" aria-label={section === "music" ? "Music navigation" : "Library navigation"} hidden={sidebarHidden}>
            <div className="brand">
              <div className="brand-mark">
                <Library size={21} />
              </div>
              <span>Vaultly</span>
              <button className="sidebar-hide-button" type="button" aria-label="Hide navigation panel" title="Hide navigation panel" onClick={() => setSidebarHidden(true)}><PanelLeftClose size={17} /></button>
            </div>
            {section === "music" && <button className="music-back-to-library secondary-button" type="button" onClick={() => selectSection("home")}><ArrowLeft size={15} /> Media libraries</button>}
            <div className="music-navigation-host music-root" ref={setMusicSidebarHost} hidden={section !== "music"} />
            <nav aria-label="Main navigation" hidden={section === "music"}>
              <p>Library</p>
              <button
                className={section === "home" ? "nav-active" : "nav-link"}
                type="button"
                onClick={() => selectSection("home")}>
                <Home size={19} /> Home<span>{formatCount(totalItems)}</span>
              </button>
              <LibraryNav
                active={section === "comic"}
                view={libraryView}
                icon={<Image size={19} />}
                label="Comics & pictures"
                onBrowse={() => selectSection("comic")}
                onView={selectLibraryView}
              />
              <LibraryNav
                active={section === "video"}
                view={libraryView}
                icon={<Clapperboard size={19} />}
                label="Videos"
                onBrowse={() => selectSection("video")}
                onView={selectLibraryView}
              />
              <LibraryNav
                active={section === "story"}
                view={libraryView}
                icon={<BookOpen size={19} />}
                label="E-books"
                onBrowse={() => selectSection("story")}
                onView={selectLibraryView}
              />
              <button className={section === "music" ? "nav-active" : "nav-link"} type="button" onClick={() => selectSection("music")}><Music2 size={19} /> Music</button>
              <button className={section === "youtube" ? "nav-active" : "nav-link"} type="button" onClick={() => selectSection("youtube")}><ListVideo size={19} /> YouTube</button>
              <p>Workspace</p>
              <button
                className={
                  managementOpen &&
                  !managementMinimized &&
                  managementTab === "sources"
                    ? "nav-active"
                    : "nav-link"
                }
                type="button"
                onClick={() => openManagement("sources")}>
                <HardDrive size={19} /> Sources
              </button>
              <button
                className={
                  managementOpen &&
                  !managementMinimized &&
                  managementTab === "settings"
                    ? "nav-active"
                    : "nav-link"
                }
                type="button"
                onClick={() => openManagement("settings")}>
                <Settings2 size={19} /> Settings
              </button>
              <button
                className={section === "help" ? "nav-active" : "nav-link"}
                type="button"
                onClick={() => selectSection("help")}>
                <CircleHelp size={19} /> Help
              </button>
            </nav>
            <BackgroundStatus onOpen={openManagement} />
            {!sidebarHidden && <SidebarResizeHandle width={sidebarWidth} onResize={setSidebarWidth} />}
          </aside>

          <main>
            <div className={`app-header${compactHeader ? " is-compact" : ""}`}>
            <header className="topbar">
              <button className="sidebar-toggle" type="button" aria-label={sidebarHidden ? "Show navigation panel" : "Hide navigation panel"} title={sidebarHidden ? "Show navigation panel" : "Hide navigation panel"} aria-controls="app-navigation" aria-expanded={!sidebarHidden} onClick={() => setSidebarHidden((value) => !value)}>{sidebarHidden ? <PanelLeftOpen size={19} /> : <PanelLeftClose size={19} />}</button>
              <Select className="library-mode-select" aria-label="Library mode" value={section} onChange={(event) => selectSection(event.target.value as Section)}>{(["home", "all", "video", "comic", "story", "music", "youtube", "help"] as const).map((mode) => <option key={mode} value={mode}>{sectionNames[mode]}</option>)}</Select>
              <div className="search-box">
                <Search size={19} />
                <ClearableInput
                  aria-label={section === "music" ? "Search music library" : section === "youtube" ? "Search YouTube library" : "Search library"}
                  placeholder={section === "music" ? "Search tracks, artists, albums, tags…" : "Search your library"}
                  value={search}
                  onChange={(event) => {
                    const nextSearch = event.target.value;
                    if (section === "music" || section === "youtube") { setSearch(nextSearch); return; }
                    if (["all", "video", "comic", "story"].includes(section) && libraryView !== "series" && libraryView !== "circles") { setSearch(nextSearch); return; }
                    if (
                      nextSearch &&
                      (section !== "all" || libraryView !== "browse")
                    )
                      navigation.push(
                        {
                          section: "all",
                          libraryView: "browse",
                          search: nextSearch,
                          selectedItemId: null,
                        },
                        "Search results",
                      );
                    else setSearch(nextSearch);
                  }}
                />
              </div>
              <div className="topbar-actions">
                <ThemeToggle />
                <VaultProfiles initial={profiles} />
                {temporaryPlaylist.length > 0 && (
                  <button
                    className="playlist-launch"
                    type="button"
                    onClick={() => openItem(temporaryPlaylist[0].id)}>
                    <ListVideo size={17} /> Temporary playlist{" "}
                    <strong>{temporaryPlaylist.length}</strong>
                  </button>
                )}
                <div className="local-pill">
                  <span /> Local only
                </div>
              </div>
            </header>

            </div>

            <MusicWorkspace sourceRevision={musicSources.map((source) => `${source.id}:${source.status}:${source.track_count}:${source.last_scanned_at}`).join("|")} onOpenSources={() => openManagement("sources")} onAddSource={() => { setNewSourceType("music"); openManagement("sources"); setShowAddSource(true); }} visible={section === "music"} search={section === "music" ? search : ""} sidebarHost={musicSidebarHost} />
            <div className="content" hidden={section === "music"}>
              <nav className="navigation-trail" aria-label="Navigation history">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={navigation.back}
                  disabled={!navigation.entry.breadcrumbs.length}>
                  <ArrowLeft size={16} /> Back
                </button>
                {navigation.entry.breadcrumbs.map((crumb) => (
                  <span key={crumb.id}>
                    <button
                      type="button"
                      onClick={() => navigation.goTo(crumb.id)}>
                      {crumb.label}
                    </button>
                    <ChevronRight size={14} />
                  </span>
                ))}
                <strong aria-current="page">{navigation.entry.label}</strong>
              </nav>
              {section === "music" ? null : section === "youtube" ? <YoutubeLibrary search={search} onSearchChange={setSearch} onPlay={(playback) => { setFloatingSession(null); setViewerMinimized(false); setYoutubeSession({ playback, floating: false, pageKey: youtubePageKey }); }} /> : section === "home" ? (
                <HomeView
                  sources={sources}
                  categories={categories}
                  onOpenLibrary={selectSection}
                  onOpenCategories={() =>
                    navigation.push(
                      { section: "all", libraryView: "categories", search: "" },
                      "All media categories",
                    )
                  }
                  onAddSource={addSource}
                />
              ) : section === "help" ? (
                <HelpView
                  onOpenSources={() => openManagement("sources")}
                  onOpenSettings={() => openManagement("settings")}
                />
              ) : section === "categories" ||
                section === "tags" ||
                section === "people" ||
                section === "sources" ||
                section === "settings" ? null : libraryView === "series" ||
                libraryView === "circles" ? (
                <SeriesView
                  key={`${navigation.entry.pageId ?? navigation.entry.id}-${section}-${libraryView}-${selectedSeriesId ?? "list"}`}
                  view="browse"
                  initialEntityView={
                    libraryView === "circles" ? "circles" : "sets"
                  }
                  mediaType={section === "all" ? undefined : section}
                  initialSeriesId={selectedSeriesId}
                  people={people}
                  onPersonCreated={createPerson}
                  onPeopleChanged={() => { void loadPeople(); setRefreshKey((value) => value + 1); }}
                  categories={categories}
                  tags={tags}
                  onCategoryCreated={createCategory}
                  onTagCreated={createTag}
                  onCategoriesChanged={() => void loadCategories()}
                  onTagsChanged={() => void loadTags()}
                  onOpenItem={(id, context) => openItem(id, context)}
                />
              ) : (
                <GalleryView
                  key={`${navigation.entry.pageId ?? navigation.entry.id}-${section}-${libraryView}`}
                  view={libraryView}
                  type={section === "all" ? undefined : section}
                  search={search}
                  onSearchChange={setSearch}
                  categories={categories}
                  tags={tags}
                  people={people}
                  onTagCreated={createTag}
                  onCategoryCreated={createCategory}
                  onPersonCreated={createPerson}
                  onChanged={refreshMedia}
                  onDeleted={(ids) => {
                    setTemporaryPlaylist((items) => items.filter((item) => !ids.includes(item.id)));
                    setFloatingSession((session) => session && ids.includes(session.id) ? null : session);
                    void loadSources(true);
                  }}
                  sources={sources
                    .filter(
                      (source) => source.enabled !== 0 && source.path_available,
                    )
                    .map((source) => ({ id: source.id, name: source.name }))}
                  onOpen={(id, context) => openItem(id, null, context)}
                  onQueueVideo={queueVideo}
                  queuedVideoIds={temporaryPlaylist.map((item) => item.id)}
                  onOpenSeries={openSeries}
                  onAddSource={addSource}
                  refreshKey={refreshKey}
                />
              )}
            </div>
          </main>

          {youtubeSession && <YoutubePlayer playback={youtubeSession.playback}
            floating={youtubeSession.floating || youtubeSession.pageKey !== youtubePageKey}
            onToggleFloating={() => setYoutubeSession({ ...youtubeSession, floating: !(youtubeSession.floating || youtubeSession.pageKey !== youtubePageKey), pageKey: youtubePageKey })}
            onClose={() => setYoutubeSession(null)} />}
          {activeViewerId !== null && (
            <MediaViewer
              {...viewerCommonProps}
              itemId={activeViewerId}
              seriesContext={
                floatingSession ? floatingSession.series : viewerSeriesContext
              }
              galleryContext={
                floatingSession ? floatingSession.gallery : viewerGalleryContext
              }
              floating={viewerFloating}
              minimized={viewerMinimized !== false}
              onMinimize={minimizeViewer}
              onRestore={restoreViewer}
              onToggleFloating={toggleFloating}
              onNavigateItem={navigateViewer}
              onNavigatePlaylistItem={(id) => {
                if (floatingSession)
                  setFloatingSession({ id, series: null, gallery: null });
                else
                  navigation.push(
                    {
                      selectedItemId: id,
                      viewerGalleryContext: null,
                      viewerSeriesContext: null,
                    },
                    `File ${id}`,
                  );
              }}
              onClose={() => {
                setViewerMinimized(false);
                if (floatingSession) {
                  setFloatingSession(null);
                  if (selectedItemId === floatingSession.id)
                    navigation.update({ selectedItemId: null });
                } else closePageViewer();
              }}
            />
          )}
          {floatingSession !== null &&
            selectedItemId !== null &&
            selectedItemId !== floatingSession.id && (
              <MediaViewer
                {...viewerCommonProps}
                itemId={selectedItemId}
                seriesContext={viewerSeriesContext}
                galleryContext={viewerGalleryContext}
                floating={false}
                onToggleFloating={() => {
                  setFloatingSession({
                    id: selectedItemId,
                    series: viewerSeriesContext,
                    gallery: viewerGalleryContext,
                  });
                  navigation.update({ selectedItemId: null });
                }}
                onNavigateItem={(id) =>
                  navigation.push({ selectedItemId: id }, `File ${id}`)
                }
                onNavigatePlaylistItem={(id) =>
                  navigation.push(
                    {
                      selectedItemId: id,
                      viewerGalleryContext: null,
                      viewerSeriesContext: null,
                    },
                    `File ${id}`,
                  )
                }
                onClose={closePageViewer}
              />
            )}
          <ManagementDrawer
            open={managementOpen}
            minimized={managementMinimized}
            expanded={managementExpanded}
            active={managementTab}
            visited={managementVisited}
            onOpen={openManagement}
            onClose={() => setManagementOpen(false)}
            onMinimize={() => setManagementMinimized((value) => !value)}
            onExpand={() => setManagementExpanded((value) => !value)}
            panels={{
              tags: <TagsView tags={tags} onChanged={attributesChanged} />,
              categories: (
                <CategoriesView
                  categories={categories}
                  onChanged={attributesChanged}
                />
              ),
              people: (
                <PeopleView people={people} onChanged={attributesChanged} creditFilterRequest={peopleFilterRequest} />
              ),
              sources: sourcesPanel,
              settings: <SettingsView />,
            }}
          />
        </div>
      </AttributeBrowseProvider>
      </PersonDirectoryContext.Provider>
    </AttributeManagerContext.Provider>
  );
}
