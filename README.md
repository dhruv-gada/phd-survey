# Let us work together: live PhD student survey

The admin moves the room through the questions. Students answer the current question on their phones, then look at the projector, where that question's poll fills in live.

## Pages

- `/`: the survey. Students open this from the QR code.
- `/ad-reimagine-bme`: **presenter view**. After you sign in, this tab shows exactly what the projector should show, so it's safe to screen-share or put on the projector. A small control bar sits at the bottom and fades out when the mouse is still.
- `/ad-reimagine-bme/responses`: the student link, sessions and CSV downloads. Opens in its own tab so it never appears on the shared screen.
- `/results`: the same projector view without controls, for a second display

## Running it

1. Sign in at `/ad-reimagine-bme`, then share that tab or put it on the projector. It starts on the QR code.
2. Press **Start question 1** in the control bar, or the right arrow key.
3. Students answer on their phones, which then tell them to look at the screen. The poll fills in live.
4. Press **Next question**. After the last question, it says **Show all results**.

| Key | Does |
|---|---|
| Right arrow, Space, Page Down (most clickers) | Next |
| Left arrow, Page Up | Back |
| Q | Back to the QR code |
| F | Full screen |

Keys and clickers don't bring the control bar back, so presenting with them shows nothing extra on screen.

## Sessions and CSVs

For a new group, press **Start a new session** on the admin page and give it a name. Everyone can then answer again. Each session is listed with its own **Download CSV** button, with one row per student.

## No database

Answers are kept in a small file on the server while it runs. Render's free plan clears that file whenever the site restarts or redeploys, so download each session's CSV from the admin page when the session ends. While the projector or admin page is open, it keeps the site awake.

## Anonymity

Each phone gets a random cookie, so it can answer each question once. Names, emails and IP addresses are not stored. A phone can only answer the question that's currently on the screen.

## Run locally

```bash
npm install
ADMIN_USER=you@example.edu ADMIN_PASS=choose-a-password npm start
```

| Variable | Purpose |
|---|---|
| `ADMIN_USER`, `ADMIN_PASS` | Admin sign-in |
| `PUBLIC_URL` | Optional. Overrides the address the QR code points to. |

The questions are in `questions.js`.
