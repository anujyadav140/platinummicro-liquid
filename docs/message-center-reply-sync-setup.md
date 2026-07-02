# Message Center - Reply Sync Setup (for a new admin)

This guide is for an admin whose replies should show up on the customer's
Messages page on the website. Without this, your replies still reach the
customer by email right away. This only adds the website mirror.

How it works in one line: a small Google script runs inside YOUR Gmail every minute or
few minutes, finds the replies you sent to [Message Center] emails, and posts
them to that customer's thread on the site.

## Before you start, you need 3 things

1. **A Google hosted email.** Your inbox must be Gmail or Google Workspace.
   The script cannot read Outlook or other providers.
2. **The script file** `thread-sync.gs`. Ask Anuj to email it to you.
   Open it with Notepad so you can copy the whole thing.
3. **Two credentials from Anuj:** a Client ID and a Client Secret
   (the secret starts with `shpss_`). Treat the secret like a password.
   Do not forward it or paste it anywhere except step 3 below.

Also make sure the Message Center "Team inbox" theme setting points at your
email, otherwise there is nothing in your mailbox to sync.

## Setup (about 5 minutes, one time)

### Step 1 - Create the script project
1. Go to **script.google.com** and make sure you are signed in with the
   email that receives the customer messages.
2. Click **New project**.
3. Delete the empty code in the editor, then paste the ENTIRE contents of
   `thread-sync.gs`.
4. Press **Ctrl+S** to save. Name the project **PM Thread Sync**.

### Step 2 - Add the credentials
1. Click the **gear icon** (Project Settings) in the left sidebar.
2. Scroll to **Script Properties** and click **Add script property**.
3. Add these two rows exactly:
   - Property: `PM_CLIENT_ID` and Value: the Client ID from Anuj
   - Property: `PM_CLIENT_SECRET` and Value: the `shpss_...` secret from Anuj
4. Click **Save script properties**.

### Step 3 - Test it
1. Click the **< >** editor icon in the left sidebar to go back to the code.
2. In the toolbar there is a dropdown next to Debug. Open it and pick
   **testSetup**.
3. Click **Run**.
4. Google will ask for permissions the first time. Click through and allow.
   It needs Gmail (to read the message emails) and external requests
   (to talk to Shopify).
5. Look at the **Execution log** at the bottom. You want these three lines:

```
token exchange OK (shpat_ minted and cached)
SHOP OK - reached: Platinum Micro
CUSTOMER SCOPE OK - search works
```

If any line says FAILED, stop and see Troubleshooting below.

### Step 4 - Set the timer
1. Click the **clock icon** (Triggers) in the left sidebar.
2. Click **Add Trigger** (bottom right).
3. Set it up like this:
   - Choose which function to run: **syncReplies**
   - Deployment: **Head**
   - Event source: **Time-driven**
   - Type of time based trigger: **Minutes timer**
   - Interval: **Every minute** (or every 5 minutes if this is a free @gmail.com account, Google gives those less daily runtime)
4. Click **Save**.

That is it. The script now runs on its own at that interval, forever.

## Prove it works

1. Have a signed in customer send a message from /pages/messages
   (or send one yourself from a customer account).
2. The email arrives in your inbox from **submissions@formsubmit.co**.
3. Hit **Reply** in Gmail. Check the To: field shows the customer's email,
   not formsubmit. Write a short answer and send.
4. Wait a minute or two (or go to the script editor, pick **syncReplies**
   in the dropdown and click Run to skip the wait).
5. Refresh the customer's /pages/messages. Your reply should appear
   indented under their message with a "replied" label.

## Good to know

- Only replies sent FROM this Gmail account appear on the website.
- The customer always gets your reply by email instantly. The website
  catches up within a minute or two.
- Two extra rows will appear in Script Properties on their own:
  `ADMIN_TOKEN` and `ADMIN_TOKEN_EXP`. The script manages these itself.
  Leave them alone. Same for `PROCESSED_IDS`.
- More than one admin can run this at the same time (Anuj already does).
  The scripts do not conflict.

## Troubleshooting

- **token exchange HTTP 400 or 401:** the Client ID or Secret is wrong.
  Re-copy them into Script Properties, watch for spaces.
- **CUSTOMER SCOPE FAILED - HTTP 403:** the app is missing permissions.
  Ask Anuj to open the app in the Shopify Dev Dashboard and add the
  `read_customers` and `write_customers` scopes.
- **syncReplies says "done - 0 replies synced" but you did reply:**
  check you replied from THIS Gmail account, and that the To: field was the
  customer's address. Also confirm the reply email subject still starts
  with "Re: [Message Center]".
- **Nothing happens ever:** check the Triggers page shows the syncReplies
  trigger, and open its executions log (left sidebar, the list icon) to
  see if runs are failing.

Questions: ask Anuj.
