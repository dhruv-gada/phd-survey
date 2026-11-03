# Let us work together: live PhD student survey

The admin moves the room through the questions. Students answer the current question on their phones, then look at the projector, where that question's poll fills in live.

## Pages

- `/`: the survey. Share this link or the QR code with students.
- `/results`: the projector. It shows the QR code before you start, then the current question's live poll, then all results at the end.
- `/ad-reimagine-bme`: admin sign-in (`ADMIN_USER` / `ADMIN_PASS`)

## Running it

1. Put `/results` on the projector. Students scan the QR code.
2. On the admin page, press **Start question 1**.
3. Students answer, and their phone tells them to look at the screen. The poll updates as answers come in.
4. Press **Next question**. Every phone switches automatically. After the last question, press **Show all results**.

**Back** returns to the previous question, and **Show QR code** returns to the start screen.

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
