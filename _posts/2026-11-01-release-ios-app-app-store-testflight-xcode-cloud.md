---
title: "Releasing an iOS app: certificates, TestFlight, App Store review and Xcode Cloud, step by step"
excerpt: "Every click from a fresh Xcode project to a build on TestFlight and a version in App Review. First by hand, so you understand certificates and provisioning profiles. Then automated with Xcode Cloud, so you never do it by hand again."
toc: true
toc_sticky: true
tags: [ios, xcode, app-store, testflight, xcode-cloud, ci-cd]
---

Shipping an iOS app is not hard. It is just long, and every step has a name that sounds like another step. Certificates, identifiers, profiles, builds, versions, submissions. Miss one and Xcode shows a red error that tells you nothing.

This is the full path, with a screenshot for each screen you will see. It follows the free [freeCodeCamp course by Shad Mazumder](https://www.youtube.com/watch?v=9vkkJ4tC4SQ) (1h 25m). The screenshots below are from that course. I wrote the text as the checklist I wish I had the first time.

The post has two halves:

1. **Manual release.** Register the app, make certificates and profiles, archive in Xcode, upload, fill in App Store Connect, submit.
2. **Automated release.** Put the project on GitHub and let **Xcode Cloud** build, test and push to TestFlight on every merge.

Do the manual half at least once. The automated half only makes sense when you know what it hides.

## Before you start

You need:

- A **Mac with Xcode** installed (the course uses Xcode 16.2).
- An **Apple Developer Program** membership. The free account can run apps on your own device, but cannot upload to App Store Connect.
- A **GitHub account** for the second half.
- A **physical iPhone or iPad** if you want to test on a device. The simulator does not need any of the signing setup below.

Three web consoles appear throughout. Keep them in separate tabs:

| Console | URL | What lives there |
| --- | --- | --- |
| Apple Developer portal | developer.apple.com/account | App IDs, devices, certificates, provisioning profiles |
| App Store Connect | appstoreconnect.apple.com | The app record, builds, TestFlight, App Review, pricing |
| TestFlight | testflight.apple.com | Tester-facing install links |

## The model in one paragraph

Apple will only install an app on a device if the binary is **signed** with a certificate Apple issued to you, and if it carries a **provisioning profile** that ties together three things: the **App ID** (your bundle identifier), the **certificate** used to sign, and, for development and ad hoc builds, the list of **devices** allowed to run it. App Store builds have no device list because the App Store itself is the gate.

So the manual order is always the same: App ID, then devices, then certificates, then profiles, then build. Everything below follows that order.

## Part 1: Manual release

### 1. Create the project and pick a bundle identifier

Start a new iOS App project in Xcode. The **Organization Identifier** plus the **Product Name** become the **Bundle Identifier**. In the course that is `com.mobidevtalk` + `SampleDemoApp` = `com.mobidevtalk.SampleDemoApp`.

{% include figure image_path="/assets/images/ios-release/01-xcode-new-project.jpg" alt="Xcode new project dialog with Product Name and Organization Identifier" caption="The bundle identifier is generated from organization identifier and product name. You will type it into Apple's portals many times, so pick it once and never change it." %}

Leave **Team** as None for now. We will sign manually so you can see each piece.

### 2. Register the App ID

Open the Developer portal, go to **Certificates, Identifiers & Profiles**, then **Identifiers**, and click the blue **+**.

{% include figure image_path="/assets/images/ios-release/02-identifiers-list.jpg" alt="Identifiers list in the Apple Developer portal" caption="Identifiers is where App IDs live. The plus button starts registration." %}

Pick **App** as the type and continue.

{% include figure image_path="/assets/images/ios-release/03-register-identifier-app.jpg" alt="Register a new identifier, App selected" caption="App, not App Clip." %}

Fill in a description, choose **Explicit** and paste the exact bundle identifier from Xcode. Explicit means this App ID matches one bundle, which is what you want for an App Store app. Wildcard IDs cannot use push notifications or in-app purchase. Click Continue, check the summary, click **Register**.

{% include figure image_path="/assets/images/ios-release/04-confirm-app-id.jpg" alt="Confirm your App ID page" caption="The confirmation page. Bundle ID must match Xcode character for character." %}

### 3. Create the app record in App Store Connect

Open App Store Connect, go to **Apps**, click **+**, then **New App**.

{% include figure image_path="/assets/images/ios-release/05-asc-new-app.jpg" alt="New App dialog in App Store Connect" caption="Platform iOS, a public name, primary language, the bundle ID you just registered, and a SKU." %}

Fields:

- **Name** is the public App Store name. It must be unique across the store.
- **Bundle ID** is a dropdown of App IDs you registered in step 2. If yours is missing, go back to the Developer portal.
- **SKU** is a private identifier for your own records. Using the bundle identifier again is fine.

Click **Create**. You land on the app overview with three tabs: Distribution, TestFlight and Xcode Cloud. All three come back later.

{% include figure image_path="/assets/images/ios-release/06-asc-app-created.jpg" alt="App Store Connect app page after creation" caption="The app record exists, version 1.0 is in 'Prepare for Submission'. Nothing is uploaded yet." %}

### 4. Register your test devices

Development and ad hoc builds only run on devices listed in the profile. In the Developer portal go to **Devices**, click **+**, and fill in a name and the **UDID**.

{% include figure image_path="/assets/images/ios-release/07-register-device.jpg" alt="Register a New Device form" caption="One form per device. There is also a CSV upload for up to 100 devices." %}

To find a UDID: plug the device into the Mac, open Finder, select the device, and click the line under its name until the identifier appears. Or in Xcode, Window, Devices and Simulators.

Two rules to know:

- Each membership year allows **100 devices per type** (100 iPhones, 100 iPads, and so on). Deleting a device does not free the slot until the membership renews.
- Name devices with the owner and team in the name, like `Team Alpha Rayhan's iPhone`. In a year you will not remember whose iPad `iPad (3)` was.

Also enable **Developer Mode** on the device under Settings, Privacy & Security, Developer Mode. The device restarts. Without this, Xcode refuses to install.

### 5. Create a Certificate Signing Request on your Mac

A certificate is Apple vouching for a key pair on your Mac. The private key never leaves your machine. You send Apple a **Certificate Signing Request** (CSR), Apple sends back a certificate, and Keychain pairs them.

Open **Keychain Access**. In the menu bar choose Keychain Access, Certificate Assistant, **Request a Certificate From a Certificate Authority**.

{% include figure image_path="/assets/images/ios-release/08-keychain-request-certificate.jpg" alt="Keychain Access menu, Certificate Assistant, Request a Certificate From a Certificate Authority" caption="This menu item generates the key pair and the CSR file." %}

Enter your email, a **Common Name** you will recognise later (the course uses `Rayhan CSR 2025`), choose **Saved to disk**, and continue. Save the `.certSigningRequest` file somewhere you can find it. You will upload it twice.

{% include figure image_path="/assets/images/ios-release/09-certificate-assistant.jpg" alt="Certificate Assistant form with Saved to disk selected" caption="Leave CA Email empty. 'Saved to disk' is the only option that works with the Developer portal." %}

### 6. Create the development certificate

Back in the Developer portal, go to **Certificates**, click **+**. Pick **Apple Development** and continue.

{% include figure image_path="/assets/images/ios-release/10-create-certificate-development.jpg" alt="Create a New Certificate with Apple Development selected" caption="'Apple Development' covers iOS, macOS, tvOS, watchOS and visionOS. The older 'iOS App Development' is iOS only." %}

Upload the CSR file and click Continue.

{% include figure image_path="/assets/images/ios-release/11-upload-csr.jpg" alt="Upload a Certificate Signing Request page with the CSR selected" caption="One CSR, one certificate. Apple generates it instantly." %}

Download the `.cer` file.

{% include figure image_path="/assets/images/ios-release/12-download-certificate.jpg" alt="Download your certificate page" caption="Note the expiry: development certificates last one year." %}

Double-click the downloaded file. Keychain Access imports it into the **login** keychain.

### 7. Fix "this certificate is not trusted"

On a fresh Mac, the imported certificate shows a red cross and the text **certificate is not trusted**.

{% include figure image_path="/assets/images/ios-release/13-certificate-not-trusted.jpg" alt="Keychain Access showing the Apple Development certificate as not trusted" caption="This is not a broken certificate. The Mac is missing the Apple intermediate certificate that signed it." %}

The fix is the **Apple Worldwide Developer Relations** intermediate certificate. Xcode normally installs it, but it is easy to end up without it. Open the **Create a New Certificate** page again and scroll to the bottom, to **Intermediate Certificates**.

{% include figure image_path="/assets/images/ios-release/14-intermediate-certificates.jpg" alt="Intermediate Certificates section at the bottom of the certificate creation page" caption="Download the Worldwide Developer Relations Certificate Authority that expires in 2030 (the G3 certificate)." %}

Download it, double-click it, and look at the development certificate again.

{% include figure image_path="/assets/images/ios-release/15-certificate-valid.jpg" alt="Keychain Access showing the certificate is valid with a green checkmark" caption="Green check: the chain from your certificate to Apple's root is complete." %}

A certificate you cannot see in Keychain with a green check will not sign anything. If Xcode later says "no signing certificate found", this is the first place to look.

### 8. Create the distribution certificate

Repeat step 6, but choose **Apple Distribution**. Reuse the same CSR file.

{% include figure image_path="/assets/images/ios-release/16-create-certificate-distribution.jpg" alt="Create a New Certificate with Apple Distribution selected" caption="Distribution certificates sign builds for TestFlight, the App Store and ad hoc installs." %}

Download it and double-click to install. You now have two certificates in Keychain.

Why two? Every developer on a team gets their own **development** certificate, because it is tied to their Mac. The **distribution** certificate is a team asset. Only the account holder or an admin should create it, and only the machine that ships builds should hold it.

### 9. Create a development provisioning profile

In the Developer portal go to **Profiles**, click **+**. Under Development choose **iOS App Development**.

{% include figure image_path="/assets/images/ios-release/17-new-provisioning-profile.jpg" alt="Register a New Provisioning Profile with iOS App Development selected" caption="Development profiles for running on devices from Xcode. Ad Hoc and App Store are under Distribution." %}

The wizard asks for the three parts of the profile in order.

Select the App ID.

{% include figure image_path="/assets/images/ios-release/18-profile-select-app-id.jpg" alt="Select an App ID dropdown" caption="Pick the App ID from step 2." %}

Select the development certificate.

{% include figure image_path="/assets/images/ios-release/19-profile-select-certificate.jpg" alt="Select Certificates page" caption="For a team profile, select every developer's certificate so one profile works on every Mac." %}

Select the devices.

{% include figure image_path="/assets/images/ios-release/20-profile-select-devices.jpg" alt="Select Devices page" caption="Only the devices registered in step 4 appear. Toggle 'Include Mac Devices' to run the iOS app on Apple silicon Macs." %}

Name the profile and click **Generate**.

{% include figure image_path="/assets/images/ios-release/21-profile-name-generate.jpg" alt="Review, Name and Generate page" caption="Put the app and the kind in the name, like 'SampleDemoApp Dev profile'. The Profiles list gets long." %}

Download the `.mobileprovision` file and double-click it. Xcode registers it.

### 10. Point Xcode at the profile

In Xcode select the target, open **Signing & Capabilities**, uncheck **Automatically manage signing**, and pick the profile from the **Provisioning Profile** dropdown.

{% include figure image_path="/assets/images/ios-release/22-xcode-signing-capabilities.jpg" alt="Xcode Signing and Capabilities with manual provisioning profile selected" caption="With manual signing, Xcode shows the matched certificate under the profile. A red error here means the certificate in the profile is not in your Keychain." %}

Select your device (or My Mac) as the run destination and press Run. The app installs and launches. If you want to add a device later, edit the profile in the portal, tick the device, save, download again and re-import.

### 11. Create the ad hoc profile

Ad hoc builds let testers install the app over the air without TestFlight, as long as their device is in the profile. Repeat step 9 but choose **Ad Hoc** under Distribution, choose the **distribution** certificate instead of the development one, and select devices.

{% include figure image_path="/assets/images/ios-release/23-adhoc-profile.jpg" alt="Review, Name and Generate page for an Ad Hoc profile" caption="Type: Ad Hoc. Two devices selected. Download and double-click like before." %}

If you only ship through TestFlight and the App Store, you can skip this. Xcode creates the App Store profile for you when you upload.

### 12. Archive and upload the build

Three checks before the first archive:

- The project has an **AppIcon** in `Assets.xcassets`. Uploads without an icon are rejected.
- The run destination is **Any iOS Device (arm64)**, not a simulator. You cannot archive for a simulator.
- Both certificates show as valid in Keychain.

{% include figure image_path="/assets/images/ios-release/24-app-icon.jpg" alt="Assets catalog with AppIcon filled in" caption="A single 1024x1024 image is enough since Xcode 14. Light, dark and tinted variants are optional." %}

{% include figure image_path="/assets/images/ios-release/25-any-ios-device.jpg" alt="Run destination menu with Any iOS Device (arm64) highlighted" caption="Any iOS Device (arm64) is under Build, not under Simulators." %}

Choose **Product, Archive**. Xcode builds a release binary. The first time, macOS asks for your login keychain password so `codesign` can use the private key. Click **Always Allow**, or you will be asked for every file.

{% include figure image_path="/assets/images/ios-release/26-codesign-keychain-prompt.jpg" alt="codesign wants to sign using key prompt" caption="The key named here is the one from your CSR. Entering the password links it to the certificate for signing." %}

When the archive finishes, the **Organizer** opens. Select the archive, click **Distribute App**, choose **App Store Connect**, and click **Distribute**.

{% include figure image_path="/assets/images/ios-release/27-distribute-app.jpg" alt="Organizer distribution method sheet with App Store Connect selected" caption="App Store Connect covers both TestFlight and App Store. The other options are for ad hoc, enterprise and debugging builds." %}

Xcode validates the archive, signs it with the distribution certificate, and uploads it. Open App Store Connect, pick the app, and open the **TestFlight** tab.

{% include figure image_path="/assets/images/ios-release/28-testflight-processing.jpg" alt="TestFlight tab showing build 1 as Processing" caption="'Processing' usually takes a few minutes. You get an email when the build is ready." %}

### 13. Fill in the version page

Open the **Distribution** tab. Version 1.0 is in **Prepare for Submission**. This page is long. Work top to bottom.

- **Screenshots.** At least one set for the newest iPhone display size. Submission is blocked without it.
- **Description**, **Keywords** (comma separated), **Support URL**, **Copyright**.

{% include figure image_path="/assets/images/ios-release/29-version-metadata.jpg" alt="iOS App Version 1.0 page with keywords, support URL and copyright filled in" caption="Keywords are limited to 100 characters in total. Support URL must resolve." %}

Scroll to **Build**, click **Add Build**, and pick the build that finished processing.

{% include figure image_path="/assets/images/ios-release/30-add-build.jpg" alt="Build section with build 1 (1.0) attached" caption="The app icon shown here comes from the uploaded binary, not from App Store Connect." %}

Under **App Review Information**, enter a contact name, phone and email. Untick **Sign-in required** if the app has no login. If it does, provide a demo account here, because reviewers will try to log in.

Under **App Store Version Release**, choose **Manually release this version**. Then approval does not mean an immediate release. You decide when to press the button. Click **Save**.

{% include figure image_path="/assets/images/ios-release/31-app-review-info-release.jpg" alt="App Review Information and App Store Version Release sections" caption="Manual release gives you a window between approval and going live. Useful for coordinating with a backend deploy or an announcement." %}

### 14. App Information, age rating, privacy and price

These live in the left sidebar and are shared across all versions. The **Add for Review** button stays disabled until all of them are done.

**App Information.** Add a subtitle and pick a **Category**. Then click **Set Up Content Rights Information**.

{% include figure image_path="/assets/images/ios-release/32-app-information.jpg" alt="App Information page with Category set to Education" caption="Bundle ID and SKU are fixed here. Name and subtitle can change with each version." %}

{% include figure image_path="/assets/images/ios-release/33-content-rights.jpg" alt="Content Rights dialog" caption="Answer honestly. 'No third-party content' is right for most apps you built yourself." %}

**Age Rating.** Click Edit, answer the questionnaire (how often the app shows each kind of content), and click Done. Apple calculates the rating.

{% include figure image_path="/assets/images/ios-release/34-age-rating.jpg" alt="Age Rating dialog showing 4+" caption="A demo app with no user content gets 4+." %}

**App Privacy.** Enter a **Privacy Policy URL**. It is required for every app, even one that collects nothing. Then under **Data Types**, click Get Started and answer whether the app collects data. Click Save, then **Publish**. Only an Admin or the Account Holder can edit this section.

{% include figure image_path="/assets/images/ios-release/35-privacy-policy.jpg" alt="Privacy Policy dialog asking for the URL" caption="The page at this URL must exist before review." %}

{% include figure image_path="/assets/images/ios-release/36-app-privacy-published.jpg" alt="App Privacy page showing Data Not Collected" caption="'Data Not Collected' is what the App Store badge will show. If you use analytics or crash reporting, this is not your answer." %}

**Pricing and Availability.** Click **Add Pricing**, choose a base country and a price. $0.00 is free. Click Next and Confirm. Apple fills in equivalent prices for every other territory.

{% include figure image_path="/assets/images/ios-release/37-pricing.jpg" alt="App Pricing dialog with the price list open" caption="Price tiers are fixed. You pick a base price, Apple derives the rest." %}

### 15. Submit to App Review

Back on the version page, **Add for Review** is now enabled. Click it. On the iOS Submission page, click **Submit to App Review**.

{% include figure image_path="/assets/images/ios-release/38-submit-to-app-review.jpg" alt="iOS Submission page with Submit to App Review button" caption="After this, the status changes to Waiting for Review. Typical turnaround is one or two days." %}

That is the manual release. Everything from step 12 onward you repeat for each release. Everything before it you do once per app, plus once a year for certificates. The next half makes step 12 disappear.

## Part 2: Automate it with Xcode Cloud

Xcode Cloud is Apple's hosted CI. It checks out your repository, builds on Apple's Macs, runs your tests, and can archive and push to TestFlight. It handles signing itself, so none of the certificate work above happens on the build machine.

The setup is:

```text
 GitHub                         Xcode Cloud                     App Store Connect
 ───────                        ───────────                     ─────────────────
 PR → main    ──triggers──►  "Build & Test" workflow  ──►  check on the PR
 merge → release ──triggers──►  "Distribution" workflow ──►  archive ──► TestFlight group
```

Two workflows. One is cheap and runs on every pull request. The other archives and only runs when something reaches `release`.

### 16. Fill in TestFlight test information

Before Xcode Cloud can push to TestFlight, App Store Connect needs beta review contact details. Open the **TestFlight** tab, then **Test Information** under Additional.

{% include figure image_path="/assets/images/ios-release/39-testflight-test-information.jpg" alt="TestFlight Test Information page with contact information filled in" caption="A beta app description, a feedback email, and a contact for Apple's beta review." %}

Enter the phone number with a leading plus and the country code, like `+880 1711 111111`. Without the country code the save silently fails.

### 17. Check the Xcode target

In Xcode, open the target's **General** tab and confirm three things.

{% include figure image_path="/assets/images/ios-release/40-xcode-app-category-build.jpg" alt="Xcode General tab showing App Category, Bundle Identifier, Version and Build" caption="App Category set, bundle identifier matching the App ID, and a build number." %}

- **Bundle Identifier** matches the App ID in App Store Connect.
- **App Category** is set. Xcode Cloud refuses to upload a build without one.
- **Build** is a number you will increment. Every upload to App Store Connect needs a build number higher than the last one for that version. Xcode Cloud can set this automatically, which is covered below.

### 18. Create the GitHub repository and protect main

Create a repository on GitHub. Then open **Settings, Rules, Rulesets**, and add a branch ruleset for the default branch. Name it, set enforcement to **Active**, and target the default branch.

{% include figure image_path="/assets/images/ios-release/41-github-ruleset.jpg" alt="GitHub ruleset for the main branch" caption="Rules to turn on: require a pull request before merging, block force pushes. You can also require the Xcode Cloud check to pass once it exists." %}

Connect the local project:

```bash
cd SampleDemoApp
git remote add origin https://github.com/<you>/SampleDemoApp.git
git remote -v
```

If you created the repository with a `.gitignore` or license, pull first. In Xcode: **Integrate, Pull**, choose `origin/main`. Then push the project.

Work on a branch, not on main. The course uses `xcode-cloud-integration` for the setup commits.

### 19. Create the Build & Test workflow

In Xcode, open the **Report navigator** (the last icon in the navigator bar) and click the **Cloud** tab. Sign in with your Apple account if asked, then click **Get Started**.

{% include figure image_path="/assets/images/ios-release/42-xcode-cloud-get-started.jpg" alt="Xcode Cloud panel with Get Started button" caption="This panel lives in the Report navigator, which is easy to miss." %}

Select the iOS product and click Next.

{% include figure image_path="/assets/images/ios-release/43-select-product.jpg" alt="Select a Product sheet showing the iOS and macOS products" caption="One workflow per product. The Team column shows which team's App Store Connect record it maps to." %}

Xcode proposes a default workflow. Click **Edit Workflow** and change it.

On **General**, name it `Build & Test` and describe it.

{% include figure image_path="/assets/images/ios-release/44-workflow-general.jpg" alt="Workflow General tab with name Build & Test" caption="The name shows up as the check name on GitHub pull requests." %}

Under **Start Conditions**, remove the default Branch Changes condition and add **Pull Request Changes**. Set the target branch to `main` and enable **Auto-cancel Builds**.

{% include figure image_path="/assets/images/ios-release/45-pull-request-changes.jpg" alt="Pull Request Changes start condition targeting main" caption="Auto-cancel means a new push to the same PR cancels the running build instead of queueing a second one. It saves compute hours." %}

Under **Actions**, remove the default **Archive** action. Add **Build** (platform iOS, Any iOS Device) and **Test** (platform iOS). Order: Build, then Test.

{% include figure image_path="/assets/images/ios-release/46-test-action.jpg" alt="Test action configuration with Required to Pass selected" caption="'Required to Pass' makes a failing test fail the whole workflow, which is what you want on a PR check." %}

Click **Save**, review the summary, click **Next**.

{% include figure image_path="/assets/images/ios-release/47-review-workflow.jpg" alt="Review Workflow summary showing pull request start condition and build and test actions" caption="Start condition, environment, actions. No post-actions, so nothing is uploaded." %}

### 20. Grant Xcode Cloud access to the repository

Xcode now asks for source access. Click **Grant Access**. A browser opens on App Store Connect, which redirects to GitHub to install the Xcode Cloud app on the repository. Approve it, come back to Xcode, and the repository shows a green tick.

{% include figure image_path="/assets/images/ios-release/48-grant-access.jpg" alt="Grant Access to Your Source Code sheet showing the GitHub repository" caption="Access is per repository. You can revoke it from GitHub under Settings, Applications." %}

Click Next, confirm the App Store Connect app the workflow belongs to, click **Complete**. On the **Start Build** sheet, click **Close**. The workflow should run on pull requests, not now.

{% include figure image_path="/assets/images/ios-release/49-start-build.jpg" alt="Start Build sheet after configuration" caption="The workflow is live. It is also editable from App Store Connect under the Xcode Cloud tab, which is often more convenient than Xcode." %}

### 21. Trigger it with a pull request

The Test action needs a test target. Add one with **File, New, Target, Unit Testing Bundle**. If the test target's **iOS Deployment Target** is newer than the simulator Xcode Cloud will use, lower it to match the app target. Write one test, run it locally with Product, Test.

Commit, push the branch, open a pull request to `main`. Within a minute, a **Build & Test** check appears on the PR. When it passes, merge.

{% include figure image_path="/assets/images/ios-release/50-pr-checks-merged.jpg" alt="GitHub pull request merged with checks passed" caption="'3 checks passed': Xcode Cloud reports build and test results as separate checks." %}

If the check does not appear, the usual cause is that the repository access was granted to the wrong GitHub account or organisation.

### 22. Create a release branch and the Distribution workflow

Create a `release` branch from `main` on GitHub and give it its own ruleset: require a pull request, require conversation resolution, block force pushes.

{% include figure image_path="/assets/images/ios-release/51-release-branch-ruleset.jpg" alt="GitHub ruleset for the release branch" caption="Nothing lands on release except through a reviewed PR from main. That PR is your release gate." %}

Now the second workflow. In App Store Connect open the app, the **Xcode Cloud** tab, **Manage Workflows**, and add a workflow named `Distribution`.

- **Environment**: Xcode Version and macOS Version. The course picks **Latest Beta or Release**. For a production app, pin a specific Xcode version so a new Xcode release cannot break your build overnight.
- **Start Conditions**: **Branch Changes**, branches beginning with `release`, Auto-cancel on.

{% include figure image_path="/assets/images/ios-release/52-distribution-start-conditions.jpg" alt="Distribution workflow start conditions for branches beginning with release" caption="The red error on Actions is expected until you add one." %}

- **Actions**: **Archive**, with **Distribution Preparation** set to **App Store Connect**.

{% include figure image_path="/assets/images/ios-release/53-archive-action.jpg" alt="Archive action with App Store Connect distribution preparation" caption="The course archives the macOS version here so the author can install it on the Mac. For an iPhone app, set Platform to iOS." %}

Save. Xcode Cloud uploads the archive to App Store Connect when the workflow finishes. Any internal TestFlight group with automatic distribution on (next step) receives it without further clicks. Build numbers are also handled: Xcode Cloud sets the build number to its own build counter by default, so you no longer edit it in Xcode.

### 23. Set up TestFlight groups

Open the **TestFlight** tab. There are two kinds of testers.

**Internal testers** are people with a role in your App Store Connect team. Builds reach them with no review. Click **+** next to Internal Testing, name the group (the course uses `Core team`), and keep **Enable automatic distribution** on so every new build goes to them.

{% include figure image_path="/assets/images/ios-release/54-internal-group.jpg" alt="Create New Internal Group dialog" caption="Up to 100 internal testers. They must be added as users in App Store Connect first." %}

**External testers** are anyone else, up to 10,000. Their first build goes through **Beta App Review**. Click **+** next to External Testing, name the group (`Alpha Testers`), then choose how to invite. **Public Link** gives you a URL anyone can open. Set a tester limit.

{% include figure image_path="/assets/images/ios-release/55-public-link.jpg" alt="Public Link dialog with tester limit" caption="A public link with a limit of 1 is the course's demo. For a real beta, use a limit that matches your support capacity." %}

### 24. Ship a change through the pipeline

Make a visible change, commit, push a branch, open a PR to `main`. Build & Test runs, you merge. Then open a PR from `main` to `release` and merge it. The Distribution workflow starts.

{% include figure image_path="/assets/images/ios-release/56-xcode-cloud-build-done.jpg" alt="Xcode Cloud builds list with the release Distribution build succeeded" caption="Build 2 on the release branch, green. The number was set by Xcode Cloud." %}

In the TestFlight tab, the new build has a yellow warning: **Missing Compliance**. Click it and answer the **App Encryption Documentation** question. For an app that only uses HTTPS, the answer is **None of the algorithms mentioned above**.

{% include figure image_path="/assets/images/ios-release/57-encryption-documentation.jpg" alt="App Encryption Documentation dialog" caption="To stop seeing this for every build, add ITSAppUsesNonExemptEncryption = NO to Info.plist." %}

Open the external group, add the build, write a note about what to test, and click **Submit for Review**.

{% include figure image_path="/assets/images/ios-release/58-submit-beta-review.jpg" alt="What to Test dialog with Submit for Review button" caption="Beta App Review is lighter than App Review. The first one can take around ten hours, later ones are faster." %}

When Apple approves it, the public link goes live.

{% include figure image_path="/assets/images/ios-release/59-public-link-ready.jpg" alt="Alpha Testers group with the public TestFlight link" caption="The join link, the tester limit and the criteria. Send it to your testers." %}

### 25. Install it as a tester

Open the link on a device with TestFlight installed. The landing page offers **View in TestFlight**. TestFlight shows the build with an **Install** button, then **Open**.

{% include figure image_path="/assets/images/ios-release/60-testflight-install.jpg" alt="TestFlight showing the beta app with an Install button" caption="Builds expire after 90 days. Testers see the countdown and the What to Test note." %}

From here, every merge to `release` ends up here without anybody touching Xcode.

## Mistakes that cost the most time

- **"Certificate is not trusted"** in Keychain. Install the WWDR intermediate certificate (step 7).
- **Xcode shows no matching certificate for the profile.** The certificate is in the profile but not in this Mac's Keychain. Export it from the Mac that created it as a `.p12`, including the private key, or make a new certificate and regenerate the profile.
- **Upload rejected for missing icon or category.** Add an AppIcon and set App Category before archiving.
- **"Build number already used."** Each upload needs a higher build number. Let Xcode Cloud manage it.
- **Beta review contact fails to save.** Phone number needs the leading plus and country code.
- **Add for Review stays disabled.** One of App Information, Age Rating, App Privacy or Pricing is incomplete. The red dots in the sidebar point at it.
- **Xcode Cloud free tier.** 25 compute hours a month are included with the Developer Program. A Build & Test on every push of a large project burns through that fast. Auto-cancel helps. So does keeping test-heavy modules in Swift packages that only rebuild when they change.

## What to do once a year

- Development certificates expire after a year. Make a new CSR, a new certificate, and regenerate every development profile that used the old one.
- Distribution certificates last longer, but when one expires, existing App Store builds keep working. Only new uploads need the new certificate.
- Review the device list before renewal. That is the only time Apple lets you free slots.

Source course: [iOS App Store Submission Tutorial](https://www.youtube.com/watch?v=9vkkJ4tC4SQ) by Shad Mazumder on freeCodeCamp.org. All screenshots are from the course.
