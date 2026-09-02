# Bot-Detection-Avoidance Plan

## Status and authority

This is the exclusive planning artifact for the bot-detection-avoidance track in `pi-web-search`.

The user approved this plan's scope and conditional structure. The plan remains **conditional and not yet executable as a whole**. Phase 0 is a proof-of-concept gate. Later phases describe the intended production implementation, but they may proceed only after Phase 0 passes and the Architect records that disposition here. A failed Phase 0 returns the work for an architecture decision; it does not authorize trying additional browser engines, services, proxies, or workarounds.

Plan approval does not authorize implementation, dependency installation, browser downloads, task dispatch, or commits. Those gates remain separate.

When this track is complete or abandoned, record its final disposition in maintained documentation and delete this plan file. Do not retain a completed plan as a historical implementation record.

## Current evidence and disposition

The initial Patchright/Chromium implementation remains uncommitted and isolated in `/workspace/projects/worktrees/pi-web-search/bot-detection-browser-poc` on `feature/bot-detection-browser-poc`. Production acceptance has not been granted. The current container cannot launch Chromium with its sandbox enabled: user-namespace creation is blocked by the active seccomp policy. All browser efficacy observations below are diagnostic-only and are not safe-production evidence; Chromium observations explicitly use `chromiumSandbox: false`, while Firefox-family observations use disposable diagnostics with Playwright host validation bypassed and isolated runtime libraries.

The work has produced four distinct evidence layers:

1. **Standalone unsafe PoC:** the pinned Patchright/Chrome for Testing pair rendered a local JavaScript fixture and produced substantially more diagnostic DOM for `bot.sannysoft.com`; it did not materially improve `nowsecure.nl`. The PoC also demonstrated clean contexts, bounded capture, cancellation, controls, warm reuse, idle shutdown, and orphan-free cleanup. These observations establish integration mechanics and browser lifecycle behavior, not broad anti-bot efficacy.
2. **Final-tool real-target probe:** the worktree's final document path made bounded one-shot requests against ten public targets. Three actually triggered browser escalation: Stack Overflow, Math Stack Exchange, and OpenAI Platform docs. All three returned HTTP 403 from the browser as well as the static path. Reddit returned a 200 empty result and was not escalated; a follow-up bounded inspection showed the rendered text was `You've been blocked by network security`, not Reddit content. Zillow and LinkedIn returned useful static content from this exact fetcher despite different research-time curl results. Therefore the final tool recovered **0/3 observed qualifying targets**; this result is evidence against the current Patchright path on this vantage, but it is not a universal engine verdict.
3. **Chromium-family bakeoff:** after an in-process runner timed out without progress evidence, a corrected subprocess runner completed all 42 bounded attempts: one static baseline, one vanilla Playwright browser navigation, and one Patchright browser navigation for each of fourteen targets. The targets were eight HTTP-403 candidates (Stack Overflow, Indeed, eBay, Yelp, TripAdvisor, Quora, Medium, The Economist), four shell/interstitial candidates (Reddit, Booking.com, Amazon, TikTok), and two controls (Wikipedia and GitHub). Browser navigation was called directly through the shared bounded manager so the comparison measured engines rather than the final tool's narrow escalation classifier. Both engines recovered **0/12 eligible targets**, both recovered Reddit only under a generic `Reddit` brand marker that a bounded follow-up disproved, and both had zero wins over the other. The eight 403 candidates remained 403 in both engines. Marker verification for the two controls was 2/2; a generic CAPTCHA-word heuristic falsely flagged Wikipedia because the article discusses CAPTCHAs. All 42 attempt start/result records are present and no attempt timed out in the corrected run.

4. **Firefox-family Stage 2 comparison:** after the launch gate was cleared through explicitly authorized non-root extraction of eight Debian runtime packages into a disposable library root, the corrected subprocess runner completed all 28 browser attempts: one stock Playwright Firefox and one Camoufox navigation for each of the fourteen targets. The raw candidate-signal check found 5/12 eligible targets for each engine, but four of those per engine were generic brand-only matches (stock Firefox: Indeed, eBay, Quora, and The Economist; Camoufox: Indeed, TripAdvisor, Quora, and The Economist) and remain inconclusive. Under the strict candidate-specific substantive-marker rule, both engines recovered 1/12 eligible targets (Medium), with no engine-only strict win; both recovered the two controls, and neither recovered any of the four shell/interstitial targets. All 56 append-only start/result records are present, no attempt timed out, and no browser process remained. The original missing-library gate, isolated runtime manifest, and corrected Stage 2 summary are preserved at `/workspace/tmp/pi-web-search/browser-bakeoff/firefox-family-stage2-gate.json`, `/workspace/tmp/pi-web-search/browser-bakeoff/firefox-family-stage2-runtime.json`, and `/workspace/tmp/pi-web-search/browser-bakeoff/firefox-family-stage2.json`.

The corrected bakeoff means Patchright's driver-level patches produced no observed advantage over vanilla Playwright when both drove the same Chrome for Testing `151.0.7922.34` artifact from the same egress. Eligible-target mean wall time was approximately 1,269 ms for vanilla and 1,300 ms for Patchright (Patchright approximately 2.4% slower in this run). The per-attempt subprocess design measured no reliable active browser RSS; the separate unsafe PoC measured approximately 200–400 MiB active browser memory directionally. The shared Patchright/Playwright browser cache is approximately 656 MiB and the JavaScript packages are approximately 19 MiB. These are directional observations, not guarantees.

The user explicitly authorized proceeding to a **Stage 2 Firefox-family comparison** rather than treating the Chromium-family result as proof that all local browsers fail. The exact isolated arrangement used Node `24.16.0`, `camoufox-js@0.12.0`, and `playwright-core@1.60.0`, satisfying the adapter's `<1.61.0` peer requirement without contaminating the existing Playwright `1.62.1` environment. Stock Playwright Firefox `153.0` (revision `1538`) and Camoufox `152.0.4-beta.29` were provisioned in disposable caches. Because the current container lacked GTK/Xcursor libraries, the user authorized a non-root disposable extraction route; no operating-system mutation occurred. Stage 2 remains diagnostic-only and must preserve the no-proxy/no-CAPTCHA/no-login boundaries. HTTP 200 or a brand marker alone is not recovery: the summary requires a target marker, at least 200 normalized characters, and no genuine challenge/auth/interstitial signal; an educational Wikipedia mention of a CAPTCHA challenge was explicitly corrected as a false positive.

Loser cleanup is a standing requirement. After an engine is finally rejected and cleanup is explicitly authorized, preserve bounded evidence and the harnesses needed to interpret it, remove only that engine's package, browser artifacts, engine-specific configuration, and abandoned implementation, then verify no orphan processes. Never remove the shared `/opt/playwright-browsers` cache, unrelated worktrees, unrelated home caches, or preserved evidence. The Patchright worktree and disposable cache therefore remain in place until the comparison track has a final disposition.

## Final disposition

The browser-escalation experiment is rejected and abandoned. No browser engine is approved for production, no production implementation is accepted, and no worktree change is to be integrated. The measured results do not justify the dependency, browser-binary, sandbox/runtime, lifecycle, and maintenance cost:

- Vanilla Chromium and Patchright/Chromium each strictly recovered 0/12 eligible targets in the corrected fourteen-target bakeoff, with 2/2 controls and 0/4 shell/interstitial recoveries.
- Stock Playwright Firefox and Camoufox each strictly recovered 1/12 eligible targets (Medium), with 2/2 controls and 0/4 shell/interstitial recoveries. Four additional candidate signals per engine matched only generic brand text and remain inconclusive.
- Camoufox showed no strict advantage over stock Firefox, was approximately 9% slower on eligible attempts, occupied approximately 1.4 GiB versus approximately 325 MiB for stock Firefox, and required a beta browser artifact plus an isolated older `playwright-core` dependency.
- The Firefox-family result was diagnostic-only: host validation was bypassed and runtime libraries were supplied from a disposable extraction root. No system package installation or container mutation was performed.

The user authorized full cleanup after recording these findings. Cleanup must remove the experiment's browser packages, browser artifacts, extracted runtime libraries, temporary evidence/harness files, canonical plan, and abandoned feature-worktree contents while preserving Git history, shared `/opt/playwright-browsers`, unrelated caches/worktrees, and any unrelated project files.

## Objective

Improve retrieval of public web pages for research agents when a destination rejects the package's lightweight static HTTP client or returns an incomplete JavaScript shell.

The intended behavior is best-effort and deliberately narrow:

1. Keep the current lightweight static retrieval path as the default.
2. When the user has explicitly enabled browser escalation and the static result provides specific evidence that a browser may help, make one isolated browser attempt using Patchright and a pinned Chromium build.
3. If that browser attempt also fails, return a structured failure with bounded evidence and stop.

The feature is not intended to create a general browser automation platform. It should add one evidence-backed escalation mechanism without turning the extension into a large collection of browser engines, scraping services, proxy providers, or site-specific bypasses.

## Terminology

- **Static retrieval:** the existing document path based on Node's built-in `fetch` implementation. It is not curl and does not launch a browser.
- **Browser escalation:** one Patchright-controlled Chromium navigation attempted after a qualifying static outcome.
- **Browser process:** the reusable Chromium child process. It may remain warm briefly between escalations.
- **Request context:** a fresh isolated Chromium `BrowserContext` created for exactly one tool retrieval and destroyed afterward.
- **Qualifying block evidence:** a narrowly defined static outcome that justifies browser escalation. It is not every network or HTTP error.
- **Phase 0 pass:** recorded evidence that the selected Patchright/Chromium approach is portable enough, materially improves representative blocked retrievals, preserves the package's bounds and isolation, and has acceptable operational cost.

## User-approved decisions

The following outcomes are settled for this track:

1. **Static-first behavior.** Pages that work with the existing lightweight client should continue to use it.
2. **Explicit opt-in.** Browser escalation is disabled by default. Opting in means “automatically make one browser attempt after qualifying static block evidence,” not “use a browser for every request.”
3. **Single escalation and stop.** Static retrieval gets one normal attempt. A qualifying failure may receive one browser attempt. If that fails, the tool gives up cleanly; it does not retry in a loop or silently advance through additional systems.
4. **One initial browser stack.** The initial production candidate is Patchright with a pinned Chromium build. The implementation must not add Camoufox, Chrome, Firecrawl, Cloudflare Browser Run, Browserless, Steel, Jina Reader, raw-CDP drivers, or proxy services as production fallbacks. The user has separately authorized a bounded, diagnostic-only Firefox-family comparison consisting of stock Playwright Firefox and Camoufox; that comparison does not promote either candidate or expand production scope.
5. **Open-source preference.** Chromium is preferred over Google Chrome for transparency and reduced proprietary/telemetry surface. Chrome may be reconsidered only if measured evidence shows that Chromium fails important targets which Chrome retrieves successfully.
6. **Portable extension.** The extension launches Chromium directly in the environment where Pi already runs. It must not introduce a special container image, a browser sidecar, or a required external browser service.
7. **No request-time installation.** A document request must never invoke a package manager, install operating-system libraries, or silently download a browser. Missing runtime support produces a structured, actionable error.
8. **Lazy use.** Browser code and the Chromium process are not loaded or launched until a qualifying escalation is required.
9. **Warm process, clean requests.** One Chromium process may remain alive for five minutes after use to avoid repeated launch cost. Every retrieval gets a new isolated `BrowserContext`; that context and its page are destroyed after the request.
10. **No cross-request browser state.** The initial implementation has no persistent browser profile, cookie jar, shared local storage, browsing history, service-worker state, or authenticated session continuity.
11. **Reuse existing bounded storage.** A successful browser-rendered result enters the existing bounded document snapshot/cache pipeline. The feature must not create a second content cache or an unbounded profile directory.
12. **No kitchen sink.** Alternatives remain research evidence, not latent dependencies or prematurely generalized interfaces. A capability must be promoted by measured need.
13. **Loser cleanup.** After a candidate engine is finally rejected and cleanup is explicitly authorized, remove its disposable package, browser artifacts, engine-specific configuration, and abandoned implementation. Preserve bounded evidence and shared caches; verify no orphan processes after each cleanup.

## Verified current state

The following facts were verified from the package source during planning:

- `src/documents/fetch.ts` performs document retrieval with `globalThis.fetch`.
- Static document requests currently send an explicit compatibility user agent and content `Accept` header.
- The static fetcher manually follows at most five redirects, accepts only HTTP(S), rejects embedded credentials, enforces timeout/cancellation, and streams into a configured byte limit.
- Node's tested fetch implementation supplies additional defaults such as keep-alive, `Accept-Language`, compression support, and a fetch-mode header. It does not provide a browser cookie jar.
- A redirect-set cookie is not forwarded by the current static path.
- HTTP 429 becomes `rate_limited`; authentication/access statuses become `blocked`; other HTTP failures remain bounded operational errors.
- Static HTML is normalized through the existing `jsdom`, Readability, and Markdown pipeline.
- `src/documents/markdown.ts` already emits `client_rendered_shell` when the static HTML looks like an unrendered application shell.
- Document snapshots and cursors are process-local and bounded by TTL, entry count, bytes, normalized bytes, line count, and tool output limits.
- Search backends (`ddgr`, Brave, and SearXNG) have separate dispatch, caching, rate limiting, and failure behavior. They are not part of this implementation.
- The child package `main` currently declares no browser automation dependency. The isolated feature worktree adds `patchright@1.62.2` as an optional dependency and loads it lazily; that change remains uncommitted and is not production-approved.

## Architecture boundaries

### In scope

- An optional Patchright/Chromium capability for `read_url_content` and `grep_url_content`, reached through their shared document service.
- One browser escalation after qualifying static evidence.
- Browser lifecycle management, clean request isolation, bounded rendered HTML capture, and integration with existing normalization/caching.
- Actionable availability, block, timeout, and cleanup diagnostics.
- Container-compatible headless execution in the same environment as Pi.
- Documentation for opt-in configuration and explicit runtime provisioning.

### Out of scope

- Changing search backend behavior or implementing browser-driven search-engine queries.
- Native DuckDuckGo work. That remains a separate track with no implementation dependency on this plan.
- Camoufox or `camoufox-js`.
- Google Chrome support.
- Cloud or managed retrieval services.
- Residential, ISP, or datacenter proxy integration.
- CAPTCHA solving or external CAPTCHA services.
- Credential vaults, authenticated browsing, login automation, or persistent profiles.
- Human-behavior simulation such as randomized mouse movement, typing, scrolling, or dwell delays.
- General page interaction APIs, arbitrary user scripts, screenshots, PDFs, downloads, crawling, or multi-page browser sessions.
- A special Docker image, browser sidecar, external daemon, or package-managed operating-system installation.
- Site-specific challenge solvers or an accumulating catalogue of challenge signatures.
- Premature abstractions for browser engines that are not in active scope.

## Research conclusions and selection rationale

### Selected candidate: Patchright plus Chromium

Patchright is a Playwright-compatible Node/TypeScript package that patches known automation-protocol signals while retaining the Playwright programming model. Primary-source checks during planning showed an actively published Apache-2.0 package and active repository. It has single-maintainer risk, but that is not a blocker: the task prioritizes the best current fit, the API is close to Playwright, and the plan does not treat the dependency as irreplaceable.

Chromium is selected instead of Google Chrome because it is open source, can be pinned to the automation package, and better matches the user's transparency and telemetry preferences. This selection remains conditional on Phase 0. Maintenance activity is not proof of retrieval effectiveness.

### Considered but not selected

- **Vanilla Playwright:** healthy and institutionally maintained, but current evidence indicates that Playwright's automation-protocol shape is more detectable than Patchright's patched path. It remains conceptual fallback knowledge, not an initial runtime fallback.
- **Camoufox:** provides stronger engine-level Firefox fingerprint control and now has an experimental Node wrapper, but its large custom browser artifact, experimental integration, maintenance history, governance churn, and project stability warning make it inappropriate for the minimum viable implementation. Reconsider only if Patchright/Chromium fails representative targets and the user explicitly promotes a second local engine.
- **Raw CDP / nodriver-style control:** potentially reduces Playwright-shaped protocol signals but would require owning a more fragile automation layer or a Python sidecar. It is not justified before a Patchright failure.
- **Firecrawl, Cloudflare Browser Run, Browserless, Steel, and similar services:** can provide managed rendering or network reputation, but introduce accounts, credentials, cost, third-party data transit, retention policy, or operational infrastructure. They are not part of the lean local implementation.
- **Proxy services:** may be necessary when IP/ASN reputation dominates, but add a separate cost, trust, consent, and identity-coherence decision. No proxy surface should be created speculatively.
- **HTTP/TLS impersonation:** lighter than a browser but does not execute JavaScript or provide a coherent browser-visible environment. It does not satisfy the promoted browser-retrieval objective.
- **Legacy stealth plugins:** JavaScript-injection-only Playwright/Puppeteer stealth packages were found stale, incomplete, or easy to fingerprint and are not candidates.

### Relevant research sources

These are decision anchors, not substitutes for the Phase 0 benchmark:

- Patchright repository: <https://github.com/Kaliiiiiiiiii-Vinyzu/patchright>
- Patchright Node package repository: <https://github.com/Kaliiiiiiiiii-Vinyzu/patchright-nodejs>
- Playwright browser guidance: <https://playwright.dev/docs/browsers>
- Playwright container guidance: <https://playwright.dev/docs/docker>
- Cloudflare JA3/JA4 detection context: <https://developers.cloudflare.com/bots/additional-configurations/ja3-ja4-fingerprint/>
- CDP detection and automation evolution: <https://blog.castle.io/from-puppeteer-stealth-to-nodriver-how-anti-detect-frameworks-evolved-to-evade-bot-detection/>
- Camoufox project and limitations: <https://github.com/daijro/camoufox> and <https://camoufox.com/stealth/>
- Browser fingerprint test context: <https://github.com/abrahamjuliot/creepjs> and <https://browserleaks.com/>

All fast-moving dependency, browser, and maintenance claims must be revalidated when Phase 0 starts. Do not select a newer version merely because it exists; the PoC must pin and report the exact tested pair.

## Phase 0: delegated Patchright/Chromium proof of concept

### Purpose

Determine whether one pinned Patchright/Chromium stack is feasible, useful, isolated, and operationally acceptable in the same ordinary container environment where Pi and the extension run.

Phase 0 is evidence gathering, not production implementation. It must be assigned to a fresh implementation owner after separate scope/routing approval. The worker must return evidence to the Architect and must not promote its spike into package source on its own.

### Pre-dispatch gate

Before dispatch, the user and Architect must establish a bounded target set containing:

- at least one ordinary static control page that the current client retrieves successfully;
- at least one JavaScript-rendered control page whose useful content is absent from static HTML; and
- representative public pages that have actually blocked or challenged the user's research workflow.

The user did not have saved real-world failure URLs. A bounded static-only discovery pass therefore produced the following **proposed** Phase 0 matrix. The matrix remains pending explicit target-set approval and does not authorize the browser PoC.

| Purpose                              | URL                                                               | Static-only planning baseline                                                                                            | Phase 0 use and caveat                                                                                                                                                         |
| ------------------------------------ | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Ordinary static control              | `https://example.com/`                                            | Existing `fetchDocument` returned HTTP 200 and the normalizer produced the expected Example Domain content.              | Must continue to succeed and remain semantically equivalent through the lightweight path. Stable IANA control.                                                                 |
| JavaScript-rendered control          | `https://www.selenium.dev/selenium/web/dynamic.html`              | Existing `fetchDocument` returned HTTP 200, but main-mode normalization produced no useful content.                      | Chromium should render useful dynamic DOM content. Official Selenium test page; markup may change.                                                                             |
| Browser-fingerprint diagnostic       | `https://bot.sannysoft.com/`                                      | Existing static retrieval returned HTTP 200 and only minimal normalized content (`Antibot` and one plugin-related line). | Compare browser-visible diagnostic output. Diagnostic context only; it cannot establish real-site acceptance.                                                                  |
| Anti-bot/Cloudflare-style diagnostic | `https://nowsecure.nl/`                                           | Existing static retrieval returned HTTP 200 and only minimal normalized content (`NOWSECURE` / `by nodriver`).           | Observe whether Patchright/Chromium obtains materially different useful content or challenge behavior. Volatile community diagnostic, not a stable product acceptance surface. |
| Redirect control                     | `https://httpbingo.org/redirect-to?url=https%3A%2F%2Fexample.com` | Existing manual redirect path followed the cross-origin redirect and produced the expected Example Domain content.       | Browser navigation must preserve the intended bounded redirect/final-URL behavior. Community service without an SLA.                                                           |

The discovery pass made one bounded static request per retained candidate through the package's current `fetchDocument` path with a 12-second timeout and a 512 KiB download limit, then used the existing main-mode normalizer. No browser was installed or launched. `https://react.dev/`, `https://turnstile-demo.cloudflare.com/`, and `https://challenges.cloudflare.com/turnstile-demo` were excluded after returning unusable 404/unreachable outcomes from the current environment. A one-shot public cookie demo was also excluded because request-isolation and cookie leakage are better proven by a controlled local fixture.

Because no saved real-world failure URLs were available, the diagnostic targets above are provisional substitutes. A Phase 0 pass still requires evidence of material browser improvement, and synthetic diagnostics alone cannot prove broad real-world effectiveness. If ordinary research later produces a reproducible failing public URL before dispatch, replace or supplement one diagnostic target through an explicit target-set update rather than expanding the matrix indiscriminately.

Do not substitute a large anti-detect benchmark catalogue for the user's real failure surface. Synthetic fingerprint sites may be included as diagnostic context, but they cannot be the sole pass criterion.

### PoC workspace and allowed effects

- Keep the spike outside package source unless the user explicitly authorizes a repository branch/task for it. The preferred disposable location is `/workspace/tmp/pi-web-search/browser-poc/`.
- Do not modify package manifests, the root lockfile, package source, maintained documentation, or Git history during the spike.
- Install only the exact Patchright package and its matching Chromium artifact required by the approved PoC.
- Record browser artifact location and disk usage. Use the tool's standard cache mechanism; do not place browser binaries in the repository.
- Operating-system package installation, privilege escalation, or container configuration changes require explicit authorization before execution. A missing required library is evidence, not permission to mutate the environment.
- Do not install Chrome, Camoufox, proxy software, cloud SDKs, or alternative browser packages.

### Required experiments

1. **Environment feasibility**
   - Record container OS/architecture, Node version, effective user, available shared memory, and existing relevant browser libraries without exposing credentials.
   - Install the pinned candidate in the approved disposable workspace.
   - Launch matching Chromium headlessly without a GUI, external service, special image, or sidecar.
   - Record whether a safe sandbox remains enabled. Do not normalize `--no-sandbox` as a solution for untrusted pages.

2. **Static baseline versus browser result**
   - Run the existing static retrieval behavior against every approved target.
   - Run one Patchright/Chromium navigation against the same targets from the same container and network path.
   - Record status, useful-content presence, latency, final URL, challenge/blocked outcome, and bounded error classification.
   - Do not repeatedly retry a protected target.

3. **Rendered-content compatibility**
   - Capture bounded rendered HTML after a deterministic readiness condition.
   - Feed that HTML through the package's existing normalization path rather than inventing a second Markdown extractor.
   - Compare useful normalized output, warnings, final URL, content type, and size with the static result.

4. **Isolation**
   - Reuse one browser process across two controlled requests.
   - Create a new `BrowserContext` for each request.
   - Set controlled cookies/local storage in the first context and demonstrate they are absent from the second.
   - Destroy each page and context in `finally` handling.

5. **Warm-process lifecycle**
   - Measure cold browser startup and warm-context creation separately.
   - Demonstrate that the same browser process can serve multiple isolated requests.
   - Demonstrate an idle shutdown equivalent to the planned five-minute policy without leaving an orphan. The harness may use a shorter injected timer to prove behavior rather than wasting five minutes.
   - Demonstrate clean recovery after a deliberately closed/crashed browser process if the spike can do so without broadening scope.

6. **Bounds and cancellation**
   - Apply the existing document timeout and download/normalized-size expectations where possible.
   - Show that parent cancellation closes the page/context promptly.
   - Record whether browser navigation requires a distinct timeout budget; do not silently add one to production configuration.
   - Prevent or close downloads, popups, and unexpected pages during the experiment.

7. **Resource observations**
   - Record installed artifact size, cold and warm latency, approximate idle/active memory, and process count.
   - These observations inform architecture; there is no invented pass/fail number until the user reviews them.

8. **Unexpected network activity**
   - Observe browser-origin requests sufficiently to identify unexpected background vendor/telemetry traffic.
   - Do not add a pile of privacy launch flags during the benchmark. Record findings first because unusual flags can damage fingerprint coherence.

### PoC completion report

The worker must return:

- exact Patchright and Chromium versions;
- commands and disposable paths used;
- environment prerequisites and any missing libraries;
- target-by-target static/browser comparison;
- context-isolation evidence;
- lifecycle and cleanup evidence;
- latency, memory, disk, and process observations;
- sandbox posture;
- unexpected network observations;
- failures, caveats, and unverified claims;
- a clear recommendation: pass, fail, or user decision required.

Do not return raw page bodies, credentials, cookies, or unbounded logs.

### Phase 0 pass criteria

Phase 0 passes only when all of the following are true:

- matching Chromium launches headlessly in the ordinary target container without a special image or service;
- no unacceptable sandbox exception or privilege requirement is hidden;
- Patchright/Chromium materially improves at least one representative real failure while preserving the control retrievals;
- useful rendered HTML passes through the existing normalizer and remains within package bounds;
- every request uses a demonstrably clean context;
- warm reuse and idle cleanup work without orphan processes;
- cancellation and failure cleanup are deterministic;
- resource and installation costs are reported and accepted by the user;
- the user approves the user-facing acceptance surface demonstrated by the PoC.

A browser merely launching or passing a fingerprint test is not enough.

### Phase 0 failure and stop behavior

Classify a failure as one or more of:

- **environment failure:** portable installation or safe execution is not feasible in the normal runtime;
- **efficacy failure:** Chromium launches but does not improve representative blocked targets;
- **integration failure:** output, bounds, cleanup, latency, memory, disk, or lifecycle behavior is unacceptable;
- **inconclusive:** the target set or evidence cannot answer the question.

On failure, stop. Do not automatically try Chrome, Camoufox, a cloud service, a proxy, more flags, or a site-specific workaround. Return to the Architect and user for one explicit next decision. Conditional production phases below remain unauthorized and must be revised or removed. The user has explicitly made that next decision for this track: the bounded Firefox-family comparison in the following section is authorized as diagnostic work only and does not relax any production or cleanup gate.

## Diagnostic Stage 2: approved Firefox-family comparison

The user approved a second, non-production comparison after the corrected Chromium-family bakeoff, with loser cleanup required after final rejection. This approval authorizes research, isolated dependency provisioning, browser downloads, and one bounded diagnostic comparison; it does not authorize production implementation, integration, commits, or worktree teardown.

### Candidates

- **Stock Playwright Firefox:** use the already researched Playwright package as the institutional baseline. It is not a stealth engine; its purpose is to show whether a different browser family changes the outcome. Playwright's Firefox artifact is a patched automation build and is not the user's branded system Firefox.
- **Camoufox:** evaluate the current Node route only after resolving its dependency compatibility. Research identified `camoufox-js@0.12.0`, Node `>=22`, a strict `playwright-core <1.61.0` peer requirement, an approximately 633 MiB Linux artifact, beta status, and a documented maintenance gap. The exact compatible isolated package shape is an architecture/dependency gate and must not be inferred from convenience.

### Bounded procedure

1. Reuse the fourteen-target matrix from the corrected Chromium-family bakeoff; do not add targets or repeat static baselines unless a target was not recorded.
2. Run one stock-Firefox browser navigation and one Camoufox browser navigation per target, from the same egress and with the same final-URL, redirect, private-network, timeout, rendered-size, normalization, marker, and challenge classification rules.
3. Use isolated subprocesses with start/result checkpoints, hard per-attempt deadlines, bounded normalized observations, and process-group cleanup. Do not retain raw page bodies, credentials, cookies, challenge logs, or unbounded diagnostics.
4. Do not use proxies, cloud services, CAPTCHA solving, login flows, arbitrary scripts, humanization, alternate search backends, or additional browser engines.
5. Record per-target status, verified content markers, challenge/auth/interstitial classification, latency, artifact size, and orphan-process state. Separate provider-family counts from URL counts.
6. Treat successful rendering of a control page as compatibility evidence, not anti-bot efficacy. A candidate must return verified target content, not merely HTTP 200 or a brand name.

### Stage 2 stop and cleanup gates

Stop and return for a decision if Camoufox cannot be installed without an unapproved dependency conflict, requires a service or proxy, cannot launch or clean up within the bounds, or needs a production-facing abstraction. After the user finally rejects a candidate, preserve its bounded evidence and reproducibility harness, remove that candidate's disposable package, browser artifacts, engine-specific configuration, and abandoned implementation, and verify no orphan processes. Never remove `/opt/playwright-browsers`, unrelated home caches, unrelated worktrees, or evidence required to interpret other candidates.

## Post-PoC decision checkpoint

After receiving the Phase 0 report, the Architect must:

1. verify that the evidence matches the approved target set and environment;
2. classify every failure and material caveat;
3. present resource observations and the user-facing retrieval evidence to the user;
4. ask for explicit acceptance or rejection of Patchright/Chromium as the production escalation mechanism;
5. settle any mechanism exposed by the PoC, especially dependency provisioning, timeout budget, and challenge classification;
6. record the disposition in this artifact before production dispatch.

A PoC pass does not itself authorize production implementation or commits.

## Conditional production implementation

Everything in this section is conditional on a recorded Phase 0 pass and separate execution approval.

### Intended retrieval flow

```text
completed snapshot cache hit
  -> return cached final snapshot

cache miss
  -> existing bounded static fetch
     -> normal usable document
        -> normalize, cache, return
     -> qualifying browser evidence AND browser escalation enabled
        -> one Patchright/Chromium attempt in a clean BrowserContext
           -> usable rendered document
              -> existing normalization, cache, return
           -> blocked/unavailable/timeout/failure
              -> structured bounded failure; stop
     -> non-qualifying static failure
        -> existing structured failure; stop
```

There is no third local engine and no cloud fallback.

### Configuration surface

The production change should add one narrow package setting representing:

- browser escalation disabled; or
- browser escalation enabled on qualifying block evidence.

**Recommended shape:** `documentBrowserEscalation: "off" | "on-block"`, defaulting to `"off"`.

The exact public property name remains a plan-review decision until accepted. Avoid separate settings for engine choice, profile persistence, arbitrary launch flags, browser pool size, humanization, cloud providers, or proxies.

Keep the five-minute idle lifetime as an internal settled default for the initial version rather than creating configuration surface without evidence. If Phase 0 proves the existing `documentTimeoutMs` cannot bound both stages appropriately, return for a specific timeout decision rather than inventing multiple tuning knobs.

### Qualifying escalation evidence

Keep the initial classifier narrow and explainable:

- an HTTP 403 from the static document request may qualify;
- the existing `client_rendered_shell` warning may qualify because the package already has evidence that static HTML is incomplete;
- a narrowly proven HTTP-200 verification/interstitial pattern may qualify only if Phase 0 encounters it and provides a deterministic, bounded classifier.

Do not escalate:

- HTTP 429, because a browser retry would disregard rate-limit evidence;
- HTTP 401 or 451;
- arbitrary 4xx/5xx statuses;
- DNS failures, connection failures, or generic timeouts without specific evidence that a browser changes the outcome;
- selector errors, invalid requests, unsupported content, oversized bodies, or normalization errors unrelated to rendering;
- every empty or low-content document.

If qualifying evidence remains ambiguous after Phase 0, stop for a decision rather than building a broad phrase list.

### Browser manager

Implement one small Patchright-specific browser manager; do not build a multi-engine plugin framework.

Required behavior:

- dynamically load the optional browser capability only when an escalation is required;
- launch one pinned Chromium executable lazily;
- reuse the browser process across escalations;
- allow only a bounded initial concurrency, preferably one browser escalation at a time unless Phase 0 demonstrates a need for more;
- reset a five-minute idle timer after each completed browser operation;
- use an unreferenced timer where appropriate so the timer alone cannot hold Pi open;
- close Chromium when idle, on known extension/process disposal, and after fatal browser failures;
- invalidate the manager after process exit and allow a later request to make one clean relaunch;
- never leave child processes after cancellation or shutdown;
- never expose arbitrary launch arguments to model input or package settings.

The implementation owner must read Pi's extension lifecycle documentation before relying on unload/reload hooks. If Pi provides no applicable disposal hook, use idle cleanup and narrowly scoped process-exit handling without adding a global lifecycle framework.

### Per-request browser context

For every browser attempt:

- create a new isolated `BrowserContext`;
- create one page in that context;
- do not import storage state or use a persistent user-data directory;
- start without cookies, local/session storage, cache, permissions, or browsing history from any earlier request;
- disable or deny downloads and unneeded permissions;
- close popups or unexpected extra pages;
- close page and context in `finally`, even on timeout or cancellation;
- do not persist state after the result is captured.

Keeping a browser process warm must never weaken request isolation.

### Navigation, security, and bounds

Browser execution changes the security boundary because untrusted page JavaScript runs. Preserve or strengthen the existing fetch restrictions:

- top-level input remains HTTP(S)-only, credential-free, and length-bounded;
- final URL and redirect chain must remain HTTP(S), credential-free, and bounded;
- preserve the five-redirect intent rather than allowing unbounded browser redirects;
- cancel navigation, page work, and HTML serialization through the existing parent signal;
- bound rendered HTML before it enters normalization; never return raw unbounded DOM or browser diagnostics;
- do not execute user-provided JavaScript or expose browser interaction primitives;
- do not accept downloads, file URLs, external protocols, permission prompts, or notification requests;
- define and test a policy preventing an untrusted public page from using browser subrequests to probe loopback, link-local, or private network targets, while preserving intentional retrieval when the user explicitly requests a local top-level URL;
- do not indiscriminately block ordinary scripts, styles, images, fonts, or browser metadata solely to save bandwidth; that can break rendering and fingerprint coherence;
- use Chromium's sandbox. Treat a required `--no-sandbox` runtime as a stop condition unless the user explicitly accepts the changed trust posture.

The private-network subrequest rule and redirect enforcement are architecture-sensitive. The implementation plan must not leave them to ad hoc worker judgment after Phase 0.

### Readiness and capture

Use one deterministic, bounded readiness strategy selected from Phase 0 evidence. Avoid `networkidle` as an unbounded universal requirement because modern pages may keep connections open. A likely shape is:

1. navigate with a bounded DOM readiness target;
2. allow one short, fixed rendering grace period only if evidence requires it;
3. serialize the final DOM once;
4. stop all page work and close the context.

Do not add humanized delays, random sleeps, mouse movement, or arbitrary site interactions.

### Normalization, cache, and cursors

- Browser capture produces HTML plus source metadata; it does not produce a separate Markdown format.
- Feed browser HTML through the existing `normalizeDocument` pipeline so selector, `main`/`full`, Readability, Markdown, warnings, normalization limits, line indexing, cursors, and grep semantics remain authoritative.
- Cache only the final usable snapshot. Do not cache a static challenge/shell when browser escalation succeeds.
- A browser-rendered snapshot uses the existing cache key and cursor contract because it is the final representation for the same requested operation/options in that process.
- Record bounded transport provenance so callers and tests can distinguish static success from browser escalation without exposing browser internals.
- Completed cache hits and identical in-flight requests should continue to avoid redundant outbound work.
- `forceRefresh` bypasses a completed snapshot but does not authorize additional retries or engines.
- Operational failures remain uncached.

### Outcomes and diagnostics

Add only the stable error/provenance surface needed to distinguish:

- browser capability not installed or executable unavailable;
- browser launch/runtime failure;
- browser timeout/cancellation;
- browser result still blocked;
- browser result unusable or over bounds.

Prefer one stable `browser_unavailable` code for missing optional capability and reuse existing `blocked`, `timeout`, `fetch_failed`, or `parse_failed` semantics where they remain accurate. Do not proliferate codes for library-specific exceptions.

The final outcome should record both attempts in bounded provenance when escalation occurs. It must not expose raw challenge HTML, cookies, environment paths beyond safe setup guidance, child-process command lines, or unbounded browser logs.

### Dependency and provisioning strategy

Phase 0 must determine the smallest standards-compliant packaging shape. The production package must remain independently installable and must declare every runtime dependency it uses.

Requirements regardless of exact npm mechanism:

- pin a compatible Patchright/Chromium pair;
- do not assume system Chrome;
- do not install a browser or OS packages during a document request;
- avoid forcing the large browser artifact onto users who leave escalation disabled;
- use standard browser cache locations outside the repository;
- provide an explicit opt-in setup command and readiness check;
- fail safely with actionable guidance when the optional capability is absent;
- document required Linux libraries without invoking privileged installation automatically;
- do not introduce a package-level postinstall surprise that silently downloads hundreds of megabytes for every user.

Whether Patchright belongs in `optionalDependencies`, an optional peer dependency, or another supported declared form remains gated on verified npm/Pi installation behavior from Phase 0. Do not violate package dependency rules to preserve leanness.

## Conditional implementation sequence

After Phase 0 acceptance and production execution approval, use this order:

1. **Contracts and configuration**
   - settle the single opt-in setting name;
   - add strict validation and default-off behavior;
   - define minimal browser availability/error/provenance contracts.

2. **Browser manager**
   - add Patchright-specific lazy loading;
   - implement pinned Chromium launch, single-process reuse, fresh contexts, cancellation, crash invalidation, five-minute idle cleanup, and bounded concurrency;
   - keep the manager injectable for deterministic tests.

3. **Browser document fetch**
   - implement bounded navigation, redirect/final-URL validation, private-network subrequest protection, readiness, DOM capture, and resource cleanup;
   - return the same document-fetch data shape where possible.

4. **Static-to-browser orchestration**
   - preserve current static behavior when disabled;
   - add only the approved escalation classifier;
   - make one browser attempt;
   - merge attempt provenance and stop after failure.

5. **Normalization/cache integration**
   - pass browser HTML through existing normalization;
   - cache only the final usable snapshot;
   - preserve cursor and grep behavior.

6. **Documentation and setup guidance**
   - document opt-in configuration, explicit Chromium provisioning, standard cache location, availability check, expected disk/RAM cost, clean-session semantics, five-minute warm process, structured failures, and uninstall/cache cleanup;
   - state clearly that no browser is used while the feature is disabled.

7. **Verification and user acceptance**
   - run complete child-package validation;
   - exercise the feature inside the ordinary container;
   - obtain explicit user acceptance of representative retrieval behavior before integration/closeout.

## Required tests

### Configuration and disabled behavior

- default configuration does not load Patchright or launch a browser;
- invalid setting values fail configuration validation;
- existing static-fetch tests pass unchanged when escalation is off;
- no browser artifact or process is required for default package validation.

### Escalation classification

- HTTP 403 escalates only when enabled;
- HTTP 429 never escalates and preserves retry guidance;
- HTTP 401/451 and unrelated failures do not escalate;
- `client_rendered_shell` escalates only when enabled;
- any accepted HTTP-200 challenge classifier has focused positive and negative fixtures;
- exactly one browser attempt occurs;
- final failure never loops or advances to another engine.

### Browser lifecycle and isolation

- lazy launch occurs on first qualifying escalation only;
- two requests reuse the browser process but receive distinct contexts;
- cookies and storage from request one are absent in request two;
- context and page close on success, error, timeout, and parent cancellation;
- idle expiry closes the browser;
- a crashed/closed browser invalidates state and can be relaunched once later;
- timers and child processes do not keep tests or Pi alive unexpectedly;
- bounded concurrency does not create a browser pool or race idle shutdown.

### Bounds and security

- invalid/credentialed/non-HTTP(S) top-level URLs remain rejected;
- redirect count and redirect target validation apply to browser navigation;
- rendered HTML is bounded before normalization;
- oversized output returns a structured bounded error;
- private/link-local/loopback browser subrequests from an untrusted public page follow the approved rule;
- explicit local top-level retrieval remains possible under that rule;
- downloads, popups, unsupported protocols, and permission prompts cannot escape the request;
- cancellation promptly terminates navigation and cleanup;
- tests never require disabling the Chromium sandbox.

### Normalization, cache, and tools

- rendered HTML uses the existing HTML normalizer;
- `main`, `full`, selectors, Markdown output, and warnings behave consistently;
- a successful browser snapshot supports both `read_url_content` paging and `grep_url_content` matching;
- browser success replaces the static shell/challenge before cache storage;
- completed cache hits avoid both static and browser work;
- identical in-flight requests coalesce;
- `forceRefresh` performs at most the same two-stage ladder;
- final content, details, warnings, attempt provenance, and diagnostics stay within protocol bounds.

### Package verification

Run the package's required independent checks after implementation:

```bash
npm run typecheck
npm run format
npm test
```

Because `npm run format` is mutating, inspect the diff afterward and ensure it changed only approved package files. Also run `git diff --check` and inspect child and superproject status. Validate from the superproject with the package-scoped commands required by repository guidance; do not run the destructive root formatter.

## Acceptance surface

The feature is user-facing. Before production acceptance, the user must observe or explicitly waive observation of:

- an ordinary page continuing to use the static path;
- a representative blocked or JavaScript-dependent page escalating once and returning useful normalized content;
- a still-blocked page failing cleanly after the browser attempt;
- disabled configuration requiring no browser;
- clean per-request session behavior;
- browser process reuse followed by idle shutdown;
- the actual installation, disk, latency, and memory cost in the normal container.

No phase may be called complete solely because unit tests pass or a synthetic fingerprint page reports success.

## Stop conditions

Stop and return to the Architect/user if:

- Phase 0 does not meet every pass criterion;
- Chromium requires a special image, external daemon, unsafe sandbox exception, or unapproved privilege change;
- Patchright's install behavior cannot preserve an opt-in heavy artifact while keeping dependencies correctly declared;
- representative pages remain blocked and a second engine/service/proxy is proposed;
- a broad or brittle challenge-signature catalogue becomes necessary;
- the implementation needs persistent cookies, profiles, credentials, arbitrary scripts, humanization, or browser interactions;
- private-network subrequest safety cannot be enforced without breaking approved local retrieval;
- timeout or resource behavior requires new user-facing tuning not yet approved;
- search backend or native-DDG work enters the diff;
- browser failures leak raw content, secrets, environment details, or unbounded logs;
- unrelated dirty-tree changes cannot be kept separate;
- explicit user-facing acceptance is missing.

## Completion criteria

This track is complete only when:

- Phase 0 evidence and disposition are recorded;
- the user explicitly accepts Patchright/Chromium after reviewing measured results;
- all post-PoC decisions are settled;
- the conditional implementation is completed within scope;
- package and repository checks pass;
- representative behavior is exercised in the normal container;
- the user approves the acceptance surface;
- documentation accurately describes optional installation, operation, resource cost, cleanup, and limitations;
- no alternative engine/service/proxy dependency or premature abstraction was added;
- every diagnostically evaluated loser has had its exclusive package, browser artifacts, configuration, and abandoned implementation removed after explicit rejection and cleanup authorization, while shared caches and bounded evidence remain intact;
- commits, if authorized by the approved route, follow child-package then superproject order.

## Remaining gates

1. **PoC target-set approval:** satisfied for the existing fourteen-target diagnostic matrix; any broader or replacement target set requires an explicit update.
2. **PoC routing/execution approval:** satisfied for the completed Chromium-family comparison and the separately authorized bounded Firefox-family Stage 2 comparison.
3. **Stage 2 dependency gate:** satisfied through the isolated Node `24.16.0` + `camoufox-js@0.12.0` + `playwright-core@1.60.0` arrangement and disposable runtime provisioning.
4. **Post-PoC architecture acceptance:** decide the final engine disposition and settle whether any evidence-backed classifier detail is suitable for production; Stage 2 measured outcomes are recorded but do not themselves authorize promotion.
5. **Loser cleanup authorization:** after each candidate is finally rejected, preserve bounded evidence, remove only exclusive loser artifacts/configuration/implementation, and verify no orphan processes.
6. **Production routing/execution approval:** authorize conditional production phases only after the plan is updated with the final diagnostic disposition.
7. **User-facing acceptance:** observe or waive the acceptance surface before integration/closeout.
8. **Commit authority:** follow the approved workflow or explicit instruction; plan approval alone does not authorize commits.
