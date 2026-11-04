# Inventory: routes, home/query, static pages, URL contract, shared config (XC-)

- **Area:** CROSS-CUTTING. The router, the home page and its query form, the static pages and tools, the app shell (header, footer, errors, login), server config and feature flags, the URL/session contract, and the end-to-end suite as a whole.
- **Sources:** `cbioportal-frontend/src/routes.tsx`, `src/pages/home`, `src/pages/staticPages`, `src/shared/components/query`, `src/config`, `src/shared/userSession`, plus the files those depend on: `src/appBootstrapper.tsx`, `src/AppStore.ts`, `src/appShell/`, `src/shared/lib/{redirectHelpers,URLWrapper,ExtendedRouterStore,handleLongUrls,createQueryStore}.ts`, `src/shared/{FeatureFlagStore,featureFlags}.ts`, `src/shared/components/{rightbar,userMessager}`, `src/shared/api/{urls.ts,session-service}`.
- **Size read:** routes.tsx 594 lines; pages/home 2 files / 81 lines; pages/staticPages 44 files / 12,575 lines; shared/components/query 58 files / 13,014 lines; config 5 files / 906 lines; userSession 4 files / 271 lines; appShell 7 files / 983 lines. E2E: 87 spec files (45 remote + 42 local DB), about 23,900 lines.
- **Counts:** 99 features listed (XC-001 to XC-099), 44 route entries, about 70 server-config properties, 87 spec files. Features whose E2E column names a spec: 58 of 99 (a few of those are marked `?`); 41 are `none`.
- **Verification level:** read from code and spec headers. Spec test counts are static counts of `test(` calls and miss tests generated in loops or helpers. Items marked `?` are guesses.

Conventions for the cBioLab column: `home` = `app/page.tsx` -> `app/_home/`; `portal/*` = `app/portal/{results,patient,comparison}`; `lab` = `app/lab` (Explore and Analysis); `saved` = `app/saved`. cBioLab has no `/study`, `/results`, `/patient`, `/comparison` top-level routes and none of the legacy redirects (`/index.do`, `/case.do`, `/study.do`, `/ln`, `/encodedRedirect`, `*.jsp`); `app/groups/page.tsx` redirects to `/saved?tab=groups` and is the only redirect page.

---

## 1. Feature table

### 1.1 App shell, boot and config

| ID | Feature | Where | Data | Behavior | E2E | cBioLab | Notes |
|---|---|---|---|---|---|---|---|
| XC-001 | Boot and server-config merge | `appBootstrapper.tsx`, `config/config.ts`, `config/serverConfigDefaults.ts` | `window.rawServerConfig` or GET `<apiRoot>config_service` (jQuery); `window.frontendConfig` {baseUrl, apiRoot, frontendUrl, basePath, configurationServiceUrl}; `localStorage.frontendConfig` | Config is merged in this order, later wins: defaults, server config, `frontendConfigOverride` (JSON string inside server config), `localStorage.frontendConfig.serverConfig`. Defaults apply only where the server sent `null` (booleans: where the value is not a boolean). Then custom JS files load, then React renders. A page with `window.name === 'blank'` renders nothing. | `config.spec.ts`, `custom-tabs.spec.ts`, `expression-comparison.spec.ts`, every `local/*` spec that calls `setServerConfiguration` | none | `localStorage.frontendConfig` is how almost every config e2e works. `applyCorrections` rewrites a `.md` `skin_documentation_news` to the default URL. |
| XC-002 | Session-service-required gate | `appShell/App/Container.tsx` | `serverConfig.sessionServiceEnabled`, `app_name` | If the session service is not enabled the whole app is replaced by "No session service configured" (links to deploy docs). Skipped when `app_name === 'localdbe2e'` or under webdriver. | none | none | Local-DB e2e relies on the `localdbe2e` bypass. |
| XC-003 | Header navigation tabs | `appShell/App/PortalHeader.tsx` | 12 `skin_show_*` flags, `skin_documentation_news`, `installation_map_url`, `app_name` | Tabs in order: Data Sets (`/datasets`), Web API (external docs), R/MATLAB (`/rmatlab`), Tutorials/Webinars, FAQ, News, Visualize Your Data (`/visualize`), About, Roadmap, cBioPortal Installations (`/installations`, shown only if `installation_map_url`), Chat (only `app_name` `mskcc-portal` or `public-portal`), Donate. Internal tabs are router links; external open in a new tab. | `config.spec.ts` (Data Sets tab only) | `site-header.tsx` (`app/_ui`) with its own page list | Chat and Donate are not config-flagged the same way (Chat by `app_name`, Donate by `skin_show_donate_button`). |
| XC-004 | Logos | `PortalHeader.tsx`, `shared/api/urls.ts` | `skin_left_logo`, `skin_right_logo` | A logo value starting with `http` is used as is; otherwise it is `<base>/images/<value>`. Left logo defaults to the bundled cBioPortal logo and links to `/`. | `config.spec.ts` (right logo) | none | |
| XC-005 | Login / identity indicator | `PortalHeader.tsx`, `AppStore.ts`, `shared/components/SocialAuthButton.tsx`, `shared/lib/openSocialAuthWindow.ts` | `user_display_name`, `authenticationMethod`, `skin_hide_logout_button`, `loadConfig.hide_login` | Logged in means `userName` is a string other than `anonymousUser`: shows "Logged in as <name>" with the data-access-token dropdown. If the auth method contains `optional_oauth2` and not logged in, a Login button opens `/login` in a popup and re-fetches config when it closes. Whole block hidden by `hide_login` or `skin_hide_logout_button`. `user_display_name === 'servcbioportal'` sets `hide_login` and `isMSKCIS`. | `config.spec.ts`, `local/user-display-name.spec.ts`, `local/hide-login-button.spec.ts` | `app/lab/login-button.tsx`, `app/api/auth/*` | Auth model differs (cBioLab: its own `/api/auth/*`). |
| XC-006 | Data-access-token menu | `shared/components/dataAccessTokens/DataAccessTokensDropdown.tsx`, `WebAPIPage.tsx` | `dat_method`, `saml_logout_local`, GET `<api>/api/data-access-token` | Dropdown has Logout (`logout?local=<saml_logout_local>`) and, for supported `dat_method`, a link to `/webAPI#using-data-access-tokens`. | none | none | `SUPPORTED_DAT_METHODS` defined elsewhere (not read). |
| XC-007 | Footer | `appShell/App/PortalFooter.tsx` | GET `/api/info` (portal version), `skin_footer`, `skin_footer_show_dev`, `skin_email_contact` | Custom `skin_footer` HTML replaces the default footer. Default has HELP, INFO, optional DEV and STATUS, and CONTACT columns. Version shown is derived from `gitBranch` (`release-x.y.z`) or `portalVersion`, prefixed `v`, `--` when unknown, linked to `/api/info`. | `local/version.spec.ts` (fetches `/api/info`, logs it, no assertion) | footer in `app/layout.tsx`? | Footer rendered by `PageLayout`, not `Container` (`?`, not traced). |
| XC-008 | Page title and meta | `Container.tsx` | `skin_title`, `skin_description` | `<title>` and description meta from config; static pages set their own Helmet titles ("cBioPortal for Cancer Genomics::Datasets", etc.). | none | none | `WebAPIPage` sets the title "cBioPortal for Cancer Genomics::Helmet" (looks like a leftover). |
| XC-009 | Skip link and live region | `Container.tsx` | | "Skip to main content" link to `#mainColumn`; `#a11y-announcer` aria-live region. | none | none | |
| XC-010 | Global error screen, error boundary, alerts | `Container.tsx`, `AppStore.ts`, `shared/components/errorScreen/*`, `shared/lib/errorFormatter` | `appStore.siteErrors`, `alertErrors` | Service errors with status 400/403/5xx push a site error, which replaces all routes with "Oops. There was an error retrieving data." plus a log and "Return to homepage". `displayType === 'alert'` errors show as an alert bar instead. A React render error shows "Oh no! We encountered an error." | `local/unavailable-study.spec.ts`, `local/unavailable-study-mocked.spec.ts` (423 path only) | none | |
| XC-011 | HTTP 401 and 423 handling | `appBootstrapper.tsx` | superagent `end` patch | 401: stores current URL in `localStorage['login-redirect']`, redirects to `<base>?spring-security-redirect=<base>/restore?key=login-redirect`. 423: shows a "Study Unavailable" site error with the backend message, or "This study is being updated. Please check back later." | `local/unavailable-study*.spec.ts` | none | |
| XC-012 | Announcement banner | `shared/components/userMessager/UserMessage.tsx`, `shared/lib/statusProviders/uptimeRobot.ts` | `uptime_robot_status_page_url`, `uptime_robot_api_key` | Dismissable banners, dismissal remembered per message id in localStorage. Static messages are only defined on specific hostnames; status-provider (UptimeRobot) messages come first. Messages have `dateStart/dateEnd` and a `showCondition`. | none | none | A hard-coded September 2026 webinar banner exists in code. |
| XC-013 | Usage agreements | `appShell/App/usageAgreements/*`, `shared/components/UsageAgreement` | `app_name` | MSK study agreement for `triage-portal` and `mskcc-portal` (not in MSK CIS iframe); GENIE agreement for `cbioportal-genie-private`. Acknowledgement kept 90 days (`expired-storage`). | none | none | Deployment-specific. |
| XC-014 | Web tours | `tours/`, `RightBar.tsx` | `skin_right_nav_show_web_tours`, URL `?web-tour=<id>` (group-comparison tour or virtual-study tour), localStorage `web-tour` | Right-bar "Interactive Tours" entry; `?web-tour=` on the home page arms a tour via localStorage. | none | none | Off by default. |
| XC-015 | Study help widget | `shared/components/HelpWidget/HelpWidget.tsx` | `skin_show_study_help_button` | Floating help whose text is chosen by matching the page path against `URLMATCH:` entries. | none | none | Not shown under webdriver. |
| XC-016 | Feature-flag store | `shared/FeatureFlagStore.ts`, `shared/featureFlags.ts` | URL `?featureFlags=a,b`; `localStorage.featureFlags` | Flags from the URL are merged into localStorage and persist across loads. `remove` strips the param and reloads. Known flags: `LEFT_TRUNCATION_ADJUSTMENT`, `patientMRNATab`, `geneSpecificViolinPlot`, `EMBEDDINGS`, `ONCOTREE2GENES`, and the string literal `group_comparison_pathways` (not in the enum). | `embeddings*.spec.ts` (EMBEDDINGS) | none | See flag table. |
| XC-017 | Custom tabs | `shared/lib/customTabs/customTabHelpers.tsx`, `shared/lib/customTabs.ts`, `routes.tsx` | `custom_tabs` (array), `custom_js_urls` | Tabs configured per page (`location`: `RESULTS_PAGE`, `STUDY_PAGE`, `PATIENT_PAGE`, `COMPARISON_PAGE`). `mountCallback` and `hideAsync` may be strings that are `eval`'d. A route ending `/customTab<digit>` passes tab validation. A tab whose `hideAsync` resolves false is not added, but routing straight to it forces it visible. | `custom-tabs.spec.ts` | none | `eval` of config strings is a security-relevant behaviour to decide about. |
| XC-018 | Disabled results tabs | `pages/resultsView/ResultsViewPage.tsx`, `ResultsViewPageHelpers.tsx` | `disabled_tabs` (comma list; legacy ids mapped through `oldTabToNewTabRoute`) | Listed tabs are hidden, except a tab you are currently routed to. | `local/results-view-disabled-tabs.spec.ts` | none | |
| XC-019 | Download-control visibility | many (`OncoprintControls`, `MutationTable`, `PlotsTab`, `EnhancedReactTable`, `ServerDrivenTable`, `DownloadControls`, `QueryAndDownloadTabs`) | `skin_hide_download_controls`: `show` (default), `data`, `hide` | `hide` removes every download control and the Download tabs; `data` hides only data downloads. The spec asserts the word "Download" appears nowhere on a page. | `local/hide-download-controls.spec.ts` | none | 39 call sites. |

### 1.2 Router, redirects and URL state

| ID | Feature | Where | Data | Behavior | E2E | cBioLab | Notes |
|---|---|---|---|---|---|---|---|
| XC-020 | Router and lazy pages | `routes.tsx`, `appBootstrapper.tsx` | `frontendConfig.basePath` | `createBrowserHistory({basename})` synced to a MobX router store. Pages other than tools are lazy chunks; ResultsView and StudyView are preloaded 2 s after the home page mounts. Page changes scroll to top, or to the `#hash` element via `seekUrlHash`. | all | Next.js app router | |
| XC-021 | Tab-segment validation | `routes.tsx` (`LocationValidationWrapper`, `tabParamValidator`, `comparisonTabParamValidator`) | path `:tab` | An unknown `:tab` for results, patient, study or comparison renders `ErrorPage`. Comparison also accepts any tab starting `generic_assay`. Resource tabs (`openResource_*`, `resourceTable_*`) and `customTab<n>` pass. | `custom-tabs.spec.ts` | none | The `:subtab` routes (`/results/comparison/:subtab`, `/results/pathways/:subtab`) are validated with `tabParamValidator`, which reads `params.tab`, never defined there; so those two never reject (verified by reading, not run). |
| XC-022 | Legacy results-param upgrade | `routes.tsx` (`ResultsViewQueryParamsAdjuster`), `ResultsViewURLWrapper.ts` | `comparison_subtab`, `profileFilter` | `comparison_subtab=mutations` or `cna` becomes `alterations` plus `comparison_selectedEnrichmentEventTypes` (mutation or CNA group). A `profileFilter` containing "fusion" is rewritten to `structural_variants`. Done by redirect with `replace`. | none | none | |
| XC-023 | `/index.do` handler | `shared/lib/redirectHelpers.ts` (`handleIndexDO`) | `Action=Submit`, `session_id`, `cancer_study_id`, `cancer_study_list` | If the query has `Action=Submit`: go to `/results` keeping all params, copying `cancer_study_id` into `cancer_study_list`. Else if it has `session_id`: `/results` keeping params. Otherwise `/`. | `screenshot-results-no-session.spec.ts` (uses `/index.do?...Action=Submit`) | none | `/results` (no tab) then resolves to the default tab through the results page. |
| XC-024 | `/case.do` handler | `handleCaseDO` | `cancer_study_id`, `case_id`, `sample_id`, hash `#/patient?studyId=&caseId=`, `nav_case_ids` | Maps to `/patient?studyId=&caseId=&sampleId=`. Also accepts the older `case.do#/patient?...` form and renames hash `nav_case_ids` to `navCaseIds`. | none | none | |
| XC-025 | `/study.do` handler | `handleStudyDO` | all query | Goes to `/study` keeping the query (no clear). | none | none | `/study.do?id=` and `/study?id=` are both documented legacy forms. |
| XC-026 | `/ln` and `/link.do` link-out | `handleLinkOut`, `WebAPIPage.tsx` | `q` (OQL, `+` becomes `,`), `cancer_study_id`, `report` (documented, not read in code) | Goes to `/results/mutations?case_set_id=all&gene_list=<q>&cancer_study_list=<x>`. Study list is, in order: the "curated set of non-redundant studies" quick-select list filtered to accessible studies, else `cancer_study_id`, else `default_cross_cancer_study_session_id`, else `default_cross_cancer_study_list`. | none | none | Documented on `/webAPI` ("Linking to Us"). `report=` is documented but no code reads it. |
| XC-027 | `/encodedRedirect` | `handleEncodedRedirect`, `shared/lib/bitly.ts` | `encodedURL` (base64 of a full URL) | `window.location.href = atob(encodedURL)`. Used so a shortened link survives URL-encoding by link shorteners. | `redirect.spec.ts` | none | Redirects to any URL (open redirect); `?` whether the backend restricts it. |
| XC-028 | `/restore` | `restoreRouteAfterRedirect` | `key` | Reads `localStorage[key]`, removes it, and goes there (full navigation if it contains this hostname, router push otherwise); if missing goes to `/`. | none | none | Counterpart of the 401 login redirect (XC-011). |
| XC-029 | `.jsp` legacy redirects | `routes.tsx` | | `/mutation_mapper.jsp`, `/data_sets.jsp`, `/oncoprinter.jsp`, `/onco_query_lang_desc.jsp`, `/tools.jsp`, `/tutorials.jsp`, `/tutorial.jsp`, `/cgds_r.jsp` map to the modern paths (see route table). | none | none | `/tutorials.jsp` -> `/tutorials` -> external docs (two hops). |
| XC-030 | External doc redirects | `routes.tsx` | | `/tutorials`, `/rmatlab`, `/about`, `/news`, `/faq`, `/oql` set `window.location` to `docs.cbioportal.org` pages. `/news` is not config-driven (header News uses `skin_documentation_news`). | none | none | |
| XC-031 | 404 page | `shared/components/pageNotFound` | | "Sorry, this page doesn't exist." with link home. | none | Next.js 404 | `window.open('oncoprinterDataFormat?tab=...')` from Oncoprinter reaches this page (no such route). |
| XC-032 | URL wrapper and session mode | `shared/lib/URLWrapper.ts`, `ExtendedRouterStore.ts`, `ResultsViewURLWrapper.ts`, `GroupComparisonURLWrapper.ts` | session service POST `/api/session/main_session`, GET `/api/session/main_session/<id>`; params `session_id`, `sessionId`/`comparisonId` | Each page declares which params are "session props". If the URL would exceed `session_url_length_threshold` (default 1500 chars) or a session already exists, session props are saved to the session service and the URL carries only `session_id=<id>` plus non-session props. `session_id=pending` is shown while saving and replaced without a history entry. Params can have aliases (`cancer_study_id` for `cancer_study_list`, `data_priority` for `profileFilter`) and some are double-URI-encoded (`gene_list`). | `screenshot-results-session.spec.ts` (`/results?session_id=`), `group-comparison*.spec.ts` (`?sessionId=`) | `?doc=` links (`lib/url-json.ts`) hold the whole document; no server session | Legacy sessions are normalised (arrays unwrapped, `cancer_study_id` copied). |
| XC-033 | Posted query data | `redirectHelpers.ts` (`handlePostedSubmission`), `StudyViewPage.tsx` | `window.postData`, `window.clientPostedData`, `postData.filterJson` | A backend-rendered POST puts form fields on `window.postData`; the results page moves them into the URL. Study view reads `filterJson` from post data and it overrides the URL one. Pages open by `window.open` also hand data through `clientPostedData` (oncoprinter, patient `navCaseIds`, comparison). | `local/posted-query.spec.ts` | none | |
| XC-034 | Legacy study submission via localStorage | `QueryStore.initialize`, `redirectHelpers.ts` | `localStorage.legacyStudySubmission` | A submission too long for a URL is stored here; the home or results query store reads and clears it (needs `Action` field in the results case). | none | none | |
| XC-035 | Long case-id hash handling | `shared/lib/handleLongUrls.ts` | hash `navCaseIds=` | If the hash `navCaseIds` value is over 60,000 chars it is removed from the URL and kept on `window.navCaseIdsCache`. | none | none | Runs before tracking init. |
| XC-036 | Share links and shortening | `shared/lib/bitly.ts`, `ShareUI`, `BookmarkModal` | `bitly_access_token` | A share link is wrapped as `/encodedRedirect?encodedURL=<base64>` and shortened through the Bitly v4 API when a token is configured; otherwise the unshortened link is used. | `redirect.spec.ts` (redirect half only) | `?doc=` link plus `?shared=<id>` | |
| XC-037 | Per-user page settings | `shared/userSession/PageUserSession.ts`, `PageType.ts`, `PageSettingsIdentifier.ts` | POST `/api/session/settings/fetch`, POST `/api/session/settings` | For logged-in users with the session service on, settings for `results_view` and `study_view` pages (keyed by page and origin study ids) are fetched on id change and saved on demand. Edits made before login are kept and can be restored or discarded after login. Currently used by the oncoprint (clinical and genetic track lists). | `local/oncoprint-screenshot.spec.ts` (the two session-save tests are `test.skip`) | `saved` (saved cohorts, analyses) | |
| XC-038 | Session-service client | `shared/api/session-service/sessionServiceAPI.ts`, `ComparisonGroupClient.ts` | GET/POST `/api/session/virtual_study[/save]`, `/virtual_study/delete/<id>`, `/virtual_study/add/<id>`, `/api/public_virtual_studies`, `/api/session/custom_data[...]`, `/api/session/main_session` | Stores virtual studies (private and public), custom chart data, and URL sessions. | `local/virtual-study.spec.ts`, `group-comparison*.spec.ts` | `saved`, `app/api/custom-data/*`, `app/api/id-sets/*` | |

### 1.3 Home page and query form

| ID | Feature | Where | Data | Behavior | E2E | cBioLab | Notes |
|---|---|---|---|---|---|---|---|
| XC-039 | Home page layout | `pages/home/HomePage.tsx`, `homePage.scss` | `skin_blurb` (HTML), `quick_search_enabled` | Header blurb (raw HTML), then the Query / Quick Search tabs, then the right bar. A new `QueryStore` is created on each mount. Mounting also arms `?web-tour=`. | `config.spec.ts` (blurb), `home.spec.ts` | `home` | `skin_blurb` is injected as raw HTML. |
| XC-040 | Query / Quick Search / Download tabs | `shared/components/query/QueryAndDownloadTabs.tsx` | `localStorage.defaultHomePageTab`, `skin_hide_download_controls` | Tabs: Query (always), Quick Search (only when `quick_search_enabled`), Download (never on the home page: `showDownloadTab=false`; removed message if forced). Quick Search is remembered as the default tab. | `quick-search.spec.ts` | none | The Download tab code is retained; the QueryContainer text says the Download interface was removed. |
| XC-041 | Citation rule | `QueryAndDownloadTabs.tsx` | `skin_citation_rule_text` (HTML) | Line above the tabs asking users to cite cBioPortal. | none | none | |
| XC-042 | Study selector: cancer-type list | `CancerStudySelector.tsx`, `CancerStudyTreeData.ts`, `StudyListLogic.ts` | GET cancer types (`getAllCancerTypesUsingGET`), GET studies DETAILED (`getAllStudiesUsingGET`) | Left list of cancer types with study counts, nested to `skin_query_max_tree_depth` (default 3) except always-visible nodes; click selects a cancer type, ctrl-click multi-selects. Selecting filters the study list. | `home.spec.ts` (study counts, multi-select flows) | `app/_studies/study-chooser.tsx` | |
| XC-043 | Study list and categories | `studyList/StudyList.tsx`, `CancerStudyTreeData.ts` | `priority_studies` (`Name#id,id;Name#id`) | Studies grouped by cancer type; extra top categories from `priority_studies`, "My Virtual Studies" and "Public Virtual Studies". Row shows name, sample count, checkbox, links. | `home.spec.ts`, `local/query-page.spec.ts` | `study-list.tsx` | |
| XC-044 | Study row links and states | `StudyList.tsx`, `studyTagsTooltip` | POST study tags (`getTagsForMultipleStudiesUsingPOST`), `enable_study_tags`, `study_availability_enabled`, `skin_home_page_show_unauthorized_studies`, `skin_home_page_unauthorized_studies_global_message`, `skin_home_page_show_reference_genome` | Info icon with study-tags tooltip (nested tags rendered as tables); PubMed link; trash icon on own virtual studies and Restore after deleting (session only); a study with `status != 1` or no read permission is greyed out and unselectable; reference genome shown when studies span several genomes. | `local/study-tags-tooltip.spec.ts`, `local/unavailable-study.spec.ts`, `local/unavailable-study-mocked.spec.ts`, `local/virtual-study.spec.ts` | `study-actions.tsx` | |
| XC-045 | Study search box | `StudySearch.tsx`, `lib/query/QueryParser.ts`, `filteredSearch/*`, `shared/lib/query/textQueryUtils` | `skin_example_study_queries` | Text query: space = AND, `or` separates AND-groups, a leading `-` negates, quotes group a phrase, `reference-genome:<x>` prefix filters by genome. Dropdown offers example queries and the genome checkboxes (shown only when 2 or more genomes exist). Clear button. | `home.spec.ts` (filter on text), `local/query-page.spec.ts` | `study-chooser.tsx` search | Lowercases input. |
| XC-046 | Data-type filter | `DataTypeFilter.tsx`, `QueryStoreUtils.ts` | `fetchResourceDefinitionsUsingPOST` (internal) | Dropdown of data types (Mutations, CNA, RNA-Seq, RNA (microarray), miRNA, RPPA, Protein Mass-Spectrometry, Treatment, plus per-resource types) with study and sample counts; only types with at least one study are listed. A study passes if every checked type has a count over 0 (AND). Badge shows the count checked. | `local/query-page.spec.ts` | `study-chooser.tsx` Filters | |
| XC-047 | Quick-select buttons | `QuickSelectButtons.tsx`, `CancerStudySelector.tsx` | `skin_quick_select_buttons` (`Label\|tooltip#id1,id2;...`) | One-click study sets, shown only when no filter is active; a single entry written `*text*` selects all studies matching text. TCGA PanCancer button uses the signature `pan_can_atlas`. | none | `study-chooser.tsx` quick select | Replaced by the select-all checkbox once filtered. |
| XC-048 | Select all / deselect all | `CancerStudySelector.tsx` | | Checkbox "Select/Deselect all listed studies [matching filter] (n)". | `home.spec.ts` | `study-chooser.tsx` | |
| XC-049 | Selection summary and selected-studies modal | `StudySelectorStats.tsx`, `CancerStudySelector.tsx` | | "n studies available (m samples)" or "n studies selected (m samples)"; click opens a modal of selected studies. | none | none | |
| XC-050 | Query by Gene / Explore Selected Studies | `QueryContainer.tsx` | `studyview_max_samples_selected` | After choosing studies, two buttons: Query By Gene (opens the rest of the form; "Selected Studies: ... Modify" collapses back) and Explore Selected Studies (`/study?id=a,b`). Explore is disabled with a tooltip when nothing is selected or when more than one study is selected and the sample total exceeds `studyview_max_samples_selected` (0 = no limit). | `home.spec.ts` | `home` (Explore, Query by gene) | |
| XC-051 | GENIE pointer | `QueryContainer.tsx` | `app_name === 'public-portal'` | Public portal shows a note pointing to genie.cbioportal.org. | none | none | |
| XC-052 | Molecular profile selector | `MolecularProfileSelector.tsx`, `QueryStore.ts`, `shared/lib/allowExpressionCrossStudy.ts` | POST molecular profiles (`fetchMolecularProfilesUsingPOST`); `skin_show_gsva`, `enable_cross_study_expression` | One group per alteration type (mutations, structural variants, CNA, mRNA, protein, methylation, GSVA scores when enabled, generic assays); radio buttons where one is allowed, checkboxes otherwise. Z-score and RPPA thresholds default to 2.0. Expression across several studies is allowed only when `enable_cross_study_expression` (a JS expression or function, `eval`'d) permits. | `home.spec.ts`, `expression-comparison.spec.ts` | `home`, `query-flow.tsx` | `eval` of config. |
| XC-053 | Default profile rules | `QueryStore.ts` (`defaultProfilesForOql`, `defaultMutationProfile`, ...), `QueryStoreUtils.ts` | | Default selection is mutations plus CNA (mRNA off). OQL that mentions MUT, CNA, EXP, PROT or SV auto-adds the default profile of that type; a study with none of mutation, CNA, SV falls back to an expression profile. Selections survive Modify, and reverting to one study restores that study's defaults. | `home.spec.ts` | none | |
| XC-054 | Case-set selector | `CaseSetSelector.tsx`, `CaseSetSelectorUtils.ts` | GET sample lists per study (`getAllSampleListsInStudyUsingGET`); POST samples (`fetchSamplesUsingPOST`) | Dropdown of sample lists with counts; default depends on selection (single study: "Samples with mutation data"-style list; several: all). "User-defined case list" (`-1`) opens a textarea for sample or patient ids (mode radio By sample ID / By patient ID); the id format for several studies (`study:id`) is not verified. On submit the ids go in `case_ids` as `study:sample` joined by `+`. | `home.spec.ts`, `results-logic.spec.ts` | `home` | |
| XC-055 | Gene entry with OQL | `GeneSetSelector.tsx`, `GeneSymbolValidationError.tsx`, `QueryStore.ts` | POST genes (`fetchGenesUsingPOST`), `getAllGenesUsingGET`; `query_sets_of_genes` (JSON list of named gene sets), `query_product_limit` (default 1,000,000), `skin_email_contact` | Free text of symbols, aliases or OQL; dropdown of example gene sets; invalid or outdated symbols raise an alert with replacement suggestions; the query is refused when genes x samples exceeds `query_product_limit`, saying how many genes are allowed. | `results-logic.spec.ts` (gene list input), `home.spec.ts` | `app/_genes/GeneQueryDialog.tsx` (`GeneQueryEditor`) | cBioLab caps genes at `RESULTS_MAX_GENES` (`portal/query-editor.tsx`). |
| XC-056 | Recently mutated genes (MutSig) picker | `MutSigGeneSelector.tsx`, `QueryStore.ts` | `getSignificantlyMutatedGenesUsingGET` (internal) | Modal table of genes by q-value with a Selected column; adds picks to the gene box. Only for a single non-virtual study. | none | none | |
| XC-057 | Recurrent copy-number (GISTIC) picker | `GisticGeneSelector.tsx` | `getSignificantCopyNumberRegionsUsingGET` (internal) | Modal of regions (Amp/Del, chr, cytoband, # genes, q-value) to add genes. Only for a single non-virtual study. | none | none | |
| XC-058 | Gene-set (GSVA) selectors | `GenesetsSelector.tsx`, `GenesetsHierarchySelector.tsx`, `GenesetsVolcanoSelector.tsx`, `GenesetsJsTree.tsx`, `GenesetsValidator.tsx` | POST genesets (`fetchGenesetsUsingPOST`); `skin_show_gsva`, `skin_geneset_hierarchy_default_gsva_score` (0.5), `skin_geneset_hierarchy_default_p_value` (0.05), `skin_geneset_hierarchy_collapse_by_default` | Shown when a GSVA score profile is selected: text entry, hierarchy tree with score and p-value cutoffs, and a volcano-plot selector. | `local/gsva.spec.ts`, `local/gsva-screenshot.spec.ts` (both `test.describe.skip`) | none | Skipped suites; behaviour unverified by e2e. |
| XC-059 | Submit validation | `QueryStore.ts` (`submitError`, `submitEnabled`) | | Submit is disabled with a reason when: no study; no profile; OQL names a data type with no profile in a single study; EXP (mRNA) or PROT in a cross-study query; empty or erroneous custom case set. Clicking Submit with an OQL syntax error focuses and marks the error. | `home.spec.ts` | `query-editor.tsx` | |
| XC-060 | Submit -> results URL | `QueryStore.submit`, `QueryStoreUtils.currentQueryParams`, `shared/lib/createQueryStore.ts` | writes `/results/oncoprint?...` | Builds `cancer_study_list`, `profileFilter`, `case_set_id` (`-1` if custom), `case_ids`, `gene_list`, `geneset_list`, `Z_SCORE_THRESHOLD`, `RPPA_SCORE_THRESHOLD`, `tab_index`, `Action=Submit`. When re-submitted from the results page and the studies, case ids or case set changed, it clears comparison groups session and plots selections. | `home.spec.ts`, `local/posted-query.spec.ts`, every results spec | `portal/results` (`?study=&genes=`) | |
| XC-061 | Unknown-study warning | `shared/components/unknownStudies/UnknownStudiesWarning` | | When URL study ids do not exist or are not accessible, warns on the query form. | none | none | |
| XC-062 | Modify query on the results page | `ResultsViewPage.tsx`, `QuerySummary.tsx` | | Results page opens the same query form pre-filled from the URL, and a quick OQL editor with its own Submit. | `home.spec.ts` (quick OQL), `results-logic.spec.ts` | `portal/results` Modify query dialog | |
| XC-063 | Quick Search | `quickSearch/QuickSearch.tsx`, `HomePageSummary.tsx` | `getAllStudiesUsingGETWithHttpInfo`, `getAllGenesUsingGETWithHttpInfo`, `getAllPatientsUsingGETWithHttpInfo`, `getSamplesByKeywordUsingGETWithHttpInfo`, `default_cross_cancer_study_session_id`, `default_cross_cancer_study_list(_name)` | One search box returns grouped studies, genes, patients and samples (3 each, "show more" adds 20). Study -> study view; gene -> `/results/cancerTypesSummary` over the default cross-cancer study set (virtual study if configured, else the list); patient -> `/patient?studyId=&caseId=`; sample -> patient view (exact URL not traced `?`). | `quick-search.spec.ts` | none | |
| XC-064 | Right bar | `shared/components/rightbar/RightBar.tsx` | `skin_right_nav_*`, `skin_right_nav_whats_new_blurb`, `skin_examples_right_column_html`, `installation_map_url`; fetches `https://docs.cbioportal.org/news/` | What's New (custom HTML or scraped docs news, loaded after 3 s, plus social and newsletter links), Interactive Tours, Example Queries (custom HTML or 9 built-in links to `/comparison/mutations?sessionId=`, `/results...`, `/patient?...`, `/study?id=`), Local Installations iframe, Testimonials. | none | none | The example links are deep-link fixtures worth carrying over as examples. `skin_right_nav_show_data_sets` is declared but unread. |
| XC-065 | Query product limit and sample limit text | `QueryStore.ts` | `query_product_limit`, `clinical_attribute_product_limit` | Caps the number of genes and clinical attributes by sample count. | `results-logic.spec.ts`? | none | `clinical_attribute_product_limit` consumer not traced. |

### 1.4 Static pages and tools

| ID | Feature | Where | Data | Behavior | E2E | cBioLab | Notes |
|---|---|---|---|---|---|---|---|
| XC-066 | Data Sets page | `pages/staticPages/datasetView/DatasetPage.tsx`, `DatasetList.tsx` | `getAllStudiesUsingGET` (DETAILED), GET `<study_download_url>study_list.json`; `skin_data_sets_header`, `feature_study_export`, `study_download_url` | Table of all studies: Name (links to study view), download link, Reference (PubMed), All, Mutations, CNA, RNA-Seq (v2 else v1), and hidden-by-default Structural Variants, mRNA microarray, miRNA, Methylation HM27, RPPA, Mass Spectrometry, Complete, Treatment Count; column toggler, text filter on name and reference, all rows on one page. Download link shown if `feature_study_export` or the study is in the download list. | none | `/datasets` (`app/datasets`) | |
| XC-067 | Visualize Your Data page | `visualize/Visualize.tsx` | `download_custom_buttons_json` | Static: local install, hosted data, commercial support; tiles for OncoPrinter and MutationMapper; third-party tiles from custom button config. | none | none | |
| XC-068 | Web API page | `webAPI/WebAPIPage.tsx` | `authenticationMethod`, `dat_method`, GET `/api/data-access-token` | Link to API docs; "Download Token" button unless auth is `optional_oauth2` or `dat_method` unsupported; documents `ln?` stable links (`q`, `cancer_study_id`, `report`). Anchors `#using-data-access-tokens`, `#linking-to-us`. | none | `/api/mcp` is the programmatic surface | |
| XC-069 | Software page | `software/Software.tsx`, `shared/components/staticContent/StaticContent.tsx` | `skin_documentation_software`, `skin_documentation_baseurl`, `skin_documentation_markdown` | Renders a markdown file from the docs base URL. | none | none | Route is `/software`; not in the header. |
| XC-070 | Installations page | `installations/InstallationMap.tsx` | `installation_map_url` | Full-page iframe of the map (also a small preview on the right bar). | none | none | Header tab marked `internal: false` though it is an internal path. |
| XC-071 | Testimonials page | `testimonialsPage/TestimonialsPage.tsx`, `shared/components/testimonials` | | Static list of about 10 quotes. | none | none | |
| XC-072 | Mutation Mapper tool | `tools/mutationMapper/MutationMapperTool.tsx`, `MutationMapperToolStore.ts`, `StandaloneMutationMapper.tsx`, `StandaloneMutationTable.tsx` | Genome Nexus (`genomenexus_url`, `genomenexus_url_grch38`, isoform source `genomenexus_isoform_override_source`); `show_mutation_mapper_tool_grch38`; URL `?standaloneMutationMapperGeneTab=<gene>`; `localStorage.referenceGenomeId` | Paste or upload tab- or space-delimited mutation data (needs genomic location columns, or `Hugo_Symbol` plus `Protein_Change`); three example loaders (genomic changes, protein changes, both); reference genome GRCh37 or GRCh38 (beta, remembered); Visualize annotates through Genome Nexus; one pill tab per gene with lollipop plot and mutation table; warns with line numbers for lines that failed annotation; Modify Input reopens the form; OncoKB icon merge toggle. | `mutation-mapper-tool.spec.ts` | none (`lib/views/mutations` draws lollipops over study data, `?`) | Input is never sent to cBioPortal, only to Genome Nexus. |
| XC-073 | Oncoprinter tool | `tools/oncoprinter/OncoprinterTool.tsx`, `OncoprinterStore.ts`, `Oncoprinter.tsx`, `OncoprinterHelp.tsx`, `OncoprinterConstants.ts`, `OncoprinterGeneticUtils.ts`, `OncoprinterClinicalAndHeatmapUtils.ts`, `OncoprinterImportUtils.ts`, `JupyterNotebookModal.tsx` | `window.clientPostedData` {genetic, clinical, heatmap, studyIds, mutations}; OncoKB when annotating | Three optional inputs (genomic alterations, clinical, heatmap), each with example data, in-page format help and file upload; optional gene order and sample order; Submit renders an oncoprint with the results-page controls (OncoKB annotate, hide VUS, colour by type, per-track colour config) and a Mutual Exclusivity tab; Modify Input reopens. Data posted from a window that opened it (Jupyter hand-off) is submitted on mount. | `oncoprinter.spec.ts`, `oncoprinter-screenshot.spec.ts`, `oncoprinter-color-config.spec.ts` | `app/oncoprint-lab/import` (Oncoprinter-shaped tables), `app/api/custom-data/*` | "View data format" opens `oncoprinterDataFormat?tab=` in a new tab, which has no route (see XC-031). |
| XC-074 | OncoTree-to-genes page | `tools/oncotree2genes/OncoTree2GenesPage.tsx`, `shared/oncotree2genes/o2gl.json` | `getAllCancerTypesUsingGET`; iframe `postMessage` events (`oncotree-annotations`, selected codes) | Two tables from a static JSON: by cancer type (code, name, gene count, genes) and by gene (cancer types); search box with highlighting; selecting nodes in an embedded OncoTree iframe filters both. Route is not flagged, although `ONCOTREE2GENES` flag hides related study-view UI. | none | none | Route exists unconditionally; link to it not found in the header. |
| XC-075 | Group-comparison loading page | `pages/groupComparison/GroupComparisonLoading.tsx` | `phase` (`downloading`, `creating_session`), `clinicalAttributeName`, `origin` | Interstitial opened by the study view while a comparison session is being created; tells the user if the study view window was closed. | none | none | |
| XC-076 | Study view entry | `pages/studyView/StudyViewPage.tsx` | `id`, `studyId`, `cancer_study_id`, `filterAttributeId`, `filterValues`, `filters`; hash `filterJson`, `sharedGroups`, `sharedCustomData` | `/study` reads study ids (comma list, may include virtual study ids) and optional pre-filters; changing ids while mounted re-initialises the store. | `studyview.spec.ts` | `/lab?tab=explore&study=` | Detailed in the study-view inventory (SV-). |
| XC-077 | Patient view entry | `pages/patientView/PatientViewPage.tsx` | `studyId`, `caseId`, `sampleId`; hash `navCaseIds` | Patient or, with only `sampleId`, sample page; `navCaseIds` gives prev/next cohort navigation. Remounts when the ids change. | `patient-*.spec.ts` | `/portal/patient` | Detailed in the patient-view inventory (PV-). |
| XC-078 | Group comparison entry | `pages/groupComparison/GroupComparisonPage.tsx` | `comparisonId` (alias `sessionId`), `groupOrder`, `unselectedGroups`, `overlapStrategy`, `patientEnrichments`, `selectedEnrichmentEventTypes`, `selectedGene`, `axisMode` | Standalone comparison of saved groups, tab in path. | `group-comparison*.spec.ts` | `/portal/comparison` (`?doc=`) | Detailed in the comparison inventory (GC-). |
| XC-079 | Results view entry | `pages/resultsView/ResultsViewPage.tsx` | see URL contract below | | `results*.spec.ts` | `/portal/results` | Detailed in the results inventory (RV-). |

### 1.5 Server config and skin items that change visible behaviour (rows beyond XC-001..019)

These are listed in full in section 3. The ones with their own e2e or complex rules:

| ID | Feature | Where | Data | Behavior | E2E | cBioLab | Notes |
|---|---|---|---|---|---|---|---|
| XC-080 | Mutation-table initial columns | `PatientViewMutationTable`, `ResultsViewMutationTable`, `GroupComparisonMutationTable` | `skin_patient_view_mutation_table_columns_show_on_init`, `skin_results_view_mutation_table_columns_show_on_init`, `skin_comparison_view_mutation_table_columns_show_on_init` | Comma list of column names visible at first load. | `local/init-columns-in-mutation-tables.spec.ts` | none | |
| XC-081 | Copy-number and SV table initial columns | patient-view tables | `skin_patient_view_copy_number_table_columns_show_on_init`, `skin_patient_view_structural_variant_table_columns_show_on_init` | Same for CNA and SV tables. | `local/init-columns-in-cna-tables.spec.ts`, `local/init-columns-in-struct-var-tables.spec.ts` | none | |
| XC-082 | Namespace columns | mutation, CNA, SV tables | `skin_mutation_table_namespace_column_show_by_default` | Whether custom-namespace columns are on by default. | `local/namespace-columns-in-mutation-tables.spec.ts`, `local/namespace-columns-in-cna-tables.spec.ts`, `local/namespace-columns-in-struct-var-tables.spec.ts` | none | |
| XC-083 | Default table sort | `ResultsViewMutationMapper`, `PatientViewMutationTable` | `skin_results_view_tables_default_sort_column`, `skin_patient_view_tables_default_sort_column` (both default `Annotation`) | Initial sort column. | none | none | |
| XC-084 | Annotation-filter defaults | `shared/alterationFiltering/AnnotationFilteringSettings.ts` | `oncoprint_oncokb_default`, `oncoprint_hotspots_default`, `oncoprint_custom_driver_annotation_binary_default`, `..._tiers_default`, `oncoprint_hide_vus_default`, labels `oncoprint_custom_driver_annotation_*_menu_label/_description` | Initial state of driver-annotation toggles in the settings menu. | `local/settings-menu.spec.ts`, `local/custom-driver-annotations-in-*.spec.ts`, `local/annotation-filter-menu.spec.ts` | none | |
| XC-085 | Oncoprint defaults from config | `ResultsViewOncoprint.tsx`, `MutationOncoprint.tsx` | `oncoprint_defaultview` (`patient` or `sample`), `oncoprint_clustered_default`, `oncoprint_clinical_tracks_config_json` | Patient vs sample default, clustering default, preset clinical tracks. | `local/oncoprint-screenshot.spec.ts` (clinical tracks config) | `oncoprint` view `display` | |
| XC-086 | Study-view config | `StudyViewPageStore.ts`, `StudyViewPage.tsx` | `study_view` (`tableAttrs`, `priority` map), `studyview_clinical_attribute_chart_count` (20), `skin_study_view_show_sv_table`, `enable_treatment_groups`, `skin_hide_clinical_data_tab_study_view` | Chart priority order and count; structural-variant table on or off; treatment groups tables; hide Clinical Data tab. | `local/struct-var-table.spec.ts` | none | |
| XC-087 | Survival config | `SurvivalChart.tsx`, `SurvivalPrefixTable.tsx` | `survival_initial_x_axis_limit` (0), `survival_min_group_threshold` (3), `survival_show_p_q_values_in_survival_type_table` | Initial axis range, minimum group size, table columns. | `local/survival-chart-screenshot.spec.ts`? | `survival` view | |
| XC-088 | Annotation source switches | mutation table and mapper | `show_oncokb`, `show_hotspot`, `show_civic`, `show_revue`, `show_signal`, `show_genomenexus`, `show_genomenexus_annotation_sources`, `show_transcript_dropdown` | Turn annotation columns, icons and sources on or off. | `local/custom-driver-annotations-in-result-view.spec.ts` (`show_oncokb`) | none | |
| XC-089 | Pathways switches | `ResultsViewPage.tsx`, `PathWayMapperContainer.tsx` | `show_pathway_mapper`, `show_ndex` | Hide the PathwayMapper and NDEx sub-tabs. | none | none | |
| XC-090 | MD Anderson heatmap | `ResultsViewOncoprint`, `StudyViewPageStore` | `show_mdacc_heatmap`, `mdacc_heatmap_*_url` | NGCHM links. | none | none | Default `mdacc_heatmap_study_url` contains a space after `https://` (likely typo). |
| XC-091 | Patient-view config | `PatientViewPageStore`, `SampleManager`, `PatientViewMutationTable` | `skin_patientview_filter_genes_profiled_all_samples`, `skin_patient_view_custom_sample_type_colors_json`, `vaf_sequential_mode_default`, `vaf_log_scale_default`, `enable_darwin`, `mskWholeSlideViewerToken`, `digital_slide_archive_*` | Gene filter by panel, custom sample-type colours, VAF chart defaults, optional integrations. | `local/patient-view*.spec.ts` (gene panels, no config toggles read) | none | |
| XC-092 | Group-comparison config | `GroupComparisonPage`, `ClinicalDataUtils.ts` | `skin_show_settings_menu`, `comparison_categorical_na_values` (default `NA`) | Settings menu (alteration filters) shown or hidden; strings counted as missing. | `local/annotation-filter-menu.spec.ts` | none | `skin_show_settings_menu` has no default in `serverConfigDefaults.ts`. |
| XC-093 | Generic-assay label | `shared/lib/GenericAssayUtils/GenericAssayConfig.ts` | `generic_assay_display_text` | Overrides the display text. | none | none | |
| XC-094 | API request tuning | `config/config.ts` | `api_cache_limit` (450), `enable_request_body_gzip_compression` | POST response cache size; gzip of request bodies above 10,000 chars. | none | none | |
| XC-095 | OncoKB proxy override | `config/config.ts` | `localStorage.oncokbOverride`, `localStorage.oncokbToken` | Replaces the masked OncoKB proxy headers. | none | OncoKB pin in results | |
| XC-096 | Custom download buttons | `shared/components/CustomButton/CustomButtonServerConfig.ts`, `appBootstrapper.tsx` | `download_custom_buttons_json` | Third-party launch buttons on download controls and tiles on `/visualize`. Forced to an AVM button when `app_name === 'public-portal'`. | none | none | |
| XC-097 | Analytics and monitoring | `appBootstrapper.tsx`, `shared/lib/tracking` | `google_analytics_profile_id`, `datadog_rum_*`, Sentry, Loggly | Tracking is skipped under webdriver. A DataDog log hook records study-view requests for 1-3 studies on specific endpoints. | none | none | |
| XC-098 | Request-recording test hooks | `appBootstrapper.tsx` | `navigator.webdriver`, `localStorage.recordAjaxQuiet`, `localStorage.timeElementVisible` | Adds `e2etest` body class, a network listener, and a selector-visibility timer for e2e. | all | none | |
| XC-099 | Study availability | `QueryStore.ts`, `StudyList.tsx`, `appBootstrapper.tsx` | `study_availability_enabled` | When on, studies with `status` other than 1 are excluded from queries and greyed on the home page; the backend answers 423 for them. | `local/unavailable-study.spec.ts`, `local/unavailable-study-mocked.spec.ts` | none | |

---

## 2. Route table

Router entries in `routes.tsx` order (first match wins). Required parameters are marked **R**. "Tab" values are path segments.

| # | URL pattern | Page / action | Required query params | Optional query params and hash | Notes |
|---|---|---|---|---|---|
| R01 | `/` (exact) | Home: query form | none | `web-tour`; on submit the form builds R12 | `featureFlags` read on any route |
| R02 | `/restore` | Restore after login | `key` (localStorage key) | | Goes to the stored URL, or `/` |
| R03 | `/loading/comparison` | Group-comparison loading interstitial | `phase`, `origin` | `clinicalAttributeName` | |
| R04 | `/results/survival` | Redirect to `/results/comparison/survival` | | all query kept | Legacy tab |
| R05 | `/results/expression` | Redirect to `/results/plots` with `plots_horz_selection` (study of origin) and `plots_vert_selection` (mRNA, log scale) added | | existing query kept | Legacy tab |
| R06 | `/results/enrichments` | Redirect to `/results/comparison?comparison_subtab=mutations` then to `/results/comparison/mutations` | | | Legacy tab; two hops |
| R07 | `/results/comparison/:subtab` | Results, Comparison tab | results params (R12) | `comparison_*` | `subtab` one of overlap, survival, clinical, mrna, protein, dna_methylation, alterations, generic_assay_* (tab list, not enforced, see XC-021) |
| R08 | `/results/comparison` | Redirect: to `/results/comparison/<sanitize(comparison_subtab)>` or `/results/comparison/overlap` | | `comparison_subtab` | |
| R09 | `/results/pathways/:subtab` | Results, Pathways tab | results params | `pathways_source` | `subtab`: pathwaymapper or ndex-cancer-pathways (sanitised: lower-case, spaces to hyphens) |
| R10 | `/results/pathways` | Redirect to `/results/pathways/<sanitize(pathways_source)>` or `/results/pathways/pathwaymapper` | | `pathways_source` | |
| R11 | `/results/:tab?` | Results view | see R12 | | Tabs: oncoprint, cancerTypesSummary, mutualExclusivity, plots, mutations, structuralVariants, coexpression, comparison, cnSegments, network, pathways, download; legacy ids (`cancer_types_summary`, `mutual_exclusivity`, `co_expression`, `IGV`) mapped; plus `customTab<n>`. `/results` alone defaults to oncoprint. |
| R12 | (params of R04-R11) | Results parameters | `cancer_study_list` (alias `cancer_study_id`), `case_set_id`, `gene_list` (double-URI-encoded), data profile: `profileFilter` (alias `data_priority`) or `genetic_profile_ids_PROFILE_*` or `genetic_profile_ids`; or `session_id` instead of all of these | `case_ids`, `sample_list_ids`, `Z_SCORE_THRESHOLD`, `RPPA_SCORE_THRESHOLD`, `geneset_list`, `generic_assay_groups`, `generic_assay_stacked_*`, `generic_assay_bar_profiles`, `show_samples`, `enable_white_background_for_glyphs`, `heatmap_track_groups`, `clinicallist`, `oncoprint_sortby`, `oncoprint_cluster_profile`, `oncoprint_sort_by_mutation_type`, `oncoprint_sort_by_drivers`, `oncoprint_sort_by_drivers_ignore_vus`, `exclude_germline_mutations`, `hide_unprofiled_samples`, `patient_enrichments`, `comparison_subtab`, `comparison_overlapStrategy`, `comparison_selectedGroups`, `comparison_groupOrder`, `comparison_createdGroupsSessionId`, `comparison_selectedEnrichmentEventTypes`, `plots_horz_selection`, `plots_vert_selection`, `plots_coloring_selection`, `mutations_gene`, `mutations_transcript_id`, `pathways_source`; hash `#userSettingsJson=` (bookmark) | Not a route; listed for the contract. Session props: all the data-selection ones. |
| R13 | `/patient/:tab?` | Patient or sample view | `studyId` and (`caseId` or `sampleId`) | `resourceUrl`, `openResources`, `genomicEvolutionSettings` (JSON), `plots_*`, `geneset_list`, `generic_assay_groups`; hash `navCaseIds=study:patient,...` | Tabs: summary, genomicEvolution, clinicalData, filesAndLinks, pathologyReport, tissueImage, MSKTissueImage, trialMatchTab, mutationalSignatures, pathways, mrna (flag `patientMRNATab`), plots; plus `openResource_<id>`, `resourceTable_<id>`, `customTab<n>` |
| R14 | `/study/:tab?` | Study view | `id` (comma list of study or virtual-study ids; also `studyId`, `cancer_study_id`) | `filterAttributeId`, `filterValues`, `filters` (JSON), `resourceUrl`, `plots_*`, `embeddings_*` (coloring, map, tooltip fields, legend, panel 2-4 variants), `geneset_list`, `generic_assay_groups`; hash `filterJson`, `sharedGroups`, `sharedCustomData`, `localdist`/`featureFlags` | Tabs: summary, clinicalData, heatmaps, cnSegments, filesAndLinks, plots, embeddings (flag `EMBEDDINGS`); `openResource_<id>`, `resourceTable_<id>`, `customTab<n>` |
| R15 | `/comparison/:tab?` | Group comparison | `comparisonId` or `sessionId` | `groupOrder`, `unselectedGroups`, `overlapStrategy`, `patientEnrichments`, `selectedEnrichmentEventTypes`, `selectedGene`, `axisMode` | Tabs: overlap, mrna, protein, survival, clinical, dna_methylation, alterations, generic_assay*, mutations, pathways (flag `group_comparison_pathways`); `/comparison` alone defaults to overlap |
| R16 | `/webAPI` | Web API page | | hash anchors | Scrolls to hash |
| R17 | `/mutation_mapper` | Mutation Mapper tool | | `standaloneMutationMapperGeneTab` | |
| R18 | `/oncoprinter` | Oncoprinter tool | | none (data via `window.clientPostedData`) | |
| R19 | `/datasets` | Data Sets page | | | |
| R20 | `/oncotree2genes` | OncoTree to genes | | | |
| R21 | `/installations` | Installation map | | | Needs `installation_map_url` |
| R22 | `/visualize` | Visualize Your Data | | | |
| R23 | `/software` | Software acknowledgments | | | |
| R24 | `/tutorials` | External redirect: docs `user-guide/overview/#tutorial-slides` | | | |
| R25 | `/rmatlab` | External redirect: docs `web-api-and-clients/#r-client` | | | |
| R26 | `/about` | External redirect: docs `about-us/` | | | |
| R27 | `/news` | External redirect: docs `news` | | | |
| R28 | `/faq` | External redirect: docs `user-guide/faq/` | | | |
| R29 | `/oql` | External redirect: docs `user-guide/by-page/#oql` | | | |
| R30 | `/testimonials` | Testimonials | | | |
| R31 | `/case.do` | Legacy patient link -> `/patient` | `cancer_study_id`, `case_id` | `sample_id`; hash form `#/patient?studyId=&caseId=` | Must keep working |
| R32 | `/index.do` | Legacy query link -> `/results` or `/` | | `Action=Submit`, `session_id`, `cancer_study_id`/`cancer_study_list`, all results params | Must keep working; used by `screenshot-results-no-session.spec.ts` |
| R33 | `/study.do` | Legacy study link -> `/study` | `cancer_study_id` or `id` | | Must keep working |
| R34 | `/ln` | Link-out -> `/results/mutations` | `q` | `cancer_study_id`, `report` | Must keep working; documented on `/webAPI` |
| R35 | `/link.do` | Alias of `/ln` | `q` | `cancer_study_id` | |
| R36 | `/encodedRedirect` | Redirect to decoded URL | `encodedURL` (base64) | | Used by shortened share links; `redirect.spec.ts` |
| R37 | `/mutation_mapper.jsp` | Redirect to `/mutation_mapper` | | | |
| R38 | `/data_sets.jsp` | Redirect to `/datasets` | | | |
| R39 | `/oncoprinter.jsp` | Redirect to `/oncoprinter` | | | |
| R40 | `/onco_query_lang_desc.jsp` | Redirect to `/oql` (then external) | | | |
| R41 | `/tools.jsp` | Redirect to `/visualize` | | | |
| R42 | `/tutorials.jsp` | Redirect to `/tutorials` (then external) | | | |
| R43 | `/tutorial.jsp` | Redirect to `/tutorials` (then external) | | | |
| R44 | `/cgds_r.jsp` | Redirect to `/rmatlab` (then external) | | | |
| R45 | `*` | 404 page | | | |

R12 is a parameter group, not a router entry, so the router has **44 entries** (R01-R11 and R13-R45).

### 2.1 URLs the SPA depends on but does not route

| URL | Purpose |
|---|---|
| `GET <apiRoot>/config_service` | Server config JSON (unless `window.rawServerConfig` is set) |
| `GET /api/info` | Portal version (footer; `local/version.spec.ts`) |
| `/api/session/*`, `/api/public_virtual_studies` | Session service (XC-038) |
| `/login`, `/logout?local=` | Auth popup and logout |
| `/api/data-access-token` | Token download |
| `/proxy/<host>/...`, `/proxy/<id>` | Proxy for HTTP-only services and OncoKB |
| `/export/study/<id>.zip` | Study export when `feature_study_export` |
| `/images/<file>` | Logo files |
| `?localdist=true`, `?localdev=true` | Test-only: backend swaps in the local frontend bundle (`end-to-end-test-playwright/fixtures.ts`) |

### 2.2 Browser storage and window globals that act as part of the contract

| Key | Role |
|---|---|
| `localStorage.frontendConfig` | Overrides `serverConfig` (e2e and debugging) |
| `localStorage.featureFlags` | Persisted feature flags |
| `localStorage.defaultHomePageTab` | Remembers Quick Search tab |
| `localStorage.referenceGenomeId` | Mutation Mapper genome choice |
| `localStorage.legacyStudySubmission` | Over-long query hand-off |
| `localStorage.login-redirect` (and `key=`) | Return-after-login |
| `localStorage.web-tour`, `<tour id>` | Web-tour progress |
| `localStorage.oncokbOverride`, `oncokbToken` | OncoKB endpoint and token override |
| `window.postData`, `window.clientPostedData` | Form POST and window-to-window hand-off |
| `window.rawServerConfig`, `window.frontendConfig` | Boot config |
| `window.studyPageFilter` | One-shot study filter from a server-rendered page |
| `window.routingStore`, `window.globalStores` | Used by e2e and redirect handlers |

---

## 3. Feature flags and server-config properties that change visible behaviour

### 3.1 Client feature flags (`?featureFlags=a,b`, persisted in `localStorage.featureFlags`)

| Flag | Effect | Where | E2E |
|---|---|---|---|
| `EMBEDDINGS` | Shows the Similarity Maps tab in study view | `StudyViewPage.tsx` | `embeddings*.spec.ts` (opt-in by URL) |
| `LEFT_TRUNCATION_ADJUSTMENT` | Left-truncation adjustment in survival comparison | `GroupComparisonStore`, `ResultsViewComparisonStore`, `StudyViewPageStore` | none |
| `patientMRNATab` | Adds mRNA tab to patient view | `PatientViewPageTabs.tsx` | none |
| `geneSpecificViolinPlot` | Gene-specific violin plot in study view | `StudyViewPageStore.ts` | none |
| `ONCOTREE2GENES` | Enables OncoTree-to-genes features in study view | `StudyViewPageStore.ts` | none |
| `group_comparison_pathways` | Pathways tab in group comparison (literal string, not in `FeatureFlagEnum`) | `GroupComparisonPage.tsx` | none |

### 3.2 Server config (`IServerConfig`, defaults from `serverConfigDefaults.ts`)

"Default" is the frontend default; blank means none. Properties declared in `IAppConfig.ts` that no code reads are listed last.

| Property | Default | Effect | Where | E2E |
|---|---|---|---|---|
| `app_name` | | Gates Chat tab, usage agreements, public-portal extras, `localdbe2e` bypass | header, `Container`, agreements | none |
| `authenticationMethod` | | `optional_oauth2` shows Login button; hides token section | header, `WebAPIPage` | `config.spec.ts` |
| `user_display_name` | | Shown as logged-in user; `anonymousUser` or empty = logged out | `AppStore`, header | `local/user-display-name.spec.ts` |
| `skin_hide_logout_button` | false | Hides identity block | header | `local/hide-login-button.spec.ts` |
| `saml_logout_local` | false | Logout `local=` flag | token dropdown | none |
| `dat_method` | `none` | Data-access-token support | token dropdown, `/webAPI` | none |
| `sessionServiceEnabled` | | Required (else error screen) | `Container` | none |
| `session_url_length_threshold` | `1500` | URL length at which session mode kicks in | URL wrappers | none |
| `skin_show_data_tab`, `_web_api_tab`, `_r_matlab_tab`, `_tutorials_tab`, `_faqs_tab`, `_news_tab`, `_tools_tab`, `_about_tab`, `_roadmap_tab` | true except roadmap false | Header and footer tabs | header, footer | `config.spec.ts` (data tab) |
| `skin_show_donate_button` | | Donate tab | header | none |
| `installation_map_url` | | Installations tab, right-bar map, `/installations` | header, right bar | none |
| `skin_documentation_news` | docs news URL | News tab target | header | none |
| `skin_left_logo`, `skin_right_logo` | | Logos | header | `config.spec.ts` |
| `skin_title`, `skin_description` | cBioPortal text | Page title and meta | `Container` | none |
| `skin_blurb` | | HTML above the query form | home | `config.spec.ts` |
| `skin_footer`, `skin_footer_show_dev`, `skin_email_contact` | | Footer | footer | none |
| `skin_citation_rule_text` | cite link | Banner above tabs | `QueryAndDownloadTabs` | none |
| `skin_right_nav_show_whats_new`, `_examples`, `_testimonials`, `_web_tours`, `_twitter` | true, true, true, false, false | Right-bar sections | right bar, footer | none |
| `skin_right_nav_whats_new_blurb`, `skin_examples_right_column_html` | | Custom right-bar HTML | right bar | none |
| `quick_search_enabled` | false | Quick Search tab | home | `quick-search.spec.ts` (needs it on) |
| `default_cross_cancer_study_list`, `_list_name`, `default_cross_cancer_study_session_id` | 32 TCGA PanCancer Atlas studies | Studies for gene-only link-outs and Quick Search | `QuickSearch`, `/ln` | none |
| `skin_quick_select_buttons` | | Quick-select study buttons; the "curated set of non-redundant studies" entry feeds `/ln` | selector, `/ln` | none |
| `priority_studies` | | Extra study categories on the home page | `QueryStore` | none |
| `skin_example_study_queries` | 10 sample searches | Search dropdown examples | search | none |
| `skin_query_max_tree_depth` | `3` | Cancer-type tree depth | `QueryStore` | none |
| `skin_data_sets_header` | text | Header of `/datasets` | datasets | none |
| `skin_home_page_show_unauthorized_studies`, `_unauthorized_studies_global_message`, `skin_home_page_show_reference_genome`, `study_availability_enabled` | false, text, '', false | Show unauthorised/unavailable studies greyed; show genome | study list | `local/unavailable-study*.spec.ts` |
| `enable_study_tags` | true | Study tags tooltip | `QueryStore` | `local/study-tags-tooltip.spec.ts` |
| `query_sets_of_genes` | | Named gene lists in the gene box | `GeneSetSelector` | none |
| `query_product_limit` | `1000000` | Gene x sample cap for a query | `QueryStore` | none |
| `clinical_attribute_product_limit` | `6500000` | Clinical-attribute x sample cap | ? | none |
| `studyview_max_samples_selected` | `0` | Cap for Explore over several studies | `QueryContainer` | none |
| `enable_cross_study_expression` | undefined | JS expression or boolean permitting cross-study expression | `MolecularProfileSelector`, `PlotsTab`, stores | `expression-comparison.spec.ts` |
| `skin_show_gsva`, `skin_geneset_hierarchy_*` | false, 0.5, 0.05, | GSVA UI | query form | `local/gsva*.spec.ts` (skipped) |
| `disabled_tabs` | '' | Hide results tabs | `ResultsViewPage` | `local/results-view-disabled-tabs.spec.ts` |
| `custom_tabs`, `custom_js_urls` | | Custom tabs and scripts | pages | `custom-tabs.spec.ts` |
| `skin_hide_download_controls` | `show` | `show`, `data`, `hide` | many | `local/hide-download-controls.spec.ts` |
| `skin_show_settings_menu` | undefined | Results/comparison settings menu | comparison | `local/annotation-filter-menu.spec.ts`? |
| `oncoprint_oncokb_default`, `oncoprint_hotspots_default`, `oncoprint_custom_driver_annotation_binary_default`, `..._tiers_default` | true | Annotation toggles | `AnnotationFilteringSettings` | `local/settings-menu.spec.ts` |
| `oncoprint_hide_vus_default` | false | Hide VUS by default | same | `local/settings-menu.spec.ts` |
| `oncoprint_defaultview` | `patient` | Default unit | oncoprint | none |
| `oncoprint_clustered_default` | true | Clustering | oncoprint | none |
| `oncoprint_clinical_tracks_config_json` | '' | Preset clinical tracks | oncoprint | `local/oncoprint-screenshot.spec.ts` |
| `oncoprint_custom_driver_annotation_*_menu_label/_description` | `Custom Driver`, ... | Menu text | settings menu | `local/custom-driver-annotations-in-*.spec.ts` |
| `show_oncokb`, `show_hotspot`, `show_civic`, `show_revue`, `show_signal`, `show_genomenexus`, `show_genomenexus_annotation_sources`, `show_transcript_dropdown`, `oncokb_merge_icons_by_default` | true, true, false, true, true, true, `mutation_assessor`, false, true | Annotation sources | tables, mapper | none |
| `show_pathway_mapper`, `show_ndex` | true | Pathways sub-tabs | results | none |
| `show_mutation_mapper_tool_grch38` | true | GRCh38 option in tool | `MutationMapperTool` | `mutation-mapper-tool.spec.ts` (GRCh38 describe) |
| `show_mdacc_heatmap` | false | NGCHM links | oncoprint, study view | none |
| `survival_initial_x_axis_limit`, `survival_min_group_threshold`, `survival_show_p_q_values_in_survival_type_table` | 0, 3, true | Survival UI | survival | none |
| `comparison_categorical_na_values` | `NA` | Missing-value strings | comparison | none |
| `skin_patient_view_*_show_on_init`, `skin_results_view_mutation_table_columns_show_on_init`, `skin_comparison_view_mutation_table_columns_show_on_init` | '' | Initial columns | tables | `local/init-columns-in-*.spec.ts` |
| `skin_mutation_table_namespace_column_show_by_default` | | Namespace columns | tables | `local/namespace-columns-in-*.spec.ts` |
| `skin_results_view_tables_default_sort_column`, `skin_patient_view_tables_default_sort_column` | `Annotation` | Default sort | tables | none |
| `skin_patient_view_custom_sample_type_colors_json` | '' | Sample colours | `SampleManager` | none |
| `skin_patientview_filter_genes_profiled_all_samples` | false | Gene filter | patient view | none |
| `vaf_sequential_mode_default`, `vaf_log_scale_default` | false | VAF chart | patient view | none |
| `enable_darwin` | false | Darwin integration | patient view | none |
| `skin_study_view_show_sv_table` | false | SV table | study view | `local/struct-var-table.spec.ts` |
| `enable_treatment_groups` | false | Treatment-group tables | study view | `local/treatment*.spec.ts`? |
| `skin_hide_clinical_data_tab_study_view` | false | Hide tab | study view | none |
| `studyview_clinical_attribute_chart_count`, `study_view` | 20, priority map | Chart selection and order | study view | none |
| `study_download_url`, `feature_study_export` | '', false | Download links on `/datasets`, study summary | datasets | none |
| `download_custom_buttons_json` | '' | Third-party buttons and `/visualize` tiles | download controls | none |
| `skin_show_study_help_button` | false | Help widget | `HelpWidget` | none |
| `skin_documentation_software`, `_baseurl`, `_markdown`, `_about`, `_faq`, `_oql` | md paths | `/software` content | `StaticContent` | none |
| `bitly_access_token` | | Share-link shortening | `QuerySummary`, `StudyViewPage` | none |
| `generic_assay_display_text` | '' | Label override | generic assay | none |
| `uptime_robot_status_page_url`, `uptime_robot_api_key` | null | Status banner | `UserMessager` | none |
| `api_cache_limit`, `enable_request_body_gzip_compression` | 450, false | API client tuning | config | none |
| `genomenexus_*`, `g2s_url`, `oncokb_public_api_url`, `ensembl_*`, `uniprot_id_url`, `mygene_info_url`, `pubmed_url`, `ptmSources` | public URLs | External service endpoints | various | none |
| `google_analytics_profile_id`, `datadog_rum_*` | | Tracking | bootstrap | none |
| `mskWholeSlideViewerToken`, `digital_slide_archive_*`, `mdacc_heatmap_*` | | Integrations | patient view | none |
| `skin_login_contact_html`, `skin_login_saml_registration_html`, `skin_authorization_message` | text | Declared with defaults; no reader found in `src` | none | none |
| `skin_show_tweet_button`, `skin_show_tissue_image_tab`, `skin_right_nav_show_data_sets`, `skin_hide_*`, `clickhouse_mode`, `base_url`, `app_version` | | Declared; no reader found (`skin_show_tweet_button`, `skin_show_tissue_image_tab`, `skin_right_nav_show_data_sets`, `clickhouse_mode`) | none | none |

Load config (`window.frontendConfig`, not server config): `apiRoot`, `baseUrl`, `basePath`, `configurationServiceUrl`, `frontendUrl`, `hide_login`.

---

## 4. E2E coverage index

Suite: `end-to-end-test-playwright/tests` (Playwright, Chromium, 1600x1000, 120 s timeout, 1 retry in CI). **87 spec files**: 45 in `tests/` (remote lane) and 42 in `tests/local/` (local-DB lane). Plus helpers (`tests/helpers/*.ts`, `tests/local/helpers.ts`) and `fixtures.ts`.

- **Remote lane:** runs against the public portal (`www.cbioportal.org`, or `rc.cbioportal.org` for PRs to `rc`), loading the locally built bundle via `?localdist=true` from `https://localhost:3000`. Data is live, so counts can drift. Config is changed through `localStorage.frontendConfig`.
- **Local-DB lane:** `PW_LOCAL=1`, runs only `tests/local`, against a dockerised backend on `http://localhost:8080` seeded with test studies (`study_es_0`, `study_hg38`, `study_genepanels`, ...), behind Keycloak SAML login (`keycloakLogin`). Backend `portal.properties` set the skin flags.
- **Screenshots:** compared against `tests/**/__snapshots__/` baselines produced in Docker (`maxDiffPixelRatio 0.01`). "Yes" = the file compares images; "mixed" = both image and DOM assertions; "no" = DOM only.
- "tests" is a static count of `test(` calls in the file.

### 4.1 Remote lane (`tests/*.spec.ts`)

| Spec | tests | Screenshot | What it covers |
|---|---|---|---|
| `column-resizer.spec.ts` | 1 | no | Dragging the Samples column divider in the patient-view mutation table widens it (study `lgg_ucsf_2014`, patient with 4 samples). |
| `comparison-tab-screenshot.spec.ts` | 35 | yes | Results-view Comparison tab: overlap/upset, survival (exclude/include overlap), clinical charts and tests, alteration, mRNA, protein and methylation enrichments, delete-group-from-session, venn diagrams (disjoint, overlap, complex). |
| `comparison-tab.spec.ts` | 18 | no | Create-group flow from results Comparison tab, venn and upset: button enablement, duplicate-name rejection (`coadread_tcga_pub`). |
| `config.spec.ts` | 4 | no | Server-config overrides on the home page via `localStorage.frontendConfig`: `authenticationMethod` hides Login, `skin_show_data_tab`, `skin_right_logo`, `skin_blurb`. |
| `coexpression-screenshot.spec.ts` | 9 | yes | Results Co-Expression tab controls: log scale, regression line, mutation toggle, gene and profile choice, many genes, custom case list. |
| `custom-tabs.spec.ts` | 5 | no | `custom_tabs` for Results, Study, Patient and Comparison pages: location obeyed, `hide`, direct routing to hidden tab, remount on tracked URL param, patient cohort navigation. |
| `embeddings-performance.spec.ts` | 4 | no | Study view does no embedding work while the Similarity Maps tab is hidden; selection stays responsive (`msk_impact_50k_2026`). |
| `embeddings-screenshot.spec.ts` | 12 | yes | Similarity Maps tab: default colouring, legend, gene-mutation colouring, clinical (categorical, numeric), filter dimming, layout. Flag `EMBEDDINGS` via URL. |
| `embeddings.spec.ts` | 16 | no | Similarity Maps interactions: legend select/hide/search, status bar, toolbar, filter vs highlight, multi-panel, URL param initialisation. |
| `expression-comparison.spec.ts` | 12 | no | `enable_cross_study_expression` rule in Plots tab, "cannot be compared" warning, query form, custom JS rule. |
| `genomic-evolution-logic.spec.ts` | 2 | no | Patient Genomic Evolution tab: "show only highlighted" filter, sequential-VAF checkbox hidden when unsupported. |
| `genomic-evolution-screenshot.spec.ts` | 15 | yes | Patient Genomic Evolution tab: VAF chart (timeline, selection, sequential, log, data range) and mutation heatmap (cluster, transpose, labels). |
| `group-comparison-general-screenshot.spec.ts` | 20 | yes | Standalone `/comparison` general flow: overlap, survival, clinical, enrichments (one shared page). |
| `group-comparison-lollipop.spec.ts` | 24 | no | Group-comparison Mutations tab: group-count alerts, lollipop tooltip and axis scale, gene selection, annotation tracks, protein badge filters, Fisher exact labels and pagination. |
| `group-comparison-misc-screenshot.spec.ts` | 5 | yes | Group comparison: mutations tab (3), delete group from session, categorical clinical table. |
| `group-comparison-venn-screenshot.spec.ts` | 16 | yes | Group comparison venn and upset diagrams: disjoint, overlap, complex overlaps. |
| `group-comparison.spec.ts` | 18 | no | `/comparison` Create-group flow on a venn session (`?sessionId=5cf6bcf0...`) and an upset session. |
| `home.spec.ts` | 22 | no | Home page query form: study list, text filter, case-set defaults across single/multi/single selections, select-all and deselect-all, default profiles across Modify, OQL-driven profile auto-selection, EXP/PROT blocking, fallback expression profile, results quick-OQL edit. |
| `mutation-mapper-tool.spec.ts` | 8 | no | `/mutation_mapper`: three example inputs, per-gene counts, transcript switching, annotation warnings, GRCh38 toggle and dbSNP column. |
| `mutation-table.spec.ts` | 10 | no | Results mutation table: search, Genome Nexus async columns (Exon, HGVSc, gnomAD, ClinVar, dbSNP), header filter, functional impact dots. |
| `mutations-tab.spec.ts` | 4 | no | Results Mutations tab: VUS and germline filters, alteration badge filters, OncoKB driver toggle (literal counts). |
| `oncoprint-gaps.spec.ts` | 2 | yes | Oncoprint gaps on tracks and per-subgroup altered percentage labels (`coadread_tcga_pub`). |
| `oncoprint-screenshot-catalog.spec.ts` | 1 (loop) | yes | URL catalogue: cold-load oncoprint URLs and snapshot each. |
| `oncoprint-screenshot-interactions.spec.ts` | 6 | yes | Oncoprint track-header menus, heatmap clustering, delete track, remove treatment, column gaps, minimap. |
| `oncoprint-screenshot-sorting.spec.ts` | 22 | yes | Long serial flow of oncoprint sort actions on one page. |
| `oncoprint.spec.ts` | 12 | mixed | Oncoprint logic: merged tracks, URL parameter initialisation, heatmap clustering, germline, custom case list sorting, clinical legends. |
| `oncoprinter-color-config.spec.ts` | 6 | mixed | `/oncoprinter` colour modal: set colours, reset button visibility. |
| `oncoprinter-screenshot.spec.ts` | 15 | yes | `/oncoprinter` example data combinations, gene and sample order, OncoKB annotate, hide VUS, no colour by type. |
| `oncoprinter.spec.ts` | 3 | no | Oncoprinter mutation-annotation controls adapt to custom driver annotations; reset on resubmit. |
| `patient-logic.spec.ts` | 2 | no | Patient page DOM assertions (TMB-H test not ported, study not public). |
| `patient-plots-tab-screenshot.spec.ts` | 9 | yes | Patient Plots tab: scatter, box, reference cohort selector (`brca_tcga`). The suite is `test.describe.skip`. |
| `patient-screenshot.spec.ts` | 1 | yes | Patient cohort navigation view screenshot. |
| `plots-screenshot.spec.ts` | 69 | yes | Results Plots tab: discrete vs discrete matrix, boxplots, scatter colouring, multi-study, SV colouring, log-scale zero, clonality; one test skipped. |
| `plots.spec.ts` | 3 | no | Plots tab availability tooltip across studies, log-scale checkbox visibility, default generic-assay option. |
| `quick-search.spec.ts` | 3 | no | Home Quick Search tab: query "Ad" returns studies, genes, patients, samples groups. |
| `redirect.spec.ts` | 1 | no | `/encodedRedirect?encodedURL=<base64>` lands on a loading oncoprint results page. |
| `results-logic.spec.ts` | 18 | mixed | Results page: invalid query handling, cross-cancer query, single-study mutation mapper, enrichments, tab-hiding heuristics, mutual exclusivity, case-set selector in modify-query form, gene list input. |
| `results-oncoprint-color-config.spec.ts` | 8 | mixed | Results oncoprint: clinical track colour modal and "white background for glyphs" toggle. |
| `results.spec.ts` | 32 | mixed | Results page: cancer type summary bar chart (defaults, customisation), Mutations tab (3D structure text, lollipop tracks), OQL status banner for simple vs explicit queries. |
| `screenshot-misc.spec.ts` | 7 | yes | Cold-load screenshots: download tab, patient view, enrichments tab, pathways tab with unprofiled genes. |
| `screenshot-results-excluding-unprofiled.spec.ts` | 15 (generated) | yes | Results screenshot suite (oncoprint, igv, summary, mutex, plots, mutations, coexpression, comparison, survival, pathwaymapper, download) on a `/results/oncoprint?...&hide_unprofiled_samples=false` URL after toggling "Hide unprofiled". Defined in `helpers/results-screenshots.ts`. |
| `screenshot-results-no-session.spec.ts` | 15 (generated) | yes | Same suite entered through the legacy `/index.do?...Action=Submit` URL (no session). |
| `screenshot-results-session.spec.ts` | 15 (generated) | yes | Same suite entered through `/results?session_id=5bbe8197...`. |
| `studyview.spec.ts` | 43 | mixed | Study view: `laml_tcga` summary and clinical tabs, add chart, custom data, URL filters, fusion filter, cancer gene filter, `crc_msk_2017` custom bins, log-scale bar chart, pie chart, table sorting. |
| `timeline.spec.ts` | 3 | yes | Patient clinical timeline (`mpcproject_broad_2021`): on-load, collapse rows, zoom and pan; one `test.fixme`. |

Remote lane total: 45 files.

### 4.2 Local-DB lane (`tests/local/*.spec.ts`)

| Spec | tests | Screenshot | What it covers |
|---|---|---|---|
| `local/annotation-filter-menu.spec.ts` | 25 | no | Alteration (driver and VUS) filter menu in study view gene tables and samples, and in group comparison from results. |
| `local/comparison-alterations-tab.spec.ts` | 4 | no | Results comparison Alterations tab enrichments (fragile loading noted). |
| `local/comparison-tab-screenshot.spec.ts` | 7 | yes | Results Comparison tab screenshots on local data. |
| `local/custom-driver-annotations-in-result-view.spec.ts` | 9 | no | Custom driver annotations in oncoprint mutations, discrete CNA and SV tracks. |
| `local/custom-driver-annotations-in-study-view.spec.ts` | 4 | no | Custom driver annotations in study view (SV tables). |
| `local/group-color-chooser.spec.ts` | 9 | no | Colour chooser for groups in study view. |
| `local/group-comparison-screenshot.spec.ts` | 11 | yes | Group comparison page: alteration enrichments and clinical tab screenshots. |
| `local/gsva-screenshot.spec.ts` | 6 | yes | GSVA: volcano selector, oncoprint, plots, co-expression. Suite is `test.describe.skip`. |
| `local/gsva.spec.ts` | 32 | no | GSVA: query page, hierarchy selector, volcano selector, results. Suite is `test.describe.skip`. |
| `local/hide-download-controls.spec.ts` | 48 | no | `skin_hide_download_controls`: no "Download" word or icons on query page, every results tab, comparison sub-tabs, patient view, study view. |
| `local/hide-login-button.spec.ts` | 1 | no | `skin_hide_logout_button` removes the identity block. |
| `local/init-columns-in-cna-tables.spec.ts` | 2 | no | `skin_patient_view_copy_number_table_columns_show_on_init`. |
| `local/init-columns-in-mutation-tables.spec.ts` | 8 | no | `skin_*_mutation_table_columns_show_on_init` in results and patient view. |
| `local/init-columns-in-struct-var-tables.spec.ts` | 2 | no | `skin_patient_view_structural_variant_table_columns_show_on_init`. |
| `local/namespace-columns-in-cna-tables.spec.ts` | 3 | no | Namespace columns in patient-view CNA table. |
| `local/namespace-columns-in-mutation-tables.spec.ts` | 9 | no | Namespace columns in mutation tables (results, patient), `skin_mutation_table_namespace_column_show_by_default`. |
| `local/namespace-columns-in-struct-var-tables.spec.ts` | 3 | no | Namespace columns in SV table. |
| `local/oncoprint-screenshot.spec.ts` | 9 | yes | Oncoprint: generic-assay categorical tracks, clinical tracks (config JSON), OQL SV tracks; two session-saving tests are skipped. |
| `local/patient-view-screenshot.spec.ts` | 19 | yes | Patient view: mutation table with and without ASCN data, gene-panel icons, mutational signatures. |
| `local/patient-view.spec.ts` | 34 | no | Patient view: gene-panel info, mutation and CNA table filtering, genomic tracks; five gene-panel tests skipped. |
| `local/plotstab-screenshot.spec.ts` | 4 | yes | Plots tab with generic-assay categorical and binary data. |
| `local/plotstab.spec.ts` | 7 | mixed | Plots tab utilities menu and `show_samples` behaviour. |
| `local/posted-query.spec.ts` | 2 | no | POSTing query parameters to the home page is read into the URL and renders an oncoprint; patient-id filter via posted `filterJson`. Needs Keycloak login after POST. |
| `local/query-page.spec.ts` | 10 | no | Home query form: study search box menu, reference-genome filter and shorthand, data-type filter dropdown, badge, clearing, narrowing. |
| `local/results-view-disabled-tabs.spec.ts` | 1 | no | `disabled_tabs` can disable every results tab. |
| `local/results-view-screenshot.spec.ts` | 5 | yes | Results mutation table, CN segments tab, co-expression tab screenshots. |
| `local/settings-menu.spec.ts` | 6 | no | Results annotation settings menu and `portal.properties` defaults (`oncoprint_*_default`). |
| `local/struct-var-table.spec.ts` | 1 | no | `skin_study_view_show_sv_table`. |
| `local/study-tags-tooltip.spec.ts` | 1 | no | Study tags tooltip renders nested tags as tables (`study_es_0`). |
| `local/study-view-custom-bins-screenshot.spec.ts` | 4 | yes | Custom Bins menu in chart header. |
| `local/study-view-filters-autocommit-toggle.spec.ts` | 5 | no | Study-view filters auto-submit toggle. |
| `local/study-view-screenshot-cancer-gene-filter.spec.ts` | 3 | yes | Cancer gene filter in study view tables. |
| `local/study-view-screenshot-custom-data.spec.ts` | 3 | yes | Generic-assay categorical and binary charts, Custom Data tab; one test skipped. |
| `local/study-view-screenshot-x-vs-y.spec.ts` | 4 | yes | X vs Y charts and editable breadcrumbs. |
| `local/survival-chart-screenshot.spec.ts` | 4 | yes | Survival chart screenshots. |
| `local/treatment-screenshot.spec.ts` | 9 | yes | Treatment response: oncoprint and plots tabs. |
| `local/treatment.spec.ts` | 24 | no | Treatment response: oncoprint and plots tabs logic. |
| `local/unavailable-study-mocked.spec.ts` | 3 | no | Mocked 423 responses: greyed study, backend message, generic fallback message. |
| `local/unavailable-study.spec.ts` | 11 | no | `study_hg38` (status 0): API returns 423 for study, profile, sample list, batch; home page greys it out; study, results, patient views show Study Unavailable. |
| `local/user-display-name.spec.ts` | 2 | no | `user_display_name` shown in header, absent when null. |
| `local/version.spec.ts` | 1 | no | Fetches `/api/info` and logs it (no assertion). |
| `local/virtual-study.spec.ts` | 11 | no | Virtual study lifecycle: save from study view, My Virtual Studies, publish, public list, re-publish with PubMed and cancer type, un-publish, delete. |

Local lane total: 42 files.

Specs and helpers shared by many: `helpers/common.ts` (`setServerConfiguration`, `expectElementScreenshot`, `waitForStudyView`, ...), `helpers/oncoprint.ts`, `helpers/group-comparison.ts`, `helpers/results-screenshots.ts` (shared 15-test results suite), `local/helpers.ts` (`keycloakLogin`, `goToUrlAndSetLocalStorage*`).

### 4.3 What the suite does not cover in this area

No spec for: `/datasets`, `/visualize`, `/webAPI`, `/software`, `/installations`, `/testimonials`, `/oncotree2genes`, `/case.do`, `/study.do`, `/ln`, `/restore`, `*.jsp` redirects, 404 page, usage agreements, announcement banners, web tours, right bar, footer text, MutSig and GISTIC pickers, quick-select buttons, `bitly`, the legacy `comparison_subtab`/`fusion` param upgrades, the 401 login redirect.

---

## 5. Open questions

1. **Which of the four legacy URL families must cBioLab honour?** `/index.do?...Action=Submit`, `/case.do`, `/study.do?id=`, `/ln?q=`, `/encodedRedirect` and `*.jsp` redirects are all live in cBioPortal and found in external links and papers (Web API page documents `/ln`). cBioLab has none of them and no `/study`, `/results`, `/patient`, `/comparison` roots. Is the target to keep these paths at the edge (redirects into `/lab` and `/portal/*`), or is dropping them acceptable?
2. **How should `?session_id=` and `?sessionId=` links be handled?** Old links store their query on the session service, not in the URL (`screenshot-results-session.spec.ts` and the comparison specs depend on fixed session ids). A cBioLab reader of those links would need the session service, a one-time importer, or a statement that they will stop working.
3. **Is `eval` of config strings (`custom_tabs.mountCallback`/`hideAsync`, `enable_cross_study_expression`) in scope?** The portal executes strings from server config. cBioLab's document model has no equivalent; decide whether to replace with declarative settings or drop.
4. **Which server-config knobs are behaviour that cBioLab must reproduce, and which are deployment skin?** Candidates with e2e coverage: `skin_hide_download_controls`, `disabled_tabs`, `*_show_on_init` columns, `oncoprint_*_default`, `study_availability_enabled`/423 handling. cBioLab has its own `PublicEnv` settings; there is no mapping between the two lists yet.
5. **Possible existing bugs to confirm before copying behaviour.** (a) Oncoprinter's "View data format" opens `oncoprinterDataFormat?tab=` and no route exists, so it appears to hit the 404 page. (b) `/results/comparison/:subtab` and `/results/pathways/:subtab` validate `params.tab`, which those routes never define, so invalid sub-tabs are never rejected. (c) `/results/enrichments` redirects to `comparison_subtab=mutations`, which then is not a value of `ResultsViewComparisonSubTab` (it is a legacy value mapped by the adjuster). (d) `/webAPI` documents a `report=` param on `/ln` that no code reads. (e) The default `mdacc_heatmap_study_url` has a space after `https://`. Reading only; none run.
6. Is the Quick Search tab, the right-bar example queries and the "Interactive Tours" in scope for the first release? They are off or minor on most deployments (`quick_search_enabled` default false, tours default false) but the Example Queries links are the closest thing to a deep-link gallery.
7. `skin_login_contact_html`, `skin_login_saml_registration_html`, `skin_authorization_message`, `skin_show_tissue_image_tab`, `skin_show_tweet_button`, `skin_right_nav_show_data_sets`, `clickhouse_mode` have defaults or typings but I found no reader in `src`; they may be consumed by the backend JSP or be dead. Needs a check against the backend repo.
8. Where is the gene-limit rule and `RESULTS_MAX_GENES` in cBioLab relative to `query_product_limit` (genes x samples)? The two caps are different shapes (fixed count vs product).
9. Footer: whether `PageLayout` (not read) renders `PortalFooter`; and whether the footer's `/api/info` version should have a cBioLab equivalent (`app/api/version`).
10. The Download tab on the home page is hard-disabled (`showDownloadTab=false`) but the code and message remain; confirm it can be treated as removed.
