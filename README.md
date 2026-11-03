# Let us work together: anonymous PhD survey with live results

Students scan a QR code, answer 4 questions anonymously, and the results page updates in real time.

- `/`: the survey (phone-friendly)
- `/results`: live dashboard with the QR code. Put this on the projector.
- `/admin?key=YOUR_ADMIN_KEY`: download a CSV of responses or clear test responses

No names, emails or IP addresses are stored, only the answers and a timestamp.

## Run locally

```bash
npm install
ADMIN_KEY=choose-a-secret npm start
# open http://localhost:3000/results
```

Without `DATABASE_URL`, responses are saved to `data/responses.json`.

## Deploy on Render (free)

1. Push this folder to a GitHub repo (it can be private).
2. In Render, create a **Postgres** database (the free tier works) and copy its *Internal Database URL*.
3. Create a **Web Service** from the repo:
   - Runtime: Node
   - Build command: `npm install`
   - Start command: `npm start`
   - Environment variables:
     - `DATABASE_URL` = the Postgres URL from step 2
     - `ADMIN_KEY` = any secret you choose
4. Open `https://<your-service>.onrender.com/results`. The QR code automatically points at the survey.

Notes:
- Free web services go to sleep after about 15 minutes without traffic. Open `/results` a minute before the session so it's awake.
- Free Render Postgres databases expire after 30 days. Download the CSV from `/admin` after the event.
- To point the QR code somewhere else, such as a custom domain, set `PUBLIC_URL`.

## Editing the questions

All questions live in `questions.js`. The survey, the validation and the charts are all generated from that file.
