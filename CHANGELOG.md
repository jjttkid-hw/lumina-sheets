# Changelog

## Unreleased

- Rebuilt the 0.29.0 candidate with `SOURCE_DATE_EPOCH=1790122493`; the site digest is `791a5888cb5672e3a597062cfc4441a689db8597e26d6dfd32ecf3f1f6a07268` and the SDK archive digest is `619a3196bd784e082833bdc8e14383896410fb0e698dde781b2161adb55a26fb`. Both repeated builds are byte-identical. The npm package is still not present in the public registry, so this remains a development candidate.
- Add IRR and RATE financial examples to the report demo so the shipped commercial finance formulas are visible and regression-tested alongside the SDK engine.
- Expose `productBuildIdentity()` from the browser SDK so hosts can record the embedded version, source fingerprint and build timestamp when diagnosing a production report. The value is diagnostic metadata and may be `null` for unbundled development code.

## 0.29.0 — Canvas draft ownership, local verification

- Verify Chrome, Firefox and WebKit with 30 browser groups each, plus three Chromium touch-emulation groups. Preserve artifact-bound reports and distinguish physical mobile, Safari, native IME and screen-reader work still pending.
- Prevent delayed workspace address synchronization from replacing a newly typed destination and writing to the wrong cell.
- Include exact-source evidence and upstream MIT text for embedded elliptic 6.5.4. Dependency license review still blocks npm publication: four review items and 67 embedded components remain unresolved.

- Always release the IndexedDB connection during `close()`, even when a pending snapshot or flush fails. The original save error is rethrown after cleanup so callers can retry without leaving another page blocked.

- Validate target journal sequences before snapshot cleanup and explicitly abort on cursor callback failures. Malformed sequence values are no longer coerced into deletion eligibility; snapshot writes, journal deletions and pending-edit acknowledgement remain behind transaction completion.

- Keep the durable backend after a previously opened database fails to reconnect. Reject both asynchronous and synchronous reopen failures, retain queued edits for retry, and avoid silently replacing an existing persisted workspace with an empty memory adapter.

- Reopen IndexedDB after unexpected connection closure or explicit persistence close. Only the owning connection may invalidate the cached open promise; stale close/versionchange events cannot evict its replacement.

- Reject blocked database upgrades with a retryable startup error, discard late abandoned open events, and close connections on versionchange. Newer incompatible database versions now reject rather than silently opening an empty memory workspace.

- Rescue raw workbook/journal/comment/revision stores when normal workbook replay fails. Read stores independently without migration or writes; offer raw snapshots as explicitly labeled independent recovery copies while retaining unapplied journals.

- Validate journal patch discriminants, targets, canonical cell addresses, cell payload presence and metadata containers before enqueue/replay. Reject malformed patches rather than interpreting unknown kinds as metadata updates; preserve original workbooks on batch failure.

- Assign stable UUID identities to new journal edits and preserve them on retries. Distinct same-sequence edits no longer share an IndexedDB key or disappear during replay deduplication; legacy records remain readable and tied sequences have deterministic identity ordering. This does not provide collaborative merge or concurrent snapshot safety.

- Advance local journal sequencing past observed persisted edits on single/all-workbook reads, preventing clock rollback from placing new edits before older journal entries. Reject invalid or exhausted sequence numbers without enqueueing an unsafe write; cross-tab atomic sequencing remains unsupported.

- Ignore auxiliary read/write completions after workspace unmount, and stop starting delayed auxiliary reads after their view loses ownership while awaiting a prior write. Already-started saves still finish without late UI updates.

- Request native leave confirmation while workbook saves are pending/failed, storage is memory-only, or auxiliary writes are pending. Clear workbook risk only after the latest durable save and remove the listener on unmount.

- Search recovery snapshots by workbook name, source, version label or timestamp. Preserve original selection indexes, require a visible selection before restore, and prevent search Enter from triggering recovery.

- Offer current and legacy historical workbook snapshots in recovery selection with version/time labels. Restore each as an independent validated copy, retain damaged entries and source files, and include all history snapshots in the combined 1,000-entry limit.

- Distinguish absent auxiliary records from stored null/malformed records. Preserve present damaged comment/history payloads for validation and recovery instead of substituting empty lists and reporting complete backups.

- Recheck the legacy migration marker inside the migration write transaction. A stale preflight read from another page can no longer reimport records removed after a completed migration.

- Retain null/scalar snapshots and malformed IndexedDB row envelopes during directory reads instead of aborting all document recovery. Continue replaying valid document journals and leave stored originals untouched for validation and rescue.

- Queue each legacy workbook ID only once before migration. Prevent same-transaction duplicate existence checks from scheduling competing writes; consistently select the first source snapshot while retaining all original versions for explicit recovery.

- Preserve existing primary workbook, comment and revision records during legacy migration. Import only absent keys, including preservation of intentionally empty auxiliary lists; IndexedDB checks and writes share the migration readwrite transaction. Raw legacy recovery sources remain untouched.

- Stop workspace hydration when primary snapshots are damaged and no valid active document remains, preventing stale local fallback snapshots from being saved over unreadable primary data. Keep valid documents usable with a persistent warning and recovery download when only part of the directory is damaged.

- Keep JSON-serializable malformed primary workbook directories in partial recovery exports instead of aborting rescue or treating strings as workbook lists. Preserve legacy snapshots and skip auxiliary reads for invalid directories.

- Restore workbook snapshots directly from legacy documents and recycle-bin sections of recovery bundles, including bundles with an empty primary directory. Label sources, preserve separate same-ID versions, enforce a combined 1,000-entry limit and show malformed-list warnings while keeping other snapshots available.

- Add recovery download to failed workspace startup, sharing export/URL cleanup with crash recovery. Keep readable workbooks and raw damaged storage in partial bundles; suppress late downloads after startup succeeds or the view unmounts.

- Load recycle-bin data through strict directory checks during workspace hydration. Damaged JSON, invalid display metadata and duplicate IDs show a retryable startup error before new workspace snapshots are queued; original storage is retained.

- Serialize recycle-bin mutations with an origin-scoped exclusive Web Lock when available. Read current storage and verify sources after acquisition, retain edits made while archiving waits, and never fall back to unlocked writes on lock failure. Browsers without Web Locks retain the synchronous fallback without cross-tab exclusion guarantees.

- Re-read recycle-bin storage for mutations and verify the restored source before and after asynchronous saving. Preserve newer archived snapshots and unrelated entries; unreadable or corrupt directories no longer fall back to an empty write target.

- Save restored recycle-bin workbooks before removing their recovery source. Keep the source on write/cleanup failure or memory-only storage, prevent overlapping restores, and allow retries through the save queue.

- Validate comment navigation before changing the active sheet or selection. Missing, out-of-range or hidden targets leave the panel open with an error; valid merged targets resolve to the anchor and clear search/filter state.

- Keep damaged workbook-directory entries in recovery backups and continue rescuing valid books. Isolate synchronous auxiliary-reader failures alongside asynchronous failures; partial-export messaging now covers corrupted records too.

- Mark recovery backups partial when loaded auxiliary metadata or legacy list containers are malformed. Include section/key warnings while retaining original records and raw legacy bytes; successful reads alone no longer hide these defects.

- Validate loaded comment and revision metadata before displaying or editing lists. Malformed records and duplicate IDs show a retryable read error instead of crashing panels or allowing a destructive overwrite; raw stored data remains unchanged.

- Skip malformed non-list legacy revision/comment containers during migration instead of aborting workbook loading or persisting invalid lists. Preserve the original localStorage backup for recovery.

- Capture compaction snapshots and journal cutoffs at invocation. Preserve edits arriving while compaction waits, isolate caller mutations and other workbooks, then flush the remaining journal before completion.

- Validate plain shared and inline string structures as well as rich strings. Reject duplicate text nodes, nested text elements and unsupported phonetic metadata rather than silently concatenating or discarding content; retain valid empty strings.

- Bound XLSX rich-text expansion across worksheets before cloning each cell: at most 8 million UTF-16 text units and 100,000 runs, including empty runs. Reject oversized shared-string expansion before ExcelJS decoding; preserve exact-boundary content and isolated cell runs.

- Reject unknown XLSX cell types before decoding instead of treating their payload as a numeric prefix. Preserve standard scalar types and the default numeric type; failed imports retain workbook history.

- Import ISO date cells (`t=d`) as verified 1900 date serials instead of letting ExcelJS parse only the year. Validate calendar/time/zone fields, normalize explicit offsets to UTC and retain source number formats; export uses numeric serials.

- Yield during XLSX rich-text cell extraction using cell, text and run-count budgets. Check cancellation between cells and after yields; normal extraction retains independent run arrays and complete results.

- Propagate XLSX import cancellation into shared-string rereads and use cooperative XML parsing during rich-text extraction. Cancelled reads never start late parsing; parsing yields allow cancellation before subsequent decoding.

- Reject duplicate inline-string containers and conflicting XLSX cell payloads before ExcelJS decoding, preventing text concatenation or discarded values/formulas. Failed SDK imports preserve the current workbook and undo/redo history.

- Reject malformed quoted clipboard fields before applying any cells. Keep bounded preflight and parsing aligned: allow only space padding after closing quotes, preserve quoted blank records, and count escaped quotes by decoded length.

- Quote carriage returns in copied TSV values so external paste does not split one cell into multiple rows. External newline normalization remains unchanged; internal token-based copying preserves the original value.

- Decode text files in 256 KiB UTF-8 chunks with task yields and cancellation checks. Preserve split multibyte text/BOM semantics and reject incomplete trailing sequences before parsing; the full file buffer and final string remain in memory.

- Reject oversized CSV/TSV fields as decoded characters accumulate instead of retaining the whole field until its delimiter. Count escaped quotes and UTF-16 units consistently; oversized unterminated fields report capacity first.

- Build CSV/TSV workbook cells as rows finish instead of retaining the full parsed row matrix. Conversion shares parsing cancellation checkpoints, rejects oversized row dimensions early and preserves blank extents; late errors never commit partial workbooks.

- Parse CSV/TSV files cooperatively, yielding during delimiter detection and every 32 Ki character scan so cancellation can run before parsing completes. Sync string APIs use the same parser without asynchronous yields; field, quoting, numeric and extent rules remain shared.

- Parse large XLSX XML parts in 128 Ki UTF-16 chunks with event-loop yields and cancellation checks. Keep the same strict XML parser and synchronous helper; preserve tokens and Unicode across chunks. Decoding strings and individual parser chunks still run synchronously.

- Propagate XLSX cancellation into ZIP entry reading: pause active output, discard collected chunks, remove listeners, consume late events and stop subsequent entries. Cancelled ZIP-directory waits no longer start inflation; in-flight library work may still continue internally.

- Stop cancelled XLSX file imports at asynchronous stage boundaries, including archive loading, metadata reads, archive rewriting and ExcelJS decoding waits. Consume late failures and skip subsequent stages; existing decoder work may continue internally. The public workbookFromXlsx signature is unchanged.

- Propagate import cancellation into pending file reads for workspace imports, recovery previews and SDK imports. Skip late UTF-8 decoding and do not start XLSX parsing after a cancelled read; already-running native reads and synchronous/ExcelJS parsing remain non-interruptible.

- Bind ExcelJS vendor attribution to browser-entry bytes and actual Rollup input hashes. Installed-package checks re-read the hashed upstream source map and compare extracted metadata/notices instead of trusting self-reported notice text. Unresolved licenses remain unresolved.

- Record deployed build identity from the actual checked-out Git commit and include the final site content digest. Ignore unrelated workflow trigger SHAs and fail when no checkout identity exists; metadata is not a clean-checkout or acceptance claim.

- Reserve copy-name suffixes within the persisted 200 UTF-16 unit limit for shared, duplicated and recovered workbooks. Keep surrogate pairs intact so reloading does not discard copy labels or introduce broken emoji.

- Reject malformed UTF-8 shared snapshots and enter shared-copy mode only after workbook validation succeeds. Invalid links show an error and restore the saved local active workbook instead of retaining and saving fallback content as a shared document.

- Apply the same strict UTF-8 decoding to workspace recovery previews before opening the selection dialog. Reject damaged backup bytes without saving a corrupted copy; retain cancellation ownership and valid BOM/Unicode recovery.

- Decode CSV, TSV and JSON files as strict UTF-8 before parsing; reject damaged bytes without changing the workbook or undo history. Preserve optional BOMs and valid Unicode, and keep file I/O failures distinct from encoding errors.

- Bound XLSX expanded formula text before decoding: 32,767 UTF-16 units per formula and 8 million across worksheets, including formula prefixes. Stop shared expansion at capacity without truncation or allocating unstored cells.

- Expand stored XLSX shared formulas with literal-aware A1 translation before ExcelJS decoding, preserving quoted text and sheet names. Validate worksheet-local group IDs, masters and ranges without materializing the declared rectangle.

- Reject XLSX array, data-table and unknown formula storage types before decoding to prevent dependent formula results from silently becoming constants. Ordinary/shared formulas retain supported per-cell semantics; failed imports preserve existing data and history.

- Switching worksheets now refreshes the public data-source state after clearing viewport-specific errors. Preserve genuine cache errors and pending initial loads instead of leaving stale capacity errors or reporting false readiness.

- SDK viewport capacity failures now set a visible data-source error state even when no request starts. Late initial pages cannot mask the failed viewport; a new fitting range recovers, including cache hits. Correct documentation to read effective pageSize from dataSourceState.

- Reject invalid UTF-8 REST response bytes instead of silently replacing them with U+FFFD. Preserve valid replacement characters, split multibyte text and BOM handling; damaged pages remain retryable without altering cached data.

- REST sources now stream and cap response bodies with maxResponseBytes (default 16 MiB, maximum 64 MiB), count actual delivered bytes, decode split UTF-8 safely, and release readers on capacity failure/cancellation. Custom fetchers must return standard Response bodies.

- REST sources skip JSON parsing for cancelled late responses, release unused response bodies on cancellation/HTTP errors, and skip validation/copying when cancellation arrives during parsing. Cleanup failures cannot replace the original cancellation or HTTP outcome.

- Stable publishing now parses the artifact-bound reproducibility report and rejects dirty checkouts, incomplete or unequal runs, mismatched artifact/site hashes, missing environment metadata and inconsistent source timestamps even when the report hash is updated.

- Bound retained paged CSV text per response with maxPageTextUnits (default 8 million UTF-16 units). Oversized pages fail before output/progress; SDK ExportOptions.pagedCsv allows smaller pages and explicit budgets for a complete retry without changing viewport caching.

- Static workbook CSV exports now flush between fields within wide rows and yield every 256 columns. Preserve formula results, Unicode and exact CSV records; document that stream chunks may end within a record and that partial output must be discarded on cancellation.

- Serialize paged CSV incrementally within wide rows, flushing at field boundaries and yielding during long rows. Preserve Unicode/escaping while allowing cancellation before a complete row is assembled; source-page and final Blob memory remain separate constraints.

- Add viewport page cell/text budgets to ChunkCacheOptions and bindData. Wide sources use smaller effective pages without truncation; oversized text responses fail atomically and remain retryable. The limits bound retained page payloads, not total browser/process memory.

- Reject empty and non-decimal XLSX shared-string indices before decoding. Plain and rich text now use the same validated index; valid leading zeros, explicit plus signs and surrounding whitespace remain supported. Failed imports preserve the workbook and undo history.

- Validate complete XLSX numeric and constant boolean spellings before decoding, reject duplicate value/formula nodes, and decode true/false booleans from original XML. Malformed values no longer silently become partial numbers or incorrect booleans.

- XLSX constant error cells now import as equivalent supported error-literal formulas, preserving IFERROR/dependency semantics instead of becoming ordinary text. Unknown or malformed constant error codes are rejected before ExcelJS decoding; the original constant-versus-formula storage distinction is explicitly documented.

- Add evaluator.result() and EvaluationResult to distinguish returned text from calculation errors. XLSX formula caches preserve error-looking strings as text; engine-only error codes omit the cache and request recalculation instead of masquerading as successful strings.

- Overflowing numeric formula literals now raise #NUM! when evaluated, so IFERROR can catch them and unselected IF branches remain lazy. Comparisons, text concatenation and CSV/XLSX caches no longer treat Infinity as a valid literal value.

- Add parseCellInput for consistent Canvas, workspace and standalone example editing. Preserve identifiers, unsafe integers, negative zero, underflow and visibly rounded decimal input as text instead of silently altering values; custom SDK formula bars can use the same parser.

- Viewport cache page requests now queue beyond maxPages active waits, share queued consumers, and release slots on success, failure or cancellation. Cancelled queued requests never fetch, while clear/dispose cancel the whole pending queue.

- File imports retain cancellation ownership through source teardown and only report success after the workbook is committed. Reentrant load/bind/import/destroy and cancellation before commit no longer produce false success or install a superseded file.

- SDK source replacement detaches old controllers and subscriptions before cancellation callbacks run. Reentrant rebind/load/destroy cannot be cancelled or overwritten by stale cleanup, and a pending binding cannot target a worksheet selected by an old source's abort callback.

- Paged cache consumers recheck request ownership after completion notifications. Refreshing or disposing from a ready/error subscriber now cancels old consumers instead of delivering stale values or errors; replacement requests remain intact.

- External cancellation immediately errors static and paged CSV streams even between reads, settles reader.closed and releases suspended iterators; late source results cannot enqueue bytes or report progress.

- Stable release validation now recomputes declared license coverage from the actual tarball's third-party notice bytes, checks per-notice hashes and inventory counts, and rejects unresolved embedded components independently of summary fields.

- Range benchmark UI now handles worker creation/send failures and invalidates ownership on unmount. Reports carry build provenance and actual workload counts; changing layout clears the previous completion message.

- Performance reports include an embedded version, source/configuration fingerprint and reproducible source timestamp. Development runs are explicitly identified; final site/package digests remain required for release acceptance.

- Clearing performance measurements now invalidates pending calculations and scroll completion state. Worker errors carry calculation IDs; late replies cannot restore cleared results. Transport failures close the worker and require a reload, while new runs clear previous results.

- Bound Canvas/edit metric retention to the latest 10,000 valid samples, expose observed/dropped counts and isolate returned samples. Reject invalid or unknown benchmark budgets before measurement to avoid false PASS results.

- Dependency evidence now checks declared AND/OR license routes against recognized upstream texts, rather than accepting any license text. Unsupported expressions and missing required families remain review items; existing unresolved vendor and missing-notice issues remain open.

- Preserve CSV/TSV numeric-looking text when Number conversion changes its decimal value or loses negative zero. Ordinary numeric imports remain numbers; overflow, underflow and visibly rounded subnormal values remain text through XLSX/JSON.

- CSV/TSV import preserves trailing blank records and fields across static CSV/XLSX export using at most one sparse blank corner. Padded editing canvas dimensions are excluded, and genuinely empty files remain zero-record exports.

- The standalone report example now cancels file imports through its shared cancel action. New report generation, imports, exports and page teardown invalidate prior import ownership; stale cleanup cannot hide a newer operation’s cancellation control.

- Preserve trailing blank rows/columns when materializing complete report sources: retain at most one blank corner cell so CSV, XLSX and PDF used bounds include the full source. Empty sources remain zero-record CSVs; existing corner values are preserved.

- XLSX downloads now stop waiting for asynchronous serialization when cancelled, replaced or destroyed. Late encoder success/failure cannot emit completion progress or start a download; underlying encoder work is not forcibly terminated.

- Add workbookFromReportData and ReportSnapshotOptions for complete bounded materialization of paged sources into editable static workbooks. Reject oversized, incomplete, changing-total and formula-like raw text inputs; support cancellation and progress. The independent report example includes a complete 200-row source with stale-result protection.

- Preserve paging metadata in calculation worker transfers and replace snapshots when source semantics change. Background formulas now match synchronous #N/A results for unloaded paged sources instead of interpreting partial cells as static data.

- Add a workspace file-operation cancel action. Cancelled imports and recovery reads cannot commit late results; stale completion does not clear newer busy state. Exports use a start-time snapshot and abort signal, including page-unmount cancellation.

- PDF export now responds to cancellation while waiting for fonts, JPEG callbacks or encoded bytes; late results cannot resume export. Canvas cleanup covers context creation, text measurement and pagination failures as well as encoding. Browser-owned work is not forcibly terminated.

- Preserve validated paging metadata through JSON import, recovery and workspace hydration instead of silently turning partial snapshots into static sheets. Invalid metadata is rejected by file and SDK loaders. Workspace snapshots display an incomplete-data notice with readonly grid and formula bar.

- Guard low-level exports against partial paged snapshots: XLSX rejects any paged sheet before static normalization, static CSV helpers reject an active paged sheet, and non-CSV download orchestration rejects paged workbooks. Full-source paged CSV and active static-sheet CSV remain available.

- Preserve license grants in nested upstream READMEs, including pako’s Zlib notice. Distinguish grant/disclaimer text from filename-only attribution and links, and verify every installed dependency notice against its packaged text and digest. Existing license-review gaps remain open.

- Refresh viewport cache when a known row total changes: discard old pages/errors, cancel other pending requests, and ignore late responses. A former short tail stays reloadable after growth. Abort-listener reentry cannot resurrect cleared or destroyed state.

- Explicit page hydration clears stale trailing cells in short/empty rows, preserves zero/false and surrounding data, rejects known-total missing rows and post-validation cancellation, and uses declared source row counts when the response omits totalRows. The input sheet is unchanged.

- Reject incomplete viewport pages when the row total is known. Failed pages do not enter the cache or change totals; SDK reports DATA_SOURCE and retryData can recover. Legitimate final pages and unknown-total short pages retain their behavior.

- Snapshot validated paged CSV rows before cooperative serialization. Producer buffer reuse, row truncation or edits between chunks can no longer change the accepted page or insert values that bypassed validation. Snapshot consistency across separate requests remains the data source responsibility.

- Paged CSV exports now check cancellation after empty-source progress and after the final yielded chunk, including known/unknown totals. Receiving the last bytes no longer makes a subsequent abort look like successful completion.

- Fix static CSV cancellation at empty/final output boundaries, validate chunk options, start readable streams only on demand, and stop pending reads when cancelled. Chunks flush at a text threshold as well as a row threshold; cooperative task yields allow cancellation during large requested chunks. Blob output still retains the completed file.

- TSV file imports now use tab delimiters even when unquoted headers contain commas. CSV auto-detection ignores separators inside quoted/multiline fields; legacy tab-separated CSV remains supported. Large delimited imports compute column counts without spreading 100,000 row lengths into call arguments. Public SDK declarations are unchanged.

- Canvas viewport now exposes a keyboard grid accessibility contract: role=grid, row/column counts, active descendant and selected gridcell coordinates. Existing keyboard, clipboard, validation-picker and editing behavior remains covered; real screen-reader/browser verification is still pending.

- Strengthen SDK lifecycle evidence: queued data-state notifications are dropped after destroy, remount begins idle, and mount-cleanup-mount ownership remains isolated. CI/npm workflows now require same-environment reproducibility checks before artifacts are uploaded or published.

- Add check:reproducibility: build and install-check the site/SDK twice with a fixed source timestamp, compare complete site manifests and archive hashes, and retain input hashes, environment and logs. The result is local technical evidence, not stable-release acceptance.

- Preserve 13 additional partial embedded attribution headers from 11 ExcelJS vendor components, with source/text hashes and explicit incomplete-license status. Package consumption checks verify notice hashes and inclusion. This does not close outstanding license review items.

- Preserve literal formula results during CSV export of static sheets with paged dependencies. Frozen values are passed directly to CSV encoding rather than replacing formula source text and being evaluated a second time. Actual CSV-byte regression covers leading equals text, dependent formulas, false/zero and page eviction across export chunks.

- Cross-sheet formulas can read cached paged data through the optional synchronous evaluator readPagedCell hook. Unavailable values produce typed #N/A instead of silently contributing zero. SDK cache notifications invalidate formula results, CSV freezes active static-sheet formula values, and getCell no longer reads another sheet’s bound source.

- Standalone JavaScript example adds a sheet directory and two-sheet revenue/profit demo, with shared undo and cross-sheet formulas. Imported workbooks expose all sheets. Controls refresh from actual SDK state; IME confirmation keys do not submit drafts. File import now uses SDK ownership so late parsing cannot overwrite newer edits.

- Guard SDK sheet switches and viewport changes across synchronous cancellation callbacks. A callback that loads/destroys/rebinds or requests a newer view supersedes the old operation; old sheet IDs cannot be written into replacement workbooks, and old scroll ranges cannot fetch from replacement sources.

- Fix synchronous SDK data-source subscriber reentry: a replaced/destroyed initial binding rejects with AbortError without reading another binding’s controller or overwriting its state. Cache clearing stops after a callback replaces/destroys the source, including callbacks triggered by viewport cancellation.

- Add SDK `sheetInfos`, `setActiveSheet(id)` and `onActiveSheetChange`. Switching preserves calculation caches, undo/redo and pending imports; resets selection/filter and rejects obsolete view edits. Inactive undo and late paged responses preserve the active selection. CSV exports the current static sheet even when another sheet is bound; incomplete paged snapshots cannot be exported as complete workbooks or edited. Real browser switching acceptance is pending.

- Encode XLSX formula string caches without losing CRLF, control characters or literal escape-shaped text. Numeric/boolean/error caches retain their types, and exported workbooks request full recalculation on load. Formula import still recomputes locally; ExcelJS direct formula-cache decoding limitations are documented.

- Fix XLSX rich text encoding: preserve CRLF/CR, literal `_xHHHH_` text, XML controls and UTF-16 units. Decode original rich runs once and emit safely encoded inline strings after archive construction. Ordinary text and hyperlink labels now use the same export encoding; XML reserialization retains character-reference CR.

- Add rich text superscript/subscript/baseline across XLSX, Canvas/PDF and the workspace format dialog. Preserve XLSX font family classification and charset metadata. Rendering uses a documented script scale/offset, not an Excel typography equivalence claim; theme relationships remain unsupported.

- Workspace adds selected-text formatting with a preview, explicit on/off font switches, color/size/family controls and reset to inherited cell styles. A single undoable patch preserves text and link metadata; stale dialog callbacks reject. Textarea selection offsets map normalized newlines back to stored text and cannot split surrogate pairs. Actual browser selection/focus acceptance is pending.

- Preserve supported rich text runs through JSON, SDK snapshots and XLSX (including hyperlink labels). Canvas/PDF draw inline font styles; text replacement clears old runs and undo restores them. Fix sorting equal text with different inline styles. Add `RichTextStyle`, `RichTextRun` and `Cell.richText`; unsupported XLSX run properties reject import. See RICH-TEXT.md for the supported subset and plain-text editor limitations.

- Add `renameSheet(name, sheetId?)`, `SheetRenameEvent`, and optional `onSheetRename` to the SDK. Explicit formula qualifiers and single-A1 hyperlinks update atomically with undo/redo; active sheet and selection remain unchanged. Snapshot persistence integrations must listen to the new event as well as cell/structure events. Successful renames cancel pending imports; no-ops and failures preserve them. Rename and structural snapshots now share the ten-snapshot history limit.

- Stable site CI now requires acceptance bound to both the SDK archive and the deployed site's file content digest. Changed/missing/renamed runtime assets invalidate site acceptance; development previews remain explicitly unverified.
- Add NPV with ordered end-of-period cash flows, reference-versus-literal conversion rules, compensated summation, bounded member visits and explicit rate limits. Cash-flow examples and cross-sheet/XLSX regressions document the supported subset.

- Add periodic PMT, PV and FV formulas with zero/tiny-rate handling, end/beginning payments, an explicit supported numeric domain and overflow errors. Loan/savings examples and independent cash-flow recurrence tests accompany the new functions.

- Workspace Workers retain managed formula dependency caches across cell-patch messages, invalidating changed cells and transitive dependents. Full/structural snapshots and local-day changes rebuild the evaluator; unchanged formulas reuse cached results.

- Worker value transfer now sends up to 4,096 changed cells per eligible sheet, including inserts/deletes; larger or structural changes use full sheet snapshots. Changes are compared against the last posted snapshot so superseded candidates do not lose edits. This reduces payload size, while scanning and full formula evaluation remain.

- Workspace calculation requests now reuse immutable unchanged sheet value snapshots in the Worker. Base request/workbook/table-directory checks reject stale or malformed replacements and reset to a full snapshot after transport or Worker failure; this is sheet-level transfer reuse, not full incremental calculation.

- XLSX import/export rejects non-master merged-cell payloads before ExcelJS can discard them, identifying the sheet and cell. Zero, false, whitespace and formulas count as content; ordinary empty followers remain accepted.
- XLSX imports preserve original numeric date serials before ExcelJS converts them to JavaScript Date, retaining Excel's fictional day 60 and fractional-day precision. Unsupported 1904 date systems and ambiguous workbook properties fail before decoding instead of silently changing date semantics.
- Version history waits for successful reads before saving, preserves confirmed recovery points on write failure, and prevents duplicate/stale saves. Returning to a workbook waits for its pending version write. Restore validates the workbook and rejects foreign identities before changing data or undo history.
- Workspace comments wait for a successful read before editing and acknowledge additions/resolutions only after persistence succeeds. Failed saves keep the confirmed list and input for retry; duplicate/stale handlers cannot issue competing writes, and returning to a workbook waits for its outstanding comment save.
- File/workbook validation rejects duplicate canonical cell addresses and duplicate sheet IDs instead of overwriting values or silently detaching sheet-scoped rules. Unambiguous address aliases and missing-ID generation remain supported; rejected JSON imports preserve SDK data and undo history.
- Formula bar and Canvas inputs defer blur during IME composition until final input text arrives. Formula bar epochs reject callbacks from a prior cell even after returning to the same address/value; successful identical commits are deduplicated while props catch up.
- SDK packages include actual Rollup input paths/hashes and locked dependency identities with output JS digests. Offline package verification checks every JS chunk against this evidence; prebundled component licenses remain unresolved.
- Canvas cell editors bind drafts to an edit session and workbook/sheet data context. Late callbacks after replacement, revision changes, readonly transitions or cancellation cannot submit stale text.
- Immediate blur reads the latest input from the active draft and does not double-submit. Enter events marked with IME keyCode 229 do not commit.
- External cell dictionary, dimension or revision changes cancel an outstanding draft. Real browser focus and IME acceptance remain pending.

## 0.28.0 — recovery workbook import, local verification

- Snapshot persistence captures inputs before awaiting, removes covered patches only after commit, and preserves later edits. Snapshot operations serialize with active journal flushes; synchronous transaction setup errors abort partial writes.
- Workspace import recognizes recovery bundles and lets users select a workbook snapshot, validates it and creates a distinctly named independent copy. Invalid records stay selectable for diagnosis without blocking other valid records; cancellation makes no writes.
- Fix sheet-scoped validation identity when copying workbooks, resolving duplicate import IDs or restoring shared/recovery snapshots. Cross-sheet rule targets are remapped with sheet IDs; original workbooks are isolated.
- Partial backup warnings and excluded comments, revisions and legacy settings are explicit. Recovery selection shares latest-import ownership and the 20 MB input bound. Browser acceptance remains pending.
## 0.27.0 — workspace row and column editing, local verification

- Workspace toolbar exposes insert/delete rows and columns with explicit position and count, selection defaults, inline errors and one-step undo/redo.
- Candidate edits rewrite cross-sheet formulas and move supported layout/validation metadata before applying workspace quotas. Failed validation leaves content, persistence and history untouched; successful edits use the serialized snapshot save queue.
- Deletion consequences and coordinate-bound comments are explained in the dialog. Browser focus and mobile layout acceptance remain pending.

## 0.26.0 — bounded XLSX decoding, local verification

- Stable 1.x+ npm releases now require artifact-bound browser and release evidence, report file digests and a dependency inventory without unresolved issues. Current development versions do not claim stable acceptance. See the acceptance documentation before preparing a stable release.
- Merge area, coordinate and overlap checks now run before ExcelJS expands merge regions. The existing 10,000 covered-cell budget applies across all worksheets.
- Visible column ranges and empty row coordinates are bounded before decoding, and duplicate layout containers are rejected. Blank column widths retain their logical extent.
- Single-cell merge declarations normalize to an ordinary cell, matching ExcelJS export behavior. Twenty-three regression cases cover pre-decoder rejection and valid boundary round trips.

## 0.25.0 — XLSX template fidelity, local verification

- Import preserves supported styles on stored blank cells, including cells in otherwise empty rows and blank merge masters. Reads follow actual stored XML coordinates without expanding the sheet rectangle.
- XLSX preflight rejects duplicate, malformed, out-of-bounds or row-inconsistent stored coordinates before ExcelJS decoding. The 100,000 stored-cell import limit now includes blank and merged follower XML cells and is shared across sheets.
- Ten new regressions exercise actual XLSX round trips at row 100,000 / column 256, styled blank merges, malformed inputs and aggregate quotas. This is automated file-format evidence, not browser or Excel application certification.

## 0.24.0 — recovery and build reproducibility, local verification

- SDK rejects duplicate mounts on a single container and rolls back failed mounts; cleanup permits later remounting, including after an unmount exception. React/Vue lifecycle examples document explicit data ownership.
- Crash recovery downloads now include workbooks from the current persistence adapter, visible queued patches, comments, revisions and legacy local entries. Partial failures remain explicit; the recovery bundle is not a directly importable single workbook.
- Recovery download prevents duplicate work, cleans temporary URLs and ignores results after unmount. Memory-only data loss risk is stated before refresh.
- Dependency inventory timestamps use SOURCE_DATE_EPOCH or Git commit time. Two local SDK rebuilds produced byte-identical packages; cross-platform reproducibility remains unverified.


## 0.23.0 — v1.0 stabilization, local verification

### Data safety

- SDK imports accept an optional AbortSignal and reject with `IMPORT_CANCELLED` when superseded, cancelled, interrupted by successful data edits/replacement, or destroyed. Late file parsing cannot overwrite current data. This changes previously unsafe concurrent import behavior; see [migration notes](docs/API-STABILITY.md).
- Workspace imports add an independent workbook. Only the latest selected import may commit; late success/failure after a newer import or unmount is ignored. Concurrent file operations retain a correct busy indicator.

### Release engineering

- Public declaration and package export baseline checks run in CI and release workflows.
- SemVer prereleases publish to npm `next`; stable versions publish to `latest`. GitHub prerelease flags must agree with the version suffix.
- Release upload/publish uses the exact verified package path instead of a wildcard that could select older local artifacts.

This version is locally built and tested, not evidence of an npm or GitHub deployment. Browser acceptance, commercial redistribution review and the remaining [v1.0 gates](docs/V1-PLAN.md) are still open.

## 0.15.0–0.22.0 — prior local iterations

Workspace validation rules and Canvas list input; batched persistence replay and retry; patch-based undo; calculation source reuse, bounded Worker queue and timeout recovery; selection and dashboard statistics optimization. Detailed evidence and limitations are recorded in [VERIFICATION.md](docs/VERIFICATION.md).
