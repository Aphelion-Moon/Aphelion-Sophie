# Sophie planning pack — revision log

## 1.1 · 18 September 2026 · Identity and asset integration

**Basis:** Existing Aphelion v1.0 plans, the unchanged WUFF hardware addendum, the user's Sophie naming direction, the replacement neon chibi protogen assets, and the request to update the plans.

### Integrated changes

Sophie (she/her), Community Services, is now the named presentation identity. The four latest protogen PNGs replace the human-era art for active branding. Chapter 12 documents observed appearance, exact assets, proposed voice guidance, placement, fallbacks and provenance. The artwork's captions are not treated as game lore or permissions.

Updated start/requirements, architecture, ticket/Shuttle presentation, non-ticket persona guidance, dashboard, security/provenance, Windows packaging, agent handoff and repository instructions. Updated the configuration sketch and machine-readable references. Added P36–P38 and T49–T52, producing 39 planned tasks and 52 specified application acceptance cases. Existing IDs remain stable; relevant dependencies and references were extended.

Added `brand-profile.json` and `asset-manifest.json`; bundled the four source PNGs unchanged. Regenerated the master Markdown and a self-contained offline HTML reader with embedded image previews. Preview encodings in the reader do not replace the original PNGs. Package integrity checks are documented separately from application acceptance.

### Unchanged decisions and open gates

No AI inside any ticket or The Shuttle, and no ticket-derived model data. MediaWiki remains the initial source. Phi-4-mini-instruct Q4_K_M / llama.cpp remains the evaluation baseline. Local CPU-only inference, no cloud fallback, one production bot identity, separate BYOND integration, the MIT adoption gate, storage approval, retention and production permissions remain unchanged.

No live website CSS, official insignia or font files were retrieved. No dependency licence was newly approved or revalidated. No model benchmark, application test, repository change, production deployment or Discord profile update was performed by this document revision.

### Hardware-overlay precedence

`Aphelion-Bot-WUFF-Hardware-Addendum.md` is included **byte-for-byte unchanged**. It still says it applies to v1.0 because it is the historical addendum; its shared-host proposals continue to apply to the same unchanged runtime architecture in v1.1. Where its settings differ from the retained generic runtime table or configuration sketch (for example queue 3 rather than 8, and separate 4/4 thread starting values), use the addendum during host evaluation. Do not treat either as approved production settings.

This branding revision adds explicit overlay references but does **not** silently merge the hardware configuration or mark its tests passed. The sanitised inventory is supplied; the private raw host dump is excluded. Current load, ports, service ownership and data-root approval still require verification.

### Source preservation

Earlier files outside this new versioned release were not overwritten. Human-era artwork is superseded, not deleted from the conversation. The new release contains neither that older artwork nor the raw WUFF export. Technical service/database identifiers are not renamed by the public Sophie name.
