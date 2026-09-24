import type { AtpAgent } from '@atproto/api'
import { TID, cidForCbor } from '@atproto/common'
import { TestNetworkNoAppView } from '@atproto/dev-env'
import { AtUri } from '@atproto/syntax'

// `PDS_APP_URL` in dev-env's builder (packages/dev-env/src/pds.ts) - the
// server-side write guard below (assertCanWriteRecord,
// packages/pds/src/api/com/atproto/repo/util.ts) validates every Striker
// publication/document write against this exactly, per "PDS hostname move
// and public URL scheme".
const APP_URL = 'https://sunnahsky.com'

// Dev-env's Striker handle domain is `.test` (serviceHandleDomains), so a
// handle's canonical name segment is everything before that suffix.
const canonicalUrl = (handle: string) =>
  `${APP_URL}/${handle.replace(/\.test$/, '')}`
const publicationSelfUri = (did: string) =>
  `at://${did}/site.standard.publication/self`
// TID's base32 alphabet is already `[a-z0-9-]`-safe (no `-` actually, but
// entirely `[a-z2-7]`), so a fresh one always satisfies the guard's path
// regex without needing per-test bookkeeping.
const freshArticlePath = () => `/article/${TID.nextStr()}`

describe('articles', () => {
  let network: TestNetworkNoAppView
  let strikerAgent: AtpAgent
  let striker2Agent: AtpAgent
  let catcherAgent: AtpAgent

  beforeAll(async () => {
    network = await TestNetworkNoAppView.create({
      dbPostgresSchema: 'articles',
    })
    strikerAgent = network.pds.getAgent()
    striker2Agent = network.pds.getAgent()
    catcherAgent = network.pds.getAgent()

    await strikerAgent.createAccount(
      {
        email: 'striker@test.com',
        handle: 'striker.test',
        password: 'striker-pass',
        role: 'striker',
      },
      { headers: network.pds.adminAuthHeaders(), encoding: 'application/json' },
    )

    // A second, independent Striker - needed to prove the guard rejects a
    // publication.url naming *another* real account's canonical segment,
    // and a document.site pointing at *another* account's publication, not
    // just a made-up host.
    await striker2Agent.createAccount(
      {
        email: 'striker2@test.com',
        handle: 'striker2.test',
        password: 'striker2-pass',
        role: 'striker',
      },
      { headers: network.pds.adminAuthHeaders(), encoding: 'application/json' },
    )

    await catcherAgent.createAccount({
      email: 'catcher@test.com',
      handle: 'catcher.guest.test',
      password: 'catcher-pass',
    })
  })

  afterAll(async () => {
    await network?.close()
  })

  it('a striker can create a publication with their own canonical url', async () => {
    const res = await strikerAgent.com.atproto.repo.createRecord({
      repo: strikerAgent.assertDid,
      collection: 'site.standard.publication',
      // literal:self, not a TID (lexicons/site/standard/publication.json) -
      // one publication per account, enforced at the record-key level, not
      // merely by app convention.
      rkey: 'self',
      record: {
        $type: 'site.standard.publication',
        url: canonicalUrl('striker.test'),
        name: "Striker's Publication",
      },
    })
    expect(res.data.uri).toBeDefined()

    const got = await strikerAgent.com.atproto.repo.getRecord({
      repo: strikerAgent.assertDid,
      collection: 'site.standard.publication',
      rkey: new AtUri(res.data.uri).rkey,
    })
    expect(got.data.value).toMatchObject({
      url: canonicalUrl('striker.test'),
      name: "Striker's Publication",
    })
  })

  it('a striker can create a document pointing at their own publication', async () => {
    const path = freshArticlePath()
    const res = await strikerAgent.com.atproto.repo.createRecord({
      repo: strikerAgent.assertDid,
      collection: 'site.standard.document',
      record: {
        $type: 'site.standard.document',
        site: publicationSelfUri(strikerAgent.assertDid),
        title: 'My First Article',
        publishedAt: new Date().toISOString(),
        path,
      },
    })
    expect(res.data.uri).toBeDefined()

    const got = await strikerAgent.com.atproto.repo.getRecord({
      repo: strikerAgent.assertDid,
      collection: 'site.standard.document',
      rkey: new AtUri(res.data.uri).rkey,
    })
    expect(got.data.value).toMatchObject({
      site: publicationSelfUri(strikerAgent.assertDid),
      title: 'My First Article',
      path,
    })
  })

  // "PDS hostname move and public URL scheme" - the write guard
  // (assertCanWriteRecord) content checks, added so publication.url and
  // document.site/path are server-enforced, not merely client-trusted.
  describe('publication/document url guard', () => {
    it('rejects a publication url pointing off-platform', async () => {
      await expect(
        strikerAgent.com.atproto.repo.createRecord({
          repo: strikerAgent.assertDid,
          collection: 'site.standard.publication',
          record: {
            $type: 'site.standard.publication',
            url: 'https://evil.example/x',
            name: 'Phishing attempt',
          },
        }),
      ).rejects.toThrow(
        "Publication url must be this account's canonical Sunnahsky URL",
      )
    })

    it("rejects a publication url naming another Striker's own segment", async () => {
      await expect(
        strikerAgent.com.atproto.repo.createRecord({
          repo: strikerAgent.assertDid,
          collection: 'site.standard.publication',
          record: {
            $type: 'site.standard.publication',
            url: canonicalUrl('striker2.test'),
            name: 'Impersonation attempt',
          },
        }),
      ).rejects.toThrow(
        "Publication url must be this account's canonical Sunnahsky URL",
      )
    })

    it('accepts the correct canonical publication url', async () => {
      // #update, not #create: strikerAgent already has a publication at
      // rkey 'self' by this point in the file (one per account, literal:self
      // - see the top-level "can create a publication" test above), so this
      // exercises the guard's acceptance path via the write shape that's
      // actually reachable a second time onward.
      const res = await strikerAgent.com.atproto.repo.applyWrites({
        repo: strikerAgent.assertDid,
        writes: [
          {
            $type: 'com.atproto.repo.applyWrites#update',
            collection: 'site.standard.publication',
            rkey: 'self',
            value: {
              $type: 'site.standard.publication',
              url: canonicalUrl('striker.test'),
              name: 'Correct url check',
            },
          },
        ],
      })
      expect(res.data.results).toHaveLength(1)
    })

    it("rejects a document whose site points at another account's publication", async () => {
      await expect(
        strikerAgent.com.atproto.repo.createRecord({
          repo: strikerAgent.assertDid,
          collection: 'site.standard.document',
          record: {
            $type: 'site.standard.document',
            site: publicationSelfUri(striker2Agent.assertDid),
            title: 'Cross-account impersonation attempt',
            publishedAt: new Date().toISOString(),
            path: freshArticlePath(),
          },
        }),
      ).rejects.toThrow("Document site must be this account's own publication")
    })

    it('rejects a document path outside /article/{slug}', async () => {
      await expect(
        strikerAgent.com.atproto.repo.createRecord({
          repo: strikerAgent.assertDid,
          collection: 'site.standard.document',
          record: {
            $type: 'site.standard.document',
            site: publicationSelfUri(strikerAgent.assertDid),
            title: 'Bad path check',
            publishedAt: new Date().toISOString(),
            path: `/article/${strikerAgent.assertDid}/3abc`,
          },
        }),
      ).rejects.toThrow('Document path must match /article/{slug}')
    })

    it('rejects a document with no path at all', async () => {
      await expect(
        strikerAgent.com.atproto.repo.createRecord({
          repo: strikerAgent.assertDid,
          collection: 'site.standard.document',
          record: {
            $type: 'site.standard.document',
            site: publicationSelfUri(strikerAgent.assertDid),
            title: 'Missing path check',
            publishedAt: new Date().toISOString(),
          },
        }),
      ).rejects.toThrow('Document path must match /article/{slug}')
    })

    it('applies the same content checks to applyWrites#update, not just create', async () => {
      // putRecord (create-or-replace), not createRecord: strikerAgent may
      // already have a publication at rkey 'self' from an earlier test in
      // this file (one per account, literal:self) - putRecord succeeds
      // either way, so this setup step doesn't depend on file execution
      // order the way a plain createRecord would.
      await strikerAgent.com.atproto.repo.putRecord({
        repo: strikerAgent.assertDid,
        collection: 'site.standard.publication',
        rkey: 'self',
        record: {
          $type: 'site.standard.publication',
          url: canonicalUrl('striker.test'),
          name: 'Update-path check',
        },
      })

      await expect(
        strikerAgent.com.atproto.repo.applyWrites({
          repo: strikerAgent.assertDid,
          writes: [
            {
              $type: 'com.atproto.repo.applyWrites#update',
              collection: 'site.standard.publication',
              rkey: 'self',
              value: {
                $type: 'site.standard.publication',
                url: 'https://evil.example/renamed',
                name: 'Update-path check, renamed',
              },
            },
          ],
        }),
      ).rejects.toThrow(
        "Publication url must be this account's canonical Sunnahsky URL",
      )

      const docRkey = TID.nextStr()
      await strikerAgent.com.atproto.repo.createRecord({
        repo: strikerAgent.assertDid,
        collection: 'site.standard.document',
        rkey: docRkey,
        record: {
          $type: 'site.standard.document',
          site: publicationSelfUri(strikerAgent.assertDid),
          title: 'Document update-path check',
          publishedAt: new Date().toISOString(),
          path: freshArticlePath(),
        },
      })

      await expect(
        strikerAgent.com.atproto.repo.applyWrites({
          repo: strikerAgent.assertDid,
          writes: [
            {
              $type: 'com.atproto.repo.applyWrites#update',
              collection: 'site.standard.document',
              rkey: docRkey,
              value: {
                $type: 'site.standard.document',
                site: publicationSelfUri(striker2Agent.assertDid),
                title: 'Document update-path check, retargeted',
                publishedAt: new Date().toISOString(),
                path: freshArticlePath(),
              },
            },
          ],
        }),
      ).rejects.toThrow("Document site must be this account's own publication")
    })

    // "PDS hostname move and public URL scheme", follow-up: the record-key
    // format (lexicons/site/standard/publication.json's key, literal:self)
    // is a *separate* enforcement layer from the content checks above, and
    // the two were never actually exercised together against a real dev-env
    // PDS before this - every existing test in this file either omitted
    // `rkey` (silently defaulting to a fresh TID, which happened to satisfy
    // the *old* upstream `tid` key format) or passed one explicitly, so
    // none of them proved `'self'` itself is an acceptable - or required -
    // key. A dry run against a real built image is what actually caught
    // this: `publishArticle`'s real first-publish call uses exactly the
    // shape below, and it was rejected outright before ever reaching the
    // content checks.
    it("writes publishArticle's real first-publish payload: applyWrites#create for both the publication (rkey 'self') and its document, atomically", async () => {
      const freshStriker = network.pds.getAgent()
      await freshStriker.createAccount(
        {
          email: 'freshpublish@test.com',
          handle: 'freshpublish.test',
          password: 'freshpublish-pass',
          role: 'striker',
        },
        {
          headers: network.pds.adminAuthHeaders(),
          encoding: 'application/json',
        },
      )
      const path = freshArticlePath()

      const res = await freshStriker.com.atproto.repo.applyWrites({
        repo: freshStriker.assertDid,
        writes: [
          {
            $type: 'com.atproto.repo.applyWrites#create',
            collection: 'site.standard.publication',
            rkey: 'self',
            value: {
              $type: 'site.standard.publication',
              url: canonicalUrl('freshpublish.test'),
              name: "Fresh Striker's Publication",
            },
          },
          {
            $type: 'com.atproto.repo.applyWrites#create',
            collection: 'site.standard.document',
            rkey: TID.nextStr(),
            value: {
              $type: 'site.standard.document',
              site: publicationSelfUri(freshStriker.assertDid),
              title: 'First Article',
              publishedAt: new Date().toISOString(),
              path,
            },
          },
        ],
      })
      expect(res.data.results).toHaveLength(2)

      const pub = await freshStriker.com.atproto.repo.getRecord({
        repo: freshStriker.assertDid,
        collection: 'site.standard.publication',
        rkey: 'self',
      })
      expect(pub.data.value).toMatchObject({
        url: canonicalUrl('freshpublish.test'),
      })
    })

    // The inverse of the test above: literal:self is what actually makes
    // "one publication per account" true server-side, not merely an app
    // convention nothing enforces. Content here is otherwise entirely
    // valid (a fresh account's own correct canonical url) specifically so
    // this rejection is attributable to the record-key check alone, not
    // the content guard - if `assertCanWriteRecord` ever ran before key
    // validation instead of after, this test would start failing for the
    // wrong reason (a content-check error) rather than passing for the
    // right one.
    it('rejects a publication written with a TID-format rkey instead of literal self', async () => {
      const tidStriker = network.pds.getAgent()
      await tidStriker.createAccount(
        {
          email: 'tidrkey@test.com',
          handle: 'tidrkey.test',
          password: 'tidrkey-pass',
          role: 'striker',
        },
        {
          headers: network.pds.adminAuthHeaders(),
          encoding: 'application/json',
        },
      )

      await expect(
        tidStriker.com.atproto.repo.createRecord({
          repo: tidStriker.assertDid,
          collection: 'site.standard.publication',
          rkey: TID.nextStr(),
          record: {
            $type: 'site.standard.publication',
            url: canonicalUrl('tidrkey.test'),
            name: "TID-keyed Striker's Publication",
          },
        }),
      ).rejects.toThrow('Invalid record key for site.standard.publication')
    })

    // A Catcher's write is rejected by the role gate before the content
    // checks above ever run - the two error identities must not compete for
    // the same write (third review, point 5). Record content here is
    // deliberately invalid by the content-check rules too (off-platform
    // url), so a pass here that returned InvalidPublicationUrl instead of
    // CatcherArticleWriteNotAllowed would mean the ordering regressed.
    it('rejects a Catcher before ever reaching the content checks', async () => {
      await expect(
        catcherAgent.com.atproto.repo.createRecord({
          repo: catcherAgent.assertDid,
          collection: 'site.standard.publication',
          record: {
            $type: 'site.standard.publication',
            url: 'https://evil.example/also-not-allowed',
            name: "Catcher's Publication",
          },
        }),
      ).rejects.toThrow(
        'Catchers cannot create or edit articles or publications.',
      )
    })

    // An account can transiently have no handle (Actor.handle is
    // HandleString | null) - the guard must reject rather than crash on
    // `canonicalNameSegment(null)`. No supported API sets a handle to null,
    // so this reaches directly into the account DB, the same class of
    // direct-DB-access this project's own test suite already uses when the
    // public API has no path to a given state.
    it('rejects a publication write from an account with no handle', async () => {
      const nullHandleAgent = network.pds.getAgent()
      await nullHandleAgent.createAccount(
        {
          email: 'nullhandle@test.com',
          handle: 'nullhandle.test',
          password: 'nullhandle-pass',
          role: 'striker',
        },
        {
          headers: network.pds.adminAuthHeaders(),
          encoding: 'application/json',
        },
      )
      await network.pds.ctx.accountManager.db.db
        .updateTable('actor')
        .set({ handle: null })
        .where('did', '=', nullHandleAgent.assertDid)
        .execute()

      await expect(
        nullHandleAgent.com.atproto.repo.createRecord({
          repo: nullHandleAgent.assertDid,
          collection: 'site.standard.publication',
          record: {
            $type: 'site.standard.publication',
            url: canonicalUrl('nullhandle.test'),
            name: "Null-handle account's publication",
          },
        }),
      ).rejects.toThrow(
        'Cannot write a publication without a registered handle',
      )
    })
  })

  it('a catcher cannot create a publication', async () => {
    await expect(
      catcherAgent.com.atproto.repo.createRecord({
        repo: catcherAgent.assertDid,
        collection: 'site.standard.publication',
        record: {
          $type: 'site.standard.publication',
          url: 'https://catcher.test',
          name: "Catcher's Publication",
        },
      }),
    ).rejects.toThrow(
      'Catchers cannot create or edit articles or publications.',
    )
  })

  it('a catcher cannot create a document', async () => {
    await expect(
      catcherAgent.com.atproto.repo.createRecord({
        repo: catcherAgent.assertDid,
        collection: 'site.standard.document',
        record: {
          $type: 'site.standard.document',
          site: 'https://catcher.test',
          title: 'Should not work',
          publishedAt: new Date().toISOString(),
        },
      }),
    ).rejects.toThrow(
      'Catchers cannot create or edit articles or publications.',
    )
  })

  // Regression coverage for the article-editing feature: `assertCanWriteRecord`
  // (packages/pds/src/api/com/atproto/repo/util.ts) is documented to cover
  // "every write path that can persist these record types - create or
  // update, not just createRecord" - this proves that holds for the
  // `applyWrites#update` path specifically, which is what the article-edit
  // feature's `publishArticle()` actually issues (not `putRecord`). The
  // check fires purely off role + collection before any record lookup, so
  // no real pre-existing document is needed for this to be a meaningful
  // rejection test.
  it('a catcher cannot update a document via applyWrites', async () => {
    await expect(
      catcherAgent.com.atproto.repo.applyWrites({
        repo: catcherAgent.assertDid,
        writes: [
          {
            $type: 'com.atproto.repo.applyWrites#update',
            collection: 'site.standard.document',
            rkey: TID.nextStr(),
            value: {
              $type: 'site.standard.document',
              site: 'https://catcher.test',
              title: 'Should not work either',
              publishedAt: new Date().toISOString(),
            },
          },
        ],
      }),
    ).rejects.toThrow(
      'Catchers cannot create or edit articles or publications.',
    )
  })

  // Regression coverage for `com.sunnahsky.article.assets` specifically
  // (packages/pds/src/api/com/atproto/repo/util.ts's `assertCanWriteRecord`,
  // added alongside the two `site.standard` collections above). That
  // function falls through to *allow* any collection it does not name, so
  // this collection being writable by Catchers is exactly the failure mode
  // a missing branch would produce silently - the same class of gap this
  // project has been burned by before when a shared guard's coverage was
  // assumed per-collection rather than verified. `document` doesn't need to
  // point at a real record: the role check fires purely off role +
  // collection before any record lookup, same as the update-document test
  // above.
  it('a catcher cannot create an assets record', async () => {
    await expect(
      catcherAgent.com.atproto.repo.createRecord({
        repo: catcherAgent.assertDid,
        collection: 'com.sunnahsky.article.assets',
        record: {
          $type: 'com.sunnahsky.article.assets',
          document: AtUri.make(
            catcherAgent.assertDid,
            'site.standard.document',
            TID.nextStr(),
          ).toString(),
          images: [],
        },
      }),
    ).rejects.toThrow(
      'Catchers cannot create or edit articles or publications.',
    )
  })

  it('a catcher cannot update an assets record via applyWrites', async () => {
    await expect(
      catcherAgent.com.atproto.repo.applyWrites({
        repo: catcherAgent.assertDid,
        writes: [
          {
            $type: 'com.atproto.repo.applyWrites#update',
            collection: 'com.sunnahsky.article.assets',
            rkey: TID.nextStr(),
            value: {
              $type: 'com.sunnahsky.article.assets',
              document: AtUri.make(
                catcherAgent.assertDid,
                'site.standard.document',
                TID.nextStr(),
              ).toString(),
              images: [],
            },
          },
        ],
      }),
    ).rejects.toThrow(
      'Catchers cannot create or edit articles or publications.',
    )
  })

  // "Live now" is for Strikers only (owner decision, 2026-09-24).
  // `assertCanWriteRecord` falls through to allow any collection it doesn't
  // name, so each write path gets its own rejection test, the same way the
  // assets record does above.
  describe('live status is for Strikers only', () => {
    const liveStatus = () => ({
      $type: 'app.bsky.actor.status',
      status: 'app.bsky.actor.status#live',
      durationMinutes: 60,
      createdAt: new Date().toISOString(),
    })

    it('a catcher cannot set a live status with createRecord', async () => {
      await expect(
        catcherAgent.com.atproto.repo.createRecord({
          repo: catcherAgent.assertDid,
          collection: 'app.bsky.actor.status',
          rkey: 'self',
          record: liveStatus(),
        }),
      ).rejects.toThrow('Catchers cannot set a live status.')
    })

    it('a catcher cannot set a live status with putRecord', async () => {
      await expect(
        catcherAgent.com.atproto.repo.putRecord({
          repo: catcherAgent.assertDid,
          collection: 'app.bsky.actor.status',
          rkey: 'self',
          record: liveStatus(),
        }),
      ).rejects.toThrow('Catchers cannot set a live status.')
    })

    it('a catcher cannot set a live status with applyWrites', async () => {
      await expect(
        catcherAgent.com.atproto.repo.applyWrites({
          repo: catcherAgent.assertDid,
          writes: [
            {
              $type: 'com.atproto.repo.applyWrites#create',
              collection: 'app.bsky.actor.status',
              rkey: 'self',
              value: liveStatus(),
            },
          ],
        }),
      ).rejects.toThrow('Catchers cannot set a live status.')
    })

    it('a catcher can still delete a live status', async () => {
      await expect(
        catcherAgent.com.atproto.repo.deleteRecord({
          repo: catcherAgent.assertDid,
          collection: 'app.bsky.actor.status',
          rkey: 'self',
        }),
      ).resolves.toBeDefined()
    })

    it('a striker can set and clear a live status', async () => {
      const put = await strikerAgent.com.atproto.repo.putRecord({
        repo: strikerAgent.assertDid,
        collection: 'app.bsky.actor.status',
        rkey: 'self',
        record: liveStatus(),
      })
      expect(put.data.uri).toBe(
        `at://${strikerAgent.assertDid}/app.bsky.actor.status/self`,
      )
      await expect(
        strikerAgent.com.atproto.repo.deleteRecord({
          repo: strikerAgent.assertDid,
          collection: 'app.bsky.actor.status',
          rkey: 'self',
        }),
      ).resolves.toBeDefined()
    })
  })

  it('writes a document and its companion post atomically, with a pre-computed bskyPostRef', async () => {
    // The companion post's rkey and CID are computed client-side, before
    // either record is submitted, so the document's bskyPostRef can point
    // at the post from the very first write — no read-back/second call
    // needed for true single-commit atomicity.
    const postRkey = TID.nextStr()
    const docRkey = TID.nextStr()

    const postRecord = {
      $type: 'app.bsky.feed.post',
      text: 'New article: My Atomic Article',
      createdAt: new Date().toISOString(),
    }
    const postCid = await cidForCbor(postRecord)
    const postUri = AtUri.make(
      strikerAgent.assertDid,
      'app.bsky.feed.post',
      postRkey,
    )

    const documentRecord = {
      $type: 'site.standard.document',
      site: publicationSelfUri(strikerAgent.assertDid),
      path: freshArticlePath(),
      title: 'My Atomic Article',
      publishedAt: new Date().toISOString(),
      bskyPostRef: {
        uri: postUri.toString(),
        cid: postCid.toString(),
      },
    }

    const {
      data: { results },
    } = await strikerAgent.com.atproto.repo.applyWrites({
      repo: strikerAgent.assertDid,
      writes: [
        {
          $type: 'com.atproto.repo.applyWrites#create',
          collection: 'app.bsky.feed.post',
          rkey: postRkey,
          value: postRecord,
        },
        {
          $type: 'com.atproto.repo.applyWrites#create',
          collection: 'site.standard.document',
          rkey: docRkey,
          value: documentRecord,
        },
      ],
    })

    expect(results).toHaveLength(2)
    const [postResult, docResult] = results as {
      uri?: string
      cid?: string
    }[]
    // Proves the pre-computation was actually correct, not just that both
    // writes landed: the real post ref returned by the server matches
    // exactly what was written into the document's bskyPostRef beforehand.
    expect(postResult.uri).toBe(postUri.toString())
    expect(postResult.cid).toBe(postCid.toString())
    expect(docResult.uri).toBeDefined()

    const gotDoc = await strikerAgent.com.atproto.repo.getRecord({
      repo: strikerAgent.assertDid,
      collection: 'site.standard.document',
      rkey: docRkey,
    })
    expect(
      (gotDoc.data.value as { bskyPostRef?: unknown }).bskyPostRef,
    ).toEqual({
      uri: postResult.uri,
      cid: postResult.cid,
    })
  })

  it('validate: true rejects a malformed document instead of silently accepting it', async () => {
    await expect(
      strikerAgent.com.atproto.repo.createRecord({
        repo: strikerAgent.assertDid,
        collection: 'site.standard.document',
        validate: true,
        record: {
          $type: 'site.standard.document',
          // site/path are valid (satisfying the write guard) so the
          // rejection below is provably the lexicon's, for the still-missing
          // required field `publishedAt` - not the guard's own content check.
          site: publicationSelfUri(strikerAgent.assertDid),
          path: freshArticlePath(),
          title: 'Missing required publishedAt field',
        },
      }),
    ).rejects.toThrow(/Invalid site\.standard\.document record/)
  })

  it('a well-formed document now validates as "valid" instead of "unknown"', async () => {
    const res = await strikerAgent.com.atproto.repo.createRecord({
      repo: strikerAgent.assertDid,
      collection: 'site.standard.document',
      record: {
        $type: 'site.standard.document',
        site: publicationSelfUri(strikerAgent.assertDid),
        path: freshArticlePath(),
        title: 'Validation status check',
        publishedAt: new Date().toISOString(),
      },
    })
    expect(res.data.validationStatus).toBe('valid')
  })

  // Empirical check for `articles client ui plan.md`'s Phase 1, step 4: the
  // lexicon has no native `category` field. Confirmed by actually running
  // this against a live local dev PDS, not assumed: an unrecognized
  // extension property is neither rejected nor silently stripped under
  // `validate: true` - it's accepted and preserved verbatim on read-back.
  // No `validate: false` escape hatch is needed for this field.
  it('validate: true accepts and preserves an unrecognized `category` extension field', async () => {
    const res = await strikerAgent.com.atproto.repo.createRecord({
      repo: strikerAgent.assertDid,
      collection: 'site.standard.document',
      validate: true,
      record: {
        $type: 'site.standard.document',
        site: publicationSelfUri(strikerAgent.assertDid),
        path: freshArticlePath(),
        title: 'Category extension field check',
        publishedAt: new Date().toISOString(),
        category: 'fiqh',
      },
    })
    expect(res.data.validationStatus).toBe('valid')

    const got = await strikerAgent.com.atproto.repo.getRecord({
      repo: strikerAgent.assertDid,
      collection: 'site.standard.document',
      rkey: new AtUri(res.data.uri).rkey,
    })
    expect((got.data.value as { category?: unknown }).category).toBe('fiqh')
  })

  // Same mechanism as the `category` check above, for a distinct need: credit
  // for the actual human contributor (author/translator) as opposed to the
  // Striker account doing the posting - e.g. an institutional Striker
  // publishing a named scholar's lecture transcript. Free text, decided
  // directly with the project owner rather than a structured/strongRef
  // contributor record, since a canonical cross-article contributor entity
  // isn't needed yet. Confirmed empirically, same as `category`: an
  // unrecognized extension property survives `validate: true` unstripped.
  it('validate: true accepts and preserves unrecognized `author`/`translator` extension fields', async () => {
    const res = await strikerAgent.com.atproto.repo.createRecord({
      repo: strikerAgent.assertDid,
      collection: 'site.standard.document',
      validate: true,
      record: {
        $type: 'site.standard.document',
        site: publicationSelfUri(strikerAgent.assertDid),
        path: freshArticlePath(),
        title: 'Author/translator extension field check',
        publishedAt: new Date().toISOString(),
        author: 'Imam Ahmad ibn Hanbal',
        translator: 'Zubair Ibrahim',
      },
    })
    expect(res.data.validationStatus).toBe('valid')

    const got = await strikerAgent.com.atproto.repo.getRecord({
      repo: strikerAgent.assertDid,
      collection: 'site.standard.document',
      rkey: new AtUri(res.data.uri).rkey,
    })
    const value = got.data.value as { author?: unknown; translator?: unknown }
    expect(value.author).toBe('Imam Ahmad ibn Hanbal')
    expect(value.translator).toBe('Zubair Ibrahim')
  })

  // Widening from `category`/`author`/`translator` extension fields (checked
  // singular above) to `categories`/`authors`/`translators` arrays - the
  // ArticleCompose Figma pass made all three multi-select, per the design
  // owner. Still just unrecognized extension properties, not real lexicon
  // schema members, so this is confirming the same PDS behavior extends to
  // an array value, not a new mechanism.
  it('validate: true accepts and preserves array-shaped `authors`/`translators`/`categories` extension fields', async () => {
    const res = await strikerAgent.com.atproto.repo.createRecord({
      repo: strikerAgent.assertDid,
      collection: 'site.standard.document',
      validate: true,
      record: {
        $type: 'site.standard.document',
        site: publicationSelfUri(strikerAgent.assertDid),
        path: freshArticlePath(),
        title: 'Multi-select author/translator/category extension field check',
        publishedAt: new Date().toISOString(),
        authors: ['Imam Ahmad ibn Hanbal'],
        translators: ['Zubair Ibrahim', 'Abu Inayah Seif'],
        categories: ['Aqidah (Creed)', 'Fiqh (Jurisprudence)'],
      },
    })
    expect(res.data.validationStatus).toBe('valid')

    const got = await strikerAgent.com.atproto.repo.getRecord({
      repo: strikerAgent.assertDid,
      collection: 'site.standard.document',
      rkey: new AtUri(res.data.uri).rkey,
    })
    const value = got.data.value as {
      authors?: unknown
      translators?: unknown
      categories?: unknown
    }
    expect(value.authors).toEqual(['Imam Ahmad ibn Hanbal'])
    expect(value.translators).toEqual(['Zubair Ibrahim', 'Abu Inayah Seif'])
    expect(value.categories).toEqual(['Aqidah (Creed)', 'Fiqh (Jurisprudence)'])
  })

  // Empirical check for `articles client ui plan.md`'s Phase 2a: proves the
  // `content` union accepts a real at.markpub.markdown value - not just a
  // flat extension property like `category`/`author`/`translator` above, but
  // a nested $type-tagged object with its own facets array - and that a mix
  // of an upstream at.markpub facet and two new Sunnahsky-owned custom facets
  // (com.sunnahsky.richtext.facets.formatting#underline,
  // com.sunnahsky.richtext.facets.blocks#textAlign) round-trips unchanged.
  // Byte offsets below are correct for the exact literal string used (pure
  // ASCII, so byte and character indices coincide) - recompute if the string
  // ever changes.
  it('validate: true accepts and preserves a real at.markpub.markdown content value with custom facets', async () => {
    const res = await strikerAgent.com.atproto.repo.createRecord({
      repo: strikerAgent.assertDid,
      collection: 'site.standard.document',
      validate: true,
      record: {
        $type: 'site.standard.document',
        site: publicationSelfUri(strikerAgent.assertDid),
        path: freshArticlePath(),
        title: 'Content lexicon round-trip check',
        publishedAt: new Date().toISOString(),
        content: {
          $type: 'at.markpub.markdown',
          flavor: 'gfm',
          text: {
            $type: 'at.markpub.text',
            markdown: 'This is bold and this is underlined.',
            facets: [
              {
                $type: 'at.markpub.facets.baseFormatting',
                index: { byteStart: 8, byteEnd: 12 },
                features: [
                  { $type: 'at.markpub.facets.baseFormatting#strong' },
                ],
              },
              {
                $type: 'com.sunnahsky.richtext.facets.formatting',
                index: { byteStart: 25, byteEnd: 35 },
                features: [
                  {
                    $type: 'com.sunnahsky.richtext.facets.formatting#underline',
                  },
                ],
              },
              {
                $type: 'com.sunnahsky.richtext.facets.blocks',
                index: { byteStart: 0, byteEnd: 36 },
                features: [
                  {
                    $type: 'com.sunnahsky.richtext.facets.blocks#textAlign',
                    value: 'center',
                  },
                ],
              },
            ],
          },
        },
      },
    })
    expect(res.data.validationStatus).toBe('valid')

    const got = await strikerAgent.com.atproto.repo.getRecord({
      repo: strikerAgent.assertDid,
      collection: 'site.standard.document',
      rkey: new AtUri(res.data.uri).rkey,
    })
    const value = got.data.value as {
      content?: { text?: { markdown?: unknown; facets?: unknown[] } }
    }
    expect(value.content?.text?.markdown).toBe(
      'This is bold and this is underlined.',
    )
    expect(value.content?.text?.facets).toHaveLength(3)
    expect(value.content?.text?.facets?.[1]).toMatchObject({
      $type: 'com.sunnahsky.richtext.facets.formatting',
      index: { byteStart: 25, byteEnd: 35 },
      features: [
        { $type: 'com.sunnahsky.richtext.facets.formatting#underline' },
      ],
    })
    expect(value.content?.text?.facets?.[2]).toMatchObject({
      $type: 'com.sunnahsky.richtext.facets.blocks',
      index: { byteStart: 0, byteEnd: 36 },
      features: [
        {
          $type: 'com.sunnahsky.richtext.facets.blocks#textAlign',
          value: 'center',
        },
      ],
    })
  })

  // Confirms the `#typography` facet added alongside `#textAlign` in
  // `com.sunnahsky.richtext.facets.blocks#main`'s `features` union (for
  // Arabic Paragraph / Arabic Block Quote) round-trips unchanged, and that a
  // single document can carry both union members across two different
  // paragraphs. Byte offsets are correct for the exact literal string used
  // (pure ASCII except the second line, encoded as UTF-8 - recompute if the
  // string ever changes).
  it('validate: true accepts and preserves a #typography facet alongside #textAlign', async () => {
    const markdown = 'Centered line.\nArabic paragraph line.'
    const res = await strikerAgent.com.atproto.repo.createRecord({
      repo: strikerAgent.assertDid,
      collection: 'site.standard.document',
      validate: true,
      record: {
        $type: 'site.standard.document',
        site: publicationSelfUri(strikerAgent.assertDid),
        path: freshArticlePath(),
        title: 'Typography facet round-trip check',
        publishedAt: new Date().toISOString(),
        content: {
          $type: 'at.markpub.markdown',
          flavor: 'gfm',
          text: {
            $type: 'at.markpub.text',
            markdown,
            facets: [
              {
                $type: 'com.sunnahsky.richtext.facets.blocks',
                index: { byteStart: 0, byteEnd: 14 },
                features: [
                  {
                    $type: 'com.sunnahsky.richtext.facets.blocks#textAlign',
                    value: 'center',
                  },
                ],
              },
              {
                $type: 'com.sunnahsky.richtext.facets.blocks',
                index: { byteStart: 15, byteEnd: 38 },
                features: [
                  {
                    $type: 'com.sunnahsky.richtext.facets.blocks#typography',
                    value: 'arabicParagraph',
                  },
                ],
              },
            ],
          },
        },
      },
    })
    expect(res.data.validationStatus).toBe('valid')

    const got = await strikerAgent.com.atproto.repo.getRecord({
      repo: strikerAgent.assertDid,
      collection: 'site.standard.document',
      rkey: new AtUri(res.data.uri).rkey,
    })
    const value = got.data.value as {
      content?: { text?: { markdown?: unknown; facets?: unknown[] } }
    }
    expect(value.content?.text?.markdown).toBe(markdown)
    expect(value.content?.text?.facets).toHaveLength(2)
    expect(value.content?.text?.facets?.[0]).toMatchObject({
      $type: 'com.sunnahsky.richtext.facets.blocks',
      index: { byteStart: 0, byteEnd: 14 },
      features: [
        {
          $type: 'com.sunnahsky.richtext.facets.blocks#textAlign',
          value: 'center',
        },
      ],
    })
    expect(value.content?.text?.facets?.[1]).toMatchObject({
      $type: 'com.sunnahsky.richtext.facets.blocks',
      index: { byteStart: 15, byteEnd: 38 },
      features: [
        {
          $type: 'com.sunnahsky.richtext.facets.blocks#typography',
          value: 'arabicParagraph',
        },
      ],
    })
  })
})
