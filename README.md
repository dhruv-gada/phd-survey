# Let us work together: live PhD student survey

A presenter-run live poll. Students scan a QR code and answer anonymously on their phones, one question at a time, each against a countdown. When time runs out, the results appear on the projector and on every phone, and the presenter moves on to the next question.

## Pages

- `/`: the student page that the QR code opens
- `/screen`: the projector view, with the QR code, the current question with its countdown, then the results
- `/ad-reimagine-bme`: presenter controls (sign in with `ADMIN_USER` / `ADMIN_PASS`)

## Running a session

1. Put `/screen` on the projector. It shows the QR code and how many phones have joined.
2. On your phone or laptop, open `/ad-reimagine-bme`, pick a time per question, and press **Start question 1**.
3. When the timer ends, the question closes on its own and everyone sees the results. **End question now** closes it early, and **Add 15 seconds** gives more time.
4. Press **Start question 2**, and so on. After the last one, press **Show all results**.
5. Running it again with a new group? Press **Start a new session**. Every phone can answer again, and earlier answers stay in the CSV.

## One answer per phone

Each phone gets a random anonymous cookie. The server accepts one answer per phone per question and refuses answers after the timer ends. Names, emails and IP addresses are not stored. A student who opens a private browser window gets a new cookie, so this is a deterrent, not a guarantee.

## Run locally

```bash
npm install
ADMIN_USER=you@example.edu ADMIN_PASS=choose-a-password npm start
# open http://localhost:3000/screen and http://localhost:3000/ad-reimagine-bme
```

Without `DATABASE_URL`, answers are saved to `data/store.json`.

## Environment variables

| Name | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string. Strongly recommended on Render, because free services lose local files when they restart. |
| `ADMIN_USER`, `ADMIN_PASS` | Presenter sign-in |
| `PUBLIC_URL` | Optional. Overrides the address the QR code points to. |
| `SESSION_SECRET` | Optional. Keeps presenters signed in across restarts. |

## Editing the questions

Every question lives in `questions.js`. The phone page, the projector, validation and the CSV are all generated from that file.
