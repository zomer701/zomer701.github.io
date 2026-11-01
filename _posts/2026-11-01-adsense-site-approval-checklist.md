---
title: "Getting a site approved for AdSense: the checklist behind every rejection"
excerpt: "Google's own six-part series on AdSense site approvals, turned into one checklist. Ownership, crawler access, traffic, content, navigation, and the seven reasons a site gets rejected. With the exact robots.txt and ads.txt lines to check."
toc: true
toc_sticky: true
tags: [adsense, seo, robots-txt, ads-txt, search-console]
---

You add your site to AdSense, wait two weeks, and get a message: the site was reviewed and not approved. The message names a reason, but the reason is one line, and the fix is not obvious.

Google has a short video series on exactly this: [AdSense Site Approvals](https://www.youtube.com/playlist?list=PLbAFD4oU9Ycr4j1pViNjkS82rhbF293H8), six parts, 30 minutes in total. This post is that series as a checklist. Go through it before you submit, and again after a rejection.

## How the review works

A site is checked by automated tools and by human reviewers. In AdSense, open **Sites** in the left menu to see where your site is:

| Status | Meaning |
|---|---|
| **Needs attention** | Something is wrong. Fix it and resubmit. |
| **Getting ready** | Checks are still running. |
| **Ready** | Ads can show, as long as you keep following the policies. |

A review takes from a few days up to two weeks.

**Do not remove and re-add the site while it is in review.** That restarts the queue and makes the wait longer.

The review looks at five things: ownership, traffic, content, navigation, and, if you were rejected, the specific reason. The sections below follow that order.

## 1. Prove you own the site

AdSense needs to know the site is yours. Pick one of three ways:

1. **AdSense HTML code.** Paste the snippet AdSense gives you into the `<head>` of your pages.
2. **Google Search Console.** If the site is already verified there with the same Google account, that counts.
3. **ads.txt.** A plain text file at the root of your domain, for example `https://example.com/ads.txt`.

An ads.txt line for AdSense looks like this. Copy the exact line from your AdSense account, with your own publisher ID:

```text
google.com, pub-0000000000000000, DIRECT, f08c47fec0942fa0
```

On a Jekyll or GitHub Pages site, put `ads.txt` in the repo root. It is copied to the site root as is.

## 2. Let the crawler in

Reviewers and the AdSense crawler must be able to open your pages. During the review:

- **No password.** If some pages need a login, remove it for now. After approval you can set up a crawler login in AdSense for protected pages.
- **No geo blocking.** Do not block countries or regions.
- **No IP restrictions.** Do not limit access to an IP range.

Then check `robots.txt`. The AdSense crawler is called `Mediapartners-Google`. If you see this, it is blocked from the whole site:

```text
User-agent: Mediapartners-Google
Disallow: /
```

Remove those lines. A safe default that lets every crawler in looks like this:

```text
User-agent: *
Allow: /

Sitemap: https://example.com/sitemap.xml
```

The crawler reads your pages to decide which ads are relevant. If it cannot read them, it cannot place ads, and the site is rejected.

## 3. Finish the site first

A site that says "coming soon", "under construction" or "work in progress" is rejected. There is nothing to match ads to.

This applies after approval too: only put ads on pages that have real content.

## 4. Only real traffic

Good traffic is people who come to read your site and click an ad because they care about it.

Everything else is invalid traffic, and it gets a site rejected:

- auto-refreshing ads or pages
- hidden ads
- bots, and crawlers that pretend to be users
- clickjacking
- adware and malware
- cookie stuffing
- browser pre-rendering

Do not buy visitors or fake them. The way to get real traffic is boring: submit all your pages to Google so they are indexed, write for what people actually search, and make the site easy to move around in.

## 5. Write content worth reading

This is where most sites fail. The rules:

- **Original.** Your own experience, opinion, review or explanation. Not a copy.
- **Enough of it.** A reviewer must be able to tell what the site is about. A few good pages beat many weak ones.
- **Fresh.** Add new posts and update old ones.
- **No duplicates.** Do not repeat long blocks of text, publish several versions of one article, or build pages mostly out of links to other sites.
- **No scraped content.** Copying from other sites is a hard no.
- **Nothing dangerous or illegal.** See the [Google Publisher Policies](https://support.google.com/adsense/answer/10015918).
- **Moderate comments.** You are responsible for what other people post on your site.

## 6. Make navigation work

One of the hosts in the series was rejected for navigation alone. Reviewers check four things:

1. **Alignment.** Menus and links line up on phones, tablets and desktops, in every major browser.
2. **Readability.** The text is easy to read. Size, contrast, spacing.
3. **Functionality.** Drop-down menus open. Icons do what they say.
4. **Accuracy.** A link goes where its label promises. No broken, empty or misleading links.

Also: a clear menu that is easy to find, content grouped in a logical way, and a way back to the home page from every page.

A quick test: open the site on your phone, in a browser you do not normally use, and try to reach three random posts and get back home. Click every menu item.

## If you are rejected: the seven reasons

AdSense sends a message that says the site was reviewed and names the reasons. These are the common ones:

| # | Reason | Fix |
|---|---|---|
| 1 | **Ownership not confirmed** | Add the HTML code, verify in Search Console, or add ads.txt (section 1). |
| 2 | **Invalid traffic** | Remove anything that fakes visits or clicks (section 4). |
| 3 | **Low quality or unfinished content** | Remove placeholder pages, follow the content policies (sections 3 and 5). |
| 4 | **Copied content or navigation problems** | Make every page add value. Fix broken links, typos and menus (sections 5 and 6). |
| 5 | **Account problem** | One AdSense account per publisher. A second account, or a past account disabled for policy violations, leads to rejection. |
| 6 | **"Your site isn't ready to show ads"** | The crawler cannot find the ad code, or the code is incomplete. Paste the full snippet again. |
| 7 | **Templated pages or too many ads** | Pages built from a template with little unique text, pages that only frame other sites, or more ads than content. |

Then:

1. Fix every reason listed in the message, not just the first one.
2. Click through the whole site once more for broken links and typos.
3. Resubmit the site from the **Sites** page in AdSense.

## Before you click submit

- Ownership verified: HTML code, Search Console, or ads.txt
- No password, geo or IP blocks
- `robots.txt` does not block `Mediapartners-Google`
- No "coming soon" or empty pages
- Enough original posts that a stranger can tell what the site is about
- No copied, duplicated or scraped text
- Comments moderated, or turned off
- Menu works on a phone and in a second browser
- Every link goes where it says
- Only one AdSense account
- No paid or fake traffic

Then submit, and leave it alone for two weeks.

## Links

- [Google AdSense Site Approvals series](https://www.youtube.com/playlist?list=PLbAFD4oU9Ycr4j1pViNjkS82rhbF293H8) on YouTube
- [AdSense eligibility requirements](https://support.google.com/adsense/answer/9724)
- [AdSense Program policies](https://support.google.com/adsense/answer/48182)
- [Google Publisher Policies](https://support.google.com/adsense/answer/10015918)
- [Invalid traffic](https://support.google.com/adsense/answer/16737)
- [Google ad traffic quality](https://www.google.com/ads/adtrafficquality/)
