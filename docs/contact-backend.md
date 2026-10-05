# Enquiry forms backend

```
Browser form ──JSON──▶ /api/contact (api/contact.js, Vercel function)
                          │ validates, sanitises, spam checks
                          └─form-urlencoded + secret──▶ Google Apps Script ──MailApp──▶ cafearalikatte@gmail.com
```

Both forms (`/contact/` "Send a message" and `/catering/` "Planning an event?") post to the same endpoint. The browser never sees the Apps Script URL or secret, and no Gmail password exists anywhere: the Apps Script sends mail as the Google account that owns it.

## Environment variables (server-side only)

| Name | Value |
|---|---|
| `GOOGLE_APPS_SCRIPT_URL` | `https://script.google.com/macros/s/<deployment-id>/exec` |
| `GOOGLE_APPS_SCRIPT_SECRET` | the shared secret; must equal the secret the Apps Script checks |

- **Production / previews:** Vercel → Project → Settings → Environment Variables. Add both for *Production* and *Preview*, then **redeploy** (env changes only apply to new deployments).
- **Local:** `.env.local` (git-ignored); template in `.env.example`.

If either is missing, the endpoint answers `500 {"success":false}` and the form shows an error. It never shows a false "Thank you".

## Request sent to Apps Script

`POST` `application/x-www-form-urlencoded`:
`formType` (`general` | `catering`), `name`, `phone`, `email`, `message`, `secret`. Catering also sends `eventDate` (DD-MM-YYYY), `guests`, `eventType` and `location`.

The endpoint treats `{"success":true}` (also `{"status":"success"}`, `{"result":"success"}` or plain `OK`) as delivered. Anything else, including `{"success":false,...}`, an HTML error page, an HTTP error, or no reply within 25 s, is reported to the visitor as a failure.

## Validation and protection (api/contact.js)

- **Required fields.** General: name, phone, message. Catering: name, phone, event date, guests, event type, location, message. Email is optional but must be a valid address if given. Whitespace-only values are rejected.
- **Field rules.** Length caps: name 100, phone 20, email 254, location 150, message 2000. Phone must have 7–15 digits. Guests must be 1–10,000. The event date must be a real date, today or later.
- **Sanitising.** Control, zero-width and bidi characters are stripped and whitespace is tidied. Otherwise values are forwarded exactly as typed.
- **Spam.**
  - A hidden honeypot field (`website`): bots get a fake success and nothing is sent.
  - A minimum 2 s fill time.
  - More than 2 links in one enquiry is rejected.
  - Same-origin check and JSON-only requests.
  - 16 KB body limit.
  - Burst limit of 8 per 10 min per IP.
  - Identical resubmissions within 10 min are confirmed but not emailed twice.
- **Limits of the memory-based checks.** The rate limit and duplicate check live in each serverless instance's memory, so they are best-effort.
- **Logs.** One JSON line per request, with outcome and form type only: no names, phones, emails, IPs or secrets.

## Testing

```
node scripts/test-contact.mjs          # unit + browser tests against a stubbed Apps Script (no email)
node scripts/test-contact.mjs --live   # also sends the two spec test enquiries via .env.local (emails the cafe)
```

## Troubleshooting `Unauthorized request.`

This means the Apps Script rejected the secret. Check that:
1. The secret in the script (or its Script Properties) is exactly the `GOOGLE_APPS_SCRIPT_SECRET` value, with no spaces.
2. The script reads it from the form field named `secret` (`e.parameter.secret`).
3. After editing the script, you created a new deployment version: Deploy → Manage deployments → Edit → Version: *New version*. The `/exec` URL keeps running the old version until you do.
