# Green Pocket Snooker Zone — cloud billing app

This is a deployable React + Supabase web app (installable as a PWA after deployment). It is designed for five initial tables and supports adding more tables from the owner account.

## Included
- Five independent table sessions.
- Server-timestamped start/end times (not dependent on the staff phone clock).
- Rate fixed in the database at ₹250/hour.
- Billing by elapsed minutes, rounded up to the next whole minute.
- Cash/UPI payment recording and sequential invoice numbers.
- Owner and staff roles enforced by database row-level security and server-side functions.
- Owner daily collection view, expenses, cash reconciliation and audit log.
- Live refresh across signed-in devices using Supabase Realtime.

## Important payment limitation
Recording a payment as UPI does **not** verify the bank transaction. Staff must confirm the payment in the club's merchant UPI app/bank account before selecting UPI. Automated payment verification requires a payment gateway or bank/merchant integration and credentials. Never rely on a customer screenshot alone.

## 1. Create the cloud database
1. Create a project at https://supabase.com.
2. Open **SQL Editor** in the Supabase dashboard.
3. Paste and run `supabase/schema.sql`.
4. In **Project Settings → API**, copy the Project URL and `anon`/publishable key.

## 2. Create owner and staff accounts
1. In Supabase, open **Authentication → Users**.
2. Create the owner's user with email and a strong password. Disable public sign-ups in Authentication settings.
3. Copy the owner's user UUID.
4. In SQL Editor, run (replace the values):
   ```sql
   insert into public.profiles(id, full_name, role)
   values ('OWNER-AUTH-UUID', 'Club Owner', 'owner');
   ```
5. Create staff accounts in Authentication → Users, then add each profile:
   ```sql
   insert into public.profiles(id, full_name, role)
   values ('STAFF-AUTH-UUID', 'Staff Member', 'staff');
   ```
6. Never share the owner login with staff. Staff should use their own accounts.

## 3. Configure the app
1. Install Node.js 20 or newer.
2. Extract this ZIP and open a terminal in the project folder.
3. Create a file named `.env` in the project root:
   ```env
   VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
   VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_OR_PUBLISHABLE_KEY
   ```
4. Install and run:
   ```bash
   npm install
   npm run dev
   ```
5. Open the local address printed by Vite and sign in.

**Never place a Supabase `service_role` key in `.env` or frontend code.** The app only needs the public anon/publishable key; database policies protect the data.

## 4. Publish online
Deploy the project to Vercel or Netlify:
- Build command: `npm run build`
- Output directory: `dist`
- Add the two `VITE_SUPABASE_...` environment variables in the hosting dashboard.
- Deploy, then open the deployed HTTPS URL on each phone/tablet and use **Add to Home Screen** in the browser.

The owner and staff then sign in on their own devices. Records are shared through the same Supabase project.

## 5. Before real-world use
- Test all five tables, session timing, payment entry and reconciliation with sample sessions.
- Verify that a staff account cannot see the owner reports or audit tab.
- Verify that staff cannot change the rate or directly edit completed sessions/payments.
- Configure Supabase database backups and restrict project dashboard access.
- Confirm your invoice/tax requirements with your accountant; this starter does not calculate GST or issue a legally certified tax invoice.
- Keep a daily closing procedure: compare the app's cash expected total with physical cash and verify UPI receipts in the merchant account.
- Do not use the app for live billing until you have completed the tests and secured the owner account.

## Billing examples
₹250/hour = ₹4.1667/minute. The app rounds elapsed time up to a whole minute:
- 30 minutes: ₹125.00
- 45 minutes: ₹187.50
- 60 minutes: ₹250.00
- 61 minutes: ₹254.17

## Current scope / limitations
- This is a functional starter project, not a hosted service. It becomes a shared cloud app after you create the Supabase project, configure credentials and deploy it.
- Payment records are manual confirmation entries; UPI is not automatically verified.
- Receipts are represented by invoice numbers and payment records in this first release; printable thermal receipts, WhatsApp/SMS delivery, customer profiles and exports can be added in a subsequent version.
- Opening cash is entered by the owner during reconciliation; it is not currently stored as a separate daily opening-float record.
- Database audit records are append-only for normal app users. A Supabase project administrator can still alter database data, so tightly restrict administrator credentials.
