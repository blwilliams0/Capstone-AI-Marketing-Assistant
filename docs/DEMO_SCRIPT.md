# Prototype Demo Script (Nov 23, laptop)

About 10 minutes. The story: **management controls the brand; the AI helps staff move faster inside those limits; nothing goes out without an exact, recorded approval.**

## The day before

1. **Start the app** in VS Code, in two terminals in the project folder: `npm run dev:api` and `npm run dev:web`. Open http://localhost:5173. The API startup line must say `"aiMode":"claude"`.
2. **Second account.** As admin, go to Staff and invite a second email you own as a **contributor** (for example a school address). Accept the invite and set a password. In the demo, this person plays a staff member, in a private browser window.
3. **Approve a couple of real facts**, if management can confirm them: a current dish, the patio hours, the booking method. These remove the `[brackets]` from drafts and make the AI's output much more specific. Add them under Knowledge → Verified facts.
4. **Rehearse once, end to end**, and keep that rehearsal post saved. If the AI or Wi-Fi is slow on the day, you can show the saved one instead of waiting.
5. **Name demo posts clearly**, starting with "DEMO –". History is permanent by design (nothing can be deleted), and posts from the last 6 months are shown to the AI so it avoids repeating them. Clear names keep the record honest.

Cost: a question is about 4 cents and a draft about 8 cents.

## The demo

| # | Who | Screen | What to show and say |
|---|---|---|---|
| 1 | Admin | Home | "Each person sees only what their role allows. The server checks every action, not just the screen." |
| 2 | Admin | Knowledge | The approved brand rules and the strategy. "Only Mike and Elliot can approve what the AI treats as true. Staff can suggest; management decides." Optionally approve a pending item to show the confirmation step. |
| 3 | Staff | Ask | Ask: *"What should we post this weekend for locals?"* Point out the sources, and the "please confirm" list. "It won't invent dishes or prices. It tells you what to check and with whom." |
| 4 | Staff | Create a post | Locals, Instagram, goal *"Bring locals back on weeknights"*. While it works (up to a minute): "It reads the brand rules, the relevant parts of the strategy, and a summary of recent posts so it doesn't repeat itself." Show the 2–3 options, why each fits, the photo tips and the risks. Click **Save as a post**. |
| 5 | Staff | Post page | **Edit** to fill any `[brackets]`, then **Submit for approval**. Point out the fingerprint: "Approval will cover exactly this text." |
| 6 | Admin | Posts → Waiting for approval | Open it and walk the review checklist. Then **Approve this version**. |
| 7 | Staff | Post page (optional) | Click **Edit**, change a word and save. The status drops back to *Draft*: "Change one word after approval and it needs approving again. That's enforced by the database, not just the app." Re-submit and re-approve. |
| 8 | Staff | Ready to post | **Copy the approved text**. "The app never posts by itself. A person posts it, then records it." For the demo, don't post for real: click **I posted it** with the note "Demo, not actually posted". |
| 9 | Admin | Activity | The full trail: who submitted, approved and posted, when, with the fingerprint of the exact text. "This history can't be edited or deleted." |

## Likely questions

- **"Can staff approve their own posts?"** No. Approvers can't approve anything they wrote or submitted. Only Mike and Elliot can approve their own work, with an extra confirmation that's recorded.
- **"What if the brand rules change?"** Posts that relied on the old rule are blocked from approval and posting until someone saves an update, which moves them to the current rule.
- **"What does it cost?"** About 4 cents per question and 8 cents per draft, with a monthly spending cap that stops AI requests when it's reached.
- **"Why not just use ChatGPT or a Claude Project?"** Those can't enforce who approves what, keep a permanent approval record, or stop a changed post from going out.
- **"Does it post to Instagram?"** Not in V1. The app produces the exact approved text and records the post, and a person posts it. Automatic posting is a later step.

## If something goes wrong

- **Draft takes too long or fails:** open the rehearsal post saved the day before and continue from step 5.
- **"Not responding" message:** the AI service had a hiccup. Wait a moment and try once more, or use the saved post.
- **Signed out:** sign in again. Both accounts use passwords set the day before.
