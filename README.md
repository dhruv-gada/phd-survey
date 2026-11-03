# Let us work together: live PhD student survey

Share one link. Each student answers four questions on their phone, one at a time, with a 45-second countdown for each. After answering, they see that question's poll update live as classmates vote.

## Pages

- `/`: the survey. Share this link or the QR code.
- `/results`: all four polls updating live, with the QR code. Good for a projector.
- `/ad-reimagine-bme`: admin sign-in (`ADMIN_USER` / `ADMIN_PASS`) for downloading CSVs and starting a new session

## How it works

- Answers are anonymous. Each phone gets a random cookie so it can answer each question only once. Names, emails and IP addresses are not stored.
- If the countdown runs out, the question is skipped and the student sees the results.
- **Sessions:** to use the survey with a new group, start a new session on the admin page and give it a name. Everyone can then answer again. Each session has its own **Download CSV** button, with one row per student.

## Settings

- Time per question: `TIME_LIMIT` at the top of `questions.js`
- The questions themselves: `questions.js`

## Run locally

```bash
npm install
ADMIN_USER=you@example.edu ADMIN_PASS=choose-a-password npm start
# open http://localhost:3000
```

## Environment variables

| Name | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string. Needed on Render, because free services lose local files when they restart. |
| `ADMIN_USER`, `ADMIN_PASS` | Admin sign-in |
| `PUBLIC_URL` | Optional. Overrides the address the QR code points to. |
