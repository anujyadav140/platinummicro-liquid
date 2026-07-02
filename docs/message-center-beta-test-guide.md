# Message Center (Beta) - Test Guide

Hi Jann! We built a new Message Center for customers. It is one page where a signed in customer can see their orders, shipping tracking, quote status, and message our team. Messages reach us by email, our replies reach the customer by email AND show up on their page like a chat thread.

The page: **https://platinum-micro.myshopify.com/pages/messages**
(also reachable from the homepage strip: "Drop us a message > Go to your messages" when signed in)

Please test the items below and note anything that looks wrong, confusing, or broken. Screenshots help a lot.

---

## Part 1 - Test as a customer (15 min)

You need a customer account on the store. If you do not have one, sign up first (account icon in the header). Use an email you can check.

1. **Signed out view:** open /pages/messages in a private window. You should see a "Sign in to see your messages" card and a guest message form. Nothing personal should be visible.
2. **Sign in** and open the page again. You should see:
   - Tabs: All / Orders and shipping / Quotes / From Platinum Micro
   - Your orders with payment and shipping status (if you have any)
   - A quote status card
   - The dark "Message Platinum Micro" box on the right with your name and email shown under "Sending as"
3. **Send a message:** pick a topic, type a real sentence, press Send message.
   - Expected: a green "Message sent" banner appears WITHOUT the page reloading, and a "You - just now" card pops into the feed.
4. **Wait about 10 minutes**, then refresh the page.
   - Expected: your message now appears in the feed as "You" with a topic label. This is the permanent copy, it will show on any device you sign in from.
5. **Privacy check (important):** sign out, sign in as a DIFFERENT customer account (or ask someone else to). Their page must NOT show your messages. Each account only sees its own conversation.

## Part 2 - Test as the admin (needs access to the anuj@platinummicro.com inbox)

1. After a test message is sent, check the inbox.
   - Expected: an email from **submissions@formsubmit.co** with subject starting **[Message Center]** within a minute. First time it may land in Spam or Promotions, if so mark it "Not spam".
   - The email shows name, email, topic, order reference, and the message in a table.
2. **Reply to that email** normally in Gmail. Write a short answer and send.
   - Check the To: field first, it should be the customer's email address, not formsubmit.
   - Expected: the customer receives your reply in their email inbox right away.
3. **Wait about 10 minutes**, then refresh the customer's /pages/messages.
   - Expected: your reply appears indented under the customer's message with a "replied" label.

## Part 3 - Customer replies by email (5 min)

1. As the customer, reply to the admin's email reply from your own inbox (just answer the email like normal).
2. Wait about 10 minutes and refresh /pages/messages.
   - Expected: your email reply also shows on the page, indented in the same conversation.

## Part 4 - Quick checks around the page

- Orders and shipping: if your test account has an order, it should show payment status, fulfillment status, and tracking links when shipped.
- Quotes: add a product with "Request a Quote" then check the page, the quote card should mention your draft quote.
- Mobile: open the page on a phone, layout should stack cleanly.
- The "Chat with us" bubble (Tidio) still works separately for live chat.

## Known beta behavior (not bugs)

- The on-page thread updates about every 10 minutes. Email is instant, the page catches up.
- Replies must be sent from the anuj@platinummicro.com mailbox to appear on the site.
- Guests without a store account get email replies only, they have no thread page.
- Each conversation keeps the newest 50 entries on the page. Full history stays in email.
- The topic label on a message comes from the Topic dropdown. Put the message text in the Message box, not the Order reference box.

## What to report

For anything odd: what you did, what you expected, what actually happened, plus a screenshot and the time. Send it to Anuj.

Thanks Jann!
