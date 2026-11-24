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
