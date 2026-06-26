# Launch & Promotion Plan — Portal Tracker

A prioritized, sourced playbook for sharing the free, MIT, browser-native
Skylanders tracker. **Bottom line:** your strongest single asset is the
**WebHID hardware-reverse-engineering story** (perfect for Hacker News + the dev
crowd); **darkSpyro + the Skylander's Helpdesk Discord** are your
highest-conversion niche-collector channels. The competitive gap is real — no
browser-native live-scan tracker shows up in search today.

> Caveat: Reddit, Discord listing sites and Facebook block automated fetching,
> so member/subscriber counts below are from third-party trackers and are
> directional, not freshly verified. Open each community's live Rules tab before
> posting.

---

## 1. Skylanders / toys-to-life collector communities (your direct users)

### darkSpyro forums — highest fit, lowest risk
- Confirmed active in 2026 (~2.5M posts, ~15.6k users, hundreds online). Historic
  home of Skylanders portal/figure tools; admin **dark52** personally helps with
  fan tools. No formal anti-self-promo wall.
- Post in the **"Skylanders Toys and Merchandise"** board. Make a few genuine
  posts first, then a clear thread: *"Browser-based live Portal reader — free &
  open source."* **Emphasize it only reads/edits figures you own and never
  clones to blank tags** — this crowd knows the cloning line Activision litigated.
- https://forum.darkspyro.net/spyro/

### Skylander's Helpdesk Discord — most technically relevant active audience
- Emulation / NFC-card / NFC-emulation tinkerers — they'll directly care about a
  WebHID reader. Member count uncertain (verify in-app).
- Join, read #rules, post in the designated #projects / #self-promo channel or
  ping a mod. **Never cold-drop a link or DM** — that's an instant-ban norm.
- Invite: https://discord.com/invite/skylander-s-helpdesk-1019884375501979648

### r/skylanders — biggest niche reach (~61k)
- Active; steady "what figure is this / how do I track my collection" stream.
- **Rule flag:** explicitly prohibits excessive self-promotion. **Modmail first**,
  describe it as free/open-source/non-commercial, post as a self-post with a demo
  GIF framed as a community resource.
- https://www.reddit.com/r/skylanders/

### GBAtemp.net — active hacking forum, scope-sensitive
- Deep NFC/dumping/emulation threads. **Rule flag:** no advertising topics without
  staff permission (name the approving mod); use the homebrew/projects release
  section. Much of GBAtemp is about dumping to blank cards (your out-of-scope
  case) — **lead with "does not write to blank tags"** so you're not misread.
- https://gbatemp.net/help/terms/

### Secondary
- **r/toystolife** (small), **Facebook collector groups** (casual buy/sell, links
  usually banned without admin OK — low priority). Allies/cross-links: the
  `skylandersNFC` GitHub org, `je3wan/Skylanders-NFC-guide`, and `Texthead1`
  (your ID-data seed source).

---

## 2. Broader launch channels

### Hacker News "Show HN" — your anchor
- "Things people can run or hold in their hands" — a click-to-try, no-signup,
  WebHID + reverse-engineering story is the quintessential HN post.
- Title starts `Show HN:` — e.g. *"Show HN: Reading Skylanders figures off a USB
  Portal of Power in the browser (WebHID)."* Post a founder comment within ~5 min
  (backstory, tech, honest limitations — your Windows write-blocker is perfect
  credibility-building). **Never ask for upvotes.** Best window: weekday 8–11am
  ET (Tue–Thu); content ≫ timing. Hardware shown via video is explicitly allowed.
- https://news.ycombinator.com/showhn.html

### Reddit dev/maker subs
| Sub | Size | Rule | How |
|---|---|---|---|
| **r/SideProject** | ~735k | promo-friendly | **Start here** — launch post + GIF |
| **r/coolgithubprojects** | ~50k | built for repo shares | repo link + TS flair |
| **r/opensource** | ~210k | limited promo | lead with MIT + call for contributors |
| **r/webdev** | ~2.6M | **Showoff Saturday only** | post Sat w/ flair, WebHID angle |
| **r/programming** | ~5.8M | technical only | the reverse-engineering writeup |
| **r/retrogaming / r/gamecollecting** | large | check rules tab | free fan-tool framing + disclaimer |

There is **no WebHID subreddit**; that discussion lives in r/webdev / r/javascript.

### Lobsters — strong on substance, invite-only
- Ask once in their chat (https://lobste.rs/chat); self-promo must be <25% of your
  activity; `show` tag gated for new accounts. Lead with the technical writeup.

### Product Hunt — optional/secondary
- Leaderboard resets 12:01am Pacific; can't ask for upvotes; needs ~30 days prep.
  Skews SaaS — treat as a later, optional push after validation.

### Dev content
- Cross-post the devlog to **DEV.to** (`#webdev #opensource #hardware`), host the
  canonical long-form on **Hashnode** (your domain, for SEO), amplify via
  **daily.dev**, and submit a **Hackaday tip** (they cover toys-to-life teardowns).

---

## 3. Content / SEO angle

- **The gap:** no browser-native portal reader appears in search. Two intents are
  served by separate clunky tools and you merge them: "track what I own" (manual
  checklists) + "read/edit on PC" (old desktop apps). The official **Skylanders
  Collection Vault was taken down by Activision**, leaving an authority vacuum on
  your exact phrase.
- **Keywords:** *skylanders collection tracker · skylanders portal reader online ·
  scan skylanders figures · read skylanders on pc (no download)*; long-tail
  near-zero-competition: *webhid skylanders · what skylander is on my portal ·
  identify skylander figure*.
- **The WebHID writeup is a strong traffic/link bet.** Your documented finding —
  the Chromium-on-Windows `sendReport`→`WriteFile`-only STALL forcing
  control-pipe SET_REPORT — is original research (all prior art is desktop/hidapi).
  Title idea: *"How I read a Portal of Power from a browser tab."* Share on HN,
  r/programming, Lobsters, Hackaday.
- **Custom domain recommended.** Don't rely on `*.vercel.app` (Google
  deprioritizes shared subdomains, duplicate-content risk). A real domain also
  boosts trust for a non-technical collector being asked to grant USB access. Set
  a canonical tag and register in Google Search Console. (Mind the "Skylanders"
  trademark — pick a neutral brandable name.)

---

## 4. Suggested launch sequence (first 1–2 weeks)

Principle: **narrow → validated → broad**, and **stagger, don't blast** (identical
copy across many subs same-day trips Reddit's spam filters).

**Pre-launch (1–2 weeks before):**
1. Spend 2–4 weeks genuinely participating in target communities so you clear
   account-age/karma floors (the 9:1 / ≤10%-self-promo rule is the test).
2. Publish the writeup 1–2 days early so it's indexed.
3. Soft-launch to **darkSpyro's Toys & Merchandise board** to validate + gather
   feedback. Lead with "reads/edits only figures you own, never clones."

**Launch day (Tue–Thu, ~9am ET):**
4. **Show HN** first; founder comment within 5 min; answer every comment as a human.
5. ~30 min later: **r/SideProject** (GIF + WebHID story).
6. Same day: **r/coolgithubprojects** + a Twitter/X build-in-public thread.

**Days 2–7:**
7. **Skylander's Helpdesk Discord** (designated channel, after #rules).
8. **r/opensource** (MIT + contributors).
9. **GBAtemp homebrew/release** (staff permission first; distinguish from cloning).
10. Cross-post to **DEV.to**; submit a **Hackaday tip**.

**Week 2:**
11. **r/webdev on Saturday** (Showoff flair).
12. **r/programming** (writeup, not promo).
13. **r/retrogaming / r/gamecollecting** (free-tool framing + "not affiliated").
14. **Lobsters** / **Product Hunt** as later optional pushes.

Throughout: treat it as a multi-week campaign. Use F5Bot/Google Alerts to find
existing threads where the tool genuinely helps, and reply in-context. PR yourself
into "Awesome Skylanders/WebHID" lists — contributor, not marketer.

---

## Rules that get posts removed (flagged)
- **Reddit 9:1 / 10% rule**; new-account + immediate promo is the #1 ban trigger;
  no URL shorteners; **never ask for upvotes**; many subs enforce age/karma floors.
- **r/webdev:** self-promo only in Showoff Saturday.
- **r/skylanders:** anti-self-promo — modmail first.
- **GBAtemp:** no ad topics without staff permission (name the mod).
- **Discord:** unsolicited links/DMs = common instant bans; participate first.
- **Lobsters:** <25% self-promo; `show` tag gated for new accounts.
- **HN:** `Show HN:` needs a working try-it-now thing; no booster/AI comments.

**Cross-cutting:** in every Skylanders community, the "**read + edit what you own,
never clone to blank tags**" framing + a "not affiliated with Activision"
disclaimer is what keeps mods from lumping you in with NFC-dumping tools.

*Re-verify before launch: exact Discord counts, live subreddit rules tabs, and
current HN/Product Hunt guideline wording.*
