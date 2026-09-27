# 11 · Research sources and verification record

**Research checked:** 18 September 2026. Primary documentation, project licences and model cards were consulted. No codebase security audit, full dependency audit, live Discord review, host benchmark or installation was performed. Documentation may describe a newer version than the eventual pinned implementation.

The numbered requirements are the user-approved product direction. Architecture details, defaults, test thresholds and proposed processes are engineering recommendations unless explicitly marked fixed. A citation establishes the stated upstream fact, not that the proposed application already satisfies it.

## Supplied sites

The owner supplied [Meridian About](https://meridian.a13.info/about/) as the design reference and [Meridian Wiki](https://meridian-wiki.a13.info/wiki/Main_Page) as the current knowledge source. Both failed to load through browsing in this session; a separate HTTP attempt also failed on name resolution in this environment. No CSS, images, wiki version, API endpoint or live article content was verified. This is not a diagnosis of the services' public availability.

Obtain an accessible authorised view or approved export during P03. Do not claim to have extracted exact branding, confirmed the API path, or indexed live content based on this pack.

## Primary-source register

<a id="s01"></a>

### S01 · Oceanic.js repository

[Oceanic.js repository](https://github.com/OceanicJS/Oceanic)

MIT project licence; released-version documentation and optional voice dependency. Pin and test the installed package.

<a id="s02"></a>

### S02 · Fastify licence

[Fastify licence](https://github.com/fastify/fastify/blob/main/LICENSE)

MIT project licence. This is not an audit of its resolved dependency tree.

<a id="s03"></a>

### S03 · React licence

[React licence](https://github.com/react/react/blob/main/LICENSE)

MIT project licence; review any chosen build tool and bundled dependencies separately.

<a id="s04"></a>

### S04 · llama.cpp repository

[llama.cpp repository](https://github.com/ggml-org/llama.cpp)

MIT project licence and local inference implementation. Native binary components/build options need separate inventory.

<a id="s05"></a>

### S05 · Microsoft Phi-4-mini-instruct model card

[Microsoft Phi-4-mini-instruct model card](https://huggingface.co/microsoft/Phi-4-mini-instruct)

MIT model card and 3.8B-parameter instruction model. Its published properties do not establish performance on the user's CPU.

<a id="s06"></a>

### S06 · Phi-4-mini-instruct GGUF candidate

[Phi-4-mini-instruct GGUF candidate](https://huggingface.co/unsloth/Phi-4-mini-instruct-GGUF)

MIT-labelled quantisation distribution. Verify the exact Q4_K_M artifact, revision, template and checksum before use.

<a id="s07"></a>

### S07 · Discord interaction responses

[Discord interaction responses](https://docs.discord.com/developers/interactions/receiving-and-responding)

Gateway versus HTTP delivery, interaction callback types, modal response handling, allowed mentions, three-second response deadline and fifteen-minute token lifetime.

<a id="s08"></a>

### S08 · Discord permissions

[Discord permissions](https://docs.discord.com/developers/topics/permissions)

Role hierarchy, channel overwrites, Administrator bypass and Manage Threads semantics relevant to private case design.

<a id="s09"></a>

### S09 · Discord OAuth2

[Discord OAuth2](https://docs.discord.com/developers/topics/oauth2)

Authorisation-code flow and OAuth state. The application still supplies its own guild/capability checks.

<a id="s10"></a>

### S10 · Discord gateway and intents

[Discord gateway and intents](https://docs.discord.com/developers/events/gateway)

Gateway event/intent configuration; review privileged member/message-content requirements for enabled features.

<a id="s11"></a>

### S11 · Discord Developer Policy

[Discord Developer Policy](https://support-dev.discord.com/hc/en-us/articles/8563934450327-Discord-Developer-Policy)

Policy restrictions on mining/scraping and training AI on API-obtained message content without Discord's express permission.

<a id="s12"></a>

### S12 · Node.js release schedule

[Node.js release schedule](https://nodejs.org/en/about/previous-releases)

Node 24 is an LTS line at the research date; production guidance favours LTS. Recheck the exact compatible patch at implementation.

<a id="s13"></a>

### S13 · WinSW repository

[WinSW repository](https://github.com/winsw/winsw)

MIT wrapper; repository differentiates stable 2.x releases from 3.x prereleases. Match documentation to the chosen major.

<a id="s14"></a>

### S14 · Node.js licence and notices

[Node.js licence and notices](https://github.com/nodejs/node/blob/main/LICENSE)

Runtime distribution includes third-party notices. Top-level project licensing alone is insufficient for a strict whole-distribution policy.

<a id="s15"></a>

### S15 · TypeScript compiler licence

[TypeScript compiler licence](https://github.com/microsoft/TypeScript/blob/main/LICENSE.txt)

Apache-2.0, not MIT. Compiler adoption is gated rather than assumed.

<a id="s16"></a>

### S16 · PostgreSQL licence

[PostgreSQL licence](https://www.postgresql.org/about/licence/)

PostgreSQL License, not MIT. The plan does not approve an exception.

<a id="s17"></a>

### S17 · pg-boss repository

[pg-boss repository](https://github.com/timgit/pg-boss)

MIT queue using PostgreSQL. Its licence does not approve the underlying database or guarantee exactly-once external effects.

<a id="s18"></a>

### S18 · PostgreSQL Windows distribution

[PostgreSQL Windows distribution](https://www.postgresql.org/download/windows/)

Lists Windows Server 2022 for supported installer versions. Platform support and licence approval are separate checks.

<a id="s19"></a>

### S19 · Transactional outbox pattern

[Transactional outbox pattern](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html)

Explains the state-change/message-delivery problem and idempotency considerations. Applied here as an architecture pattern, not copied code.

<a id="s20"></a>

### S20 · OWASP authorisation guidance

[OWASP authorisation guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html)

Deny-by-default and permission validation across operations.

<a id="s21"></a>

### S21 · OWASP retrieval-augmented generation security

[OWASP retrieval-augmented generation security](https://cheatsheetseries.owasp.org/cheatsheets/RAG_Security_Cheat_Sheet.html)

Preserve document access rules during retrieval and control derived/cached information.

<a id="s22"></a>

### S22 · OWASP prompt injection prevention

[OWASP prompt injection prevention](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html)

Treat external content as untrusted and independently constrain/authorise model tools.

<a id="s23"></a>

### S23 · MediaWiki parse API

[MediaWiki parse API](https://www.mediawiki.org/wiki/API:Parsing_wikitext)

Rendered content, revision metadata and structural fields. Current documentation marks sections deprecated in favour of tocdata; discover actual live capabilities.

<a id="s24"></a>

### S24 · MediaWiki recent changes API

[MediaWiki recent changes API](https://www.mediawiki.org/wiki/API:RecentChanges)

Incremental change enumeration and continuation. Supplement it with reconciliation and deletion/restriction handling.

<a id="s25"></a>

### S25 · MediaWiki embedded-in API

[MediaWiki embedded-in API](https://www.mediawiki.org/wiki/API:Embeddedin)

Find pages transcluding templates; supports the proposed dependency-refresh design.

<a id="s26"></a>

### S26 · MediaWiki siteinfo API

[MediaWiki siteinfo API](https://www.mediawiki.org/wiki/API:Siteinfo)

Site metadata and configured rights information. Individual content/asset rights still require review.

<a id="s27"></a>

### S27 · MediaWiki API etiquette

[MediaWiki API etiquette](https://www.mediawiki.org/wiki/API:Etiquette)

Descriptive clients, bounded work, batching and considerate error/backoff handling.

<a id="s28"></a>

### S28 · Fastify encapsulation

[Fastify encapsulation](https://fastify.dev/docs/latest/Reference/Encapsulation/)

Encapsulated plugin scopes support modular route/hook organisation, not hostile-code isolation.

<a id="s29"></a>

### S29 · Fastify validation and serialization

[Fastify validation and serialization](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/)

Executable schema compilation warning: do not accept arbitrary user-supplied compiler schemas as configuration.

<a id="s30"></a>

### S30 · llama.cpp server documentation

[llama.cpp server documentation](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md)

Windows serving and configurable HTTP features, including optional agent capabilities. Verify hardening flags against the pinned build.

<a id="s31"></a>

### S31 · W3C contrast guidance

[W3C contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)

Minimum text contrast: 4.5:1 ordinarily, 3:1 for large text, subject to the criterion's definitions and exceptions.

<a id="s32"></a>

### S32 · W3C animation from interactions

[W3C animation from interactions](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html)

Guidance on disabling nonessential interaction-triggered motion. The plan adopts reduced motion beyond the core AA target.

<a id="s33"></a>

### S33 · Docker Desktop Windows requirements

[Docker Desktop Windows requirements](https://docs.docker.com/desktop/setup/install/windows-install/)

Docker Desktop does not support Windows Server 2022; native deployment is planned.

## How to use this research

Recheck the exact installed version and its licence/notice files before adoption. Record source revisions and artifact hashes, not just these moving documentation URLs. No third-party source code, website artwork, binaries, font files or model weights are included. Version 1.1 adds the four conversation-generated Sophie image assets, with a separate provenance manifest; no new upstream research was performed for this branding revision.

This source list supports planning. It is not a guarantee of licence compatibility, performance, privacy-law compliance or production security.

## Version 1.1 supplied identity sources

The added identity chapter is based on this conversation: the selection of **Sophie**, the request **“Make her a neon chibi protogen”**, the latest four generated images, and the request to update the plans with that identity and those assets. It does not derive a biography, age, official insignia, new policy or new platform capability from the images.

The source attachment identifiers and image-generation identifiers are retained in `asset-manifest.json`. The final planning preparation measured image dimensions, colour modes, transparency presence, byte counts and SHA-256 from the actual PNG files. It did not test Discord upload limits or deploy them to the live bot.

The included WUFF addendum is the previously prepared, sanitised source for shared-host refinements. It is unchanged. The private raw diagnostic export is not in this pack. The historical source list above retains its original research date and caveats; it has not been revalidated by the identity update.
