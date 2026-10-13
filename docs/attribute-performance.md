# Attribute import performance

Checked on the local Windows development machine with 12,000 people, tags, and categories and 12,000 indexed video filenames. Each imported record has one alternative pattern. Names share common words to exercise the filename matcher's candidate lookup. People also include all supported profile fields.

Dedicated benchmark results (rounded; timing varies with other processes):

| Operation | Time |
| --- | ---: |
| Import 12,000 people and assign credits | 1.02 s |
| Reimport those people without duplicate assignments | 0.79 s |
| Fetch the complete people list with credit counts and patterns | 0.22 s |
| Import 12,000 tags and assign them | 0.55 s |
| Fetch the complete tag list | 0.05 s |
| Import 12,000 categories and assign them | 0.29 s |
| Fetch the complete category list | 0.05 s |
| Build the filename matcher for 12,000 people and patterns | 76 ms |
| Match 12,000 reordered names, including correctness assertions | 150 ms |
| Sort 12,000 attributes in the web search helper | 18–20 ms |
| Search 12,000 attributes by alternative pattern | 60–78 ms |

The complete people response is approximately 4 MB. Earlier runs measured people imports between 0.68 and 1.55 seconds, depending on concurrent test load. These are local API injection and JavaScript helper measurements, not browser rendering or network latency measurements.

## Changes

- The importer prepares SQL once per upload and updates profile fields in one statement per record. The transaction still validates the complete input before writing and rolls back on failure.
- Filename matching uses phrase word counts and sorted word signatures, avoiding scans of thousands of names that share common words. Joined-name matching retains its existing behavior.
- Media indexing iterates SQLite rows instead of copying the whole media table into a JavaScript array.
- Attribute sorting reuses one `Intl.Collator`; filtering normalizes the query once and skips text normalization for an empty query.
- Attribute managers memoize filtering and sorting, and render 100 records per page. Pickers render at most 100 matches and ask users to refine their search for additional results.
- JSON uploads permit up to 50,000 records, within the existing 20 MB size limit. The benchmark verifies 12,000 records; the maximum is a validation limit, not a measured performance guarantee.

## Remaining limits

List APIs still return every attribute, so data transfer and client memory grow with the total count. Import and database work run synchronously on the server; larger media libraries can briefly delay other requests. Joined names can still require checking several same-length candidates. These measurements do not establish performance at hundreds of thousands of attributes or media items.

## Reproduce

From `apps/api`, run `node node_modules/vitest/vitest.mjs run src/attribute-performance.test.ts --maxWorkers=1 --no-file-parallelism`. The benchmark creates an isolated temporary vault and reports `ATTRIBUTE_PERFORMANCE` measurements.

From `apps/web`, run `node node_modules/vitest/vitest.mjs run src/attribute-search.test.ts src/ManagementEditors.test.tsx`. These tests report helper timings and verify that all three managers render at most 100 records and reset pagination when searching.
