import type { AtpAgent } from '@atproto/api'
import { TID, cidForCbor } from '@atproto/common'
import { TestNetworkNoAppView } from '@atproto/dev-env'
import { AtUri } from '@atproto/syntax'

describe('articles', () => {
  let network: TestNetworkNoAppView
  let strikerAgent: AtpAgent
  let catcherAgent: AtpAgent

  beforeAll(async () => {
    network = await TestNetworkNoAppView.create({
      dbPostgresSchema: 'articles',
    })
    strikerAgent = network.pds.getAgent()
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

    await catcherAgent.createAccount({
      email: 'catcher@test.com',
      handle: 'catcher.guest.test',
      password: 'catcher-pass',
    })
  })

  afterAll(async () => {
    await network?.close()
  })

  it('a striker can create a publication', async () => {
    const res = await strikerAgent.com.atproto.repo.createRecord({
      repo: strikerAgent.assertDid,
      collection: 'site.standard.publication',
      record: {
        $type: 'site.standard.publication',
        url: 'https://striker.test',
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
      url: 'https://striker.test',
      name: "Striker's Publication",
    })
  })

  it('a striker can create a document', async () => {
    const res = await strikerAgent.com.atproto.repo.createRecord({
      repo: strikerAgent.assertDid,
      collection: 'site.standard.document',
      record: {
        $type: 'site.standard.document',
        site: 'https://striker.test',
        title: 'My First Article',
        publishedAt: new Date().toISOString(),
      },
    })
    expect(res.data.uri).toBeDefined()

    const got = await strikerAgent.com.atproto.repo.getRecord({
      repo: strikerAgent.assertDid,
      collection: 'site.standard.document',
      rkey: new AtUri(res.data.uri).rkey,
    })
    expect(got.data.value).toMatchObject({
      site: 'https://striker.test',
      title: 'My First Article',
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
      site: 'https://striker.test',
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
          title: 'Missing required site and publishedAt fields',
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
        site: 'https://striker.test',
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
        site: 'https://striker.test',
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
})
