# MIT ADT CampusPool • Production Deployment & Real Email Setup Guide

Exclusive student ride-sharing & bikepooling application for MIT Art, Design and Technology University, Loni Kalbhor, Pune.

---

## ⚡ How to Receive Real OTP Emails in Your Actual Inbox (60-Second Setup)

By default, `.env.production` comes with placeholder credentials (`SMTP_PASS=your_16_character_app_password`). When running with placeholders, the server prints the code to your server terminal.

To have the server dispatch real emails straight into your `@students.mituniversity.edu.in` or personal inbox:

### Step 1: Generate a Free Google App Password
1. Open [myaccount.google.com/security](https://myaccount.google.com/security) in your Google account.
2. Turn on **2-Step Verification** (if not already enabled).
3. Search or navigate to **App passwords** ([myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)).
4. Enter an app name like `CampusPool` and click **Create**.
5. Google will display a **16-character password** (e.g., `abcd efgh ijkl mnop`).

### Step 2: Paste into `.env.production`
Open `.env.production` in your project folder and update the SMTP lines:
```ini
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=your_personal_email@gmail.com
SMTP_PASS=abcdefghijklmnop
SMTP_FROM="MIT ADT CampusPool <your_personal_email@gmail.com>"
```

### Step 3: Start the Server
```bash
node server.js
```
Now, whenever any student enters their email (university or personal Gmail) on the verification screen, a real email containing the 6-digit verification code will land directly in their inbox automatically!

> **Note:** You only configure `.env.production` **ONCE** with your sender credentials. You **NEVER** need to manually add new students' emails into `.env.production` or Google Cloud! The server automatically sends the OTP to whatever email the new student types on the screen.

---

## Alternative: Free Brevo / SendGrid / Resend SMTP
If you prefer not using a personal Gmail account, you can use any free SMTP provider:
- **Brevo (Sendinblue)**: Free 300 emails/day (`smtp-relay.brevo.com`, port 587)
- **SendGrid**: Free tier (`smtp.sendgrid.net`, port 465, user `apikey`)
- **University SMTP Relay**: If MIT ADT provides an internal SMTP relay (`mail.mituniversity.ac.in`, port 25/587), simply set `SMTP_HOST=mail.mituniversity.ac.in`.

---

## Database Features
- **ACID Persistent JSON Engine**: Auto-syncs to `campuspool_database.json`.
- **Zero Repetition Guarantee**: Rejects duplicate student names, mobile numbers, and emails with HTTP 409 before issuing OTPs.
- **PostgreSQL / Supabase Schema**: Production DDL in `schema.sql` with unique indexes on `LOWER(TRIM(email))`, `LOWER(TRIM(full_name))`, and `phone`.
