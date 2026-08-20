---
'@atproto/pds': patch
---

Vendor `at.markpub.markdown` and sibling lexicons (`markpub.at`) as `site.standard.document`'s content format, plus two new Sunnahsky-owned facet lexicons (`com.sunnahsky.richtext.facets.formatting` for underline/color, `com.sunnahsky.richtext.facets.blocks` for paragraph alignment) covering rich-text toolbar features `at.markpub` doesn't reach. Empirically confirmed the `content` open union accepts a nested `at.markpub.markdown` value with a mix of upstream and custom facets under `validate: true`, round-tripping unchanged.
