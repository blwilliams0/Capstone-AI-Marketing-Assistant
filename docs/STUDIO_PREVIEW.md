# Preview The Pocket Marketing Studio

## In Codex Cloud

Open **New tab (+) → Desktop** in the right panel if your Codex client offers it. Inside the Cloud desktop, switch to Chrome and open `http://127.0.0.1:5173`. If the Studio tab is already open, use it directly. Select **Take over** if that control appears. The address refers to the Cloud computer. The launcher must be running in that same environment.

The preview is a private practice workspace. It uses a dedicated local PostgreSQL cluster, four practice roles, local photo files and simulated AI replies.

## On a Mac

1. Install [Homebrew](https://brew.sh/) if needed. Follow its terminal instructions for adding Homebrew to your PATH.
2. Open Terminal and install the prerequisites.

   ```bash
   brew install node@24 postgresql@17
   export PATH="$(brew --prefix node@24)/bin:$PATH"
   node --version
   ```

3. Clone the team repository after the feature branch is available on GitHub. Use your normal GitHub access if prompted. For an existing clone, run `git fetch origin` and `git switch feat/marketing-studio` from that folder.

   ```bash
   git clone https://github.com/blwilliams0/Capstone-AI-Marketing-Assistant.git
   cd Capstone-AI-Marketing-Assistant
   git switch feat/marketing-studio
   npm ci
   ```

4. Start the preview. There is no need to run `brew services start` or enter any Supabase or Claude credentials.

   ```bash
   POCKET_PREVIEW_PG_BIN="$(brew --prefix postgresql@17)/bin" bash scripts/preview.sh
   ```

5. In Safari or Chrome open **http://127.0.0.1:5173**. Leave Terminal open while testing. Press **Control-C** there to stop the web server, API and dedicated PostgreSQL cluster. Practice data persists in the ignored `.tmp/preview` directory. Repeat step 4 whenever you want to preview. If a port is busy, stop your other development server first.

## Try a complete practice flow

- Choose **contributor** to create content. Open **Overview → Create content** for mock drafting, or use **Content → Write one yourself** for a manual draft. Use fictional details.
- Open the saved draft. Add a JPEG, PNG or WebP. Submit it for review.
- Sign out and choose **approver**. Open **Approvals**, review and approve the draft, then open **Ready to Post**. Keep the exercise inside the preview.
- Switch back to contributor and replace the photo. The draft requires a new approval, and old versions retain their original photo.
- In **AI Advisor**, send a question, open it from recent history, and try **Draft content from this question**. Responses are explicitly simulated.
- Choose **viewer** to see the restricted navigation. On a narrow screen open **Menu** and press Escape to close it.

Invitations and real provider responses require their respective real services. Use the practice roles and fictional or authorized assets for preview exercises.

## Update an existing Mac checkout

Stop the running preview, open Terminal in your existing repository, then run:

```bash
git switch feat/marketing-studio
git pull --ff-only origin feat/marketing-studio
export PATH="$(brew --prefix node@24)/bin:$PATH"
POCKET_PREVIEW_PG_BIN="$(brew --prefix postgresql@17)/bin" bash scripts/preview.sh
```

Wait for the terminal to print the preview URL. The launcher checks the API before starting the browser app and applies new migrations to the existing practice database. This update leaves the dependency lockfile unchanged. If the folder is inside a cloud-synchronized Desktop and build performance remains poor, consider keeping the checkout in a local development directory. The cause of the original Mac delay was not established.

To supply the authorized logo, add a transparent-background PNG at `apps/web/public/brand/the-pocket-logo.png`. Visual Studio supports private uploads, edits, and local draft attachment. To download an edited photo, choose **Prepare PNG**, then **Download PNG**. Feed Planner orders draft visuals in this browser. It displays recorded posts separately and never modifies publication dates.

Phase 3's first launch applies migration 015. It keeps existing media and collections, and adds ten empty default albums per restaurant. Browse them from **At a Glance → Browse albums**. Open **Attach a photo** in the composer to select an authorized image or upload a private one. Confirm photo privacy before asking for a practice edit.

## Authorized live Claude evaluation

Ordinary preview still strips the Claude key and uses the existing practice data. Live evaluation requires explicit spending and credential authorization. Use fictional materials only. It uses a separate loopback-only database and media directory under `.tmp/live-evaluation`. It does not use shared Supabase or the ordinary preview's media.

1. Obtain an authorized Anthropic API credential assigned to the evaluation. Keep it in your password manager, and use an approved provider-side spending limit if available.
2. Stop the ordinary preview with **Control-C**. From the repository folder start Bash and enter the credential at the hidden prompt. The value is kept in the shell environment only.

   ```bash
   bash
   export PATH="$(brew --prefix node@24)/bin:$PATH"
   read -r -s -p "Authorized Anthropic key: " ANTHROPIC_API_KEY
   printf '\n'
   export ANTHROPIC_API_KEY
   export POCKET_PREVIEW_LIVE_EVALUATION=true AI_EVALUATION_MAX_CALLS=5 AI_MONTHLY_BUDGET_USD=1
   export AI_LIVE_PHOTO_ADVICE=false AI_LIVE_REFERENCE_IMAGES=false
   POCKET_PREVIEW_PG_BIN="$(brew --prefix postgresql@17)/bin" bash scripts/preview.sh
   ```

3. Use the printed loopback address, choose a role and open **AI Advisor**. Check that it says **Live Claude evaluation is active** before submitting fictional text. Five is a persistent call cap for this isolated database. The dollar amount is a local estimated threshold, and the provider may bill failed or already in-flight requests.
4. For authorized subject-photo tests, stop and restart with `AI_LIVE_PHOTO_ADVICE=true`. For authorized reference comparisons, also set `AI_LIVE_REFERENCE_IMAGES=true`. In Brand Studio approve an eligible on-brand photo version and have the image owner explicitly allow that version for live evaluation. Current team sharing remains required. Confirm photo privacy before each edit request.
5. To stop, press **Control-C**, run `unset ANTHROPIC_API_KEY POCKET_PREVIEW_LIVE_EVALUATION AI_EVALUATION_MAX_CALLS AI_MONTHLY_BUDGET_USD AI_LIVE_PHOTO_ADVICE AI_LIVE_REFERENCE_IMAGES`, and start the usual preview. Advisor should say it is using practice mode. Exit the temporary Bash shell when finished.

Do not put the credential in the repository, app interface or chat. These instructions were reviewed against the code and exercised with test providers. No paid request was sent.
