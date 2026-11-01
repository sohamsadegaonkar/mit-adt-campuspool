# CampusPool 2.0 — isolated responsive frontend prototype

This standalone frontend prototype lives at `prototypes/campuspool-2/` and does **not** replace or connect to the existing CampusPool app.

## Open locally

Open `index.html` in a browser, or serve the repository root:

```bash
python3 -m http.server 8080
```

Navigate to `http://localhost:8080/prototypes/campuspool-2/`.

The prototype uses **plain HTML, CSS, and JavaScript**, SVG icons, and browser localStorage. No build step, npm install, external API, payment credentials, or production database is needed.

## Screens and flows

- Responsive Home: campus identity, Rides and Errands entry points, sample activity, student-safety context
- Rides: sample ride listings, vehicle filters, ride-offer form, seat-request confirmation, booking activity
- Errands: requester and runner views, shop trip announcement, request filtering, runner rewards
- Requester: item, shop, campus handover point, estimated price, optional notes, runner reward, review screen
- Payments: transparent UPI/wallet **simulation only**, total including fee, broadcasting after simulated payment
- Runner: accept, arrive at shop, confirm pickup, enter requester-provided PIN, complete delivery
- Tracking: status steps, item, location, simulated payment breakdown, requester/runner perspective switch
- Activity: personal requests, assigned errands and sample ride bookings
- Profile: example campus student, simulated earnings, preferences, reset data

## Demo walkthrough

1. Open Home → **Request an item**.
2. Enter an item, estimated cost, shop, delivery point and reward.
3. Choose a simulated payment method; press **Simulate payment**.
4. From the order screen, switch to **Runner view**, then **Accept request**.
5. Select **I am at the shop**, followed by **Mark as picked up**.
6. Switch to Requester view to read the four-digit PIN, then return to Runner view and enter it.
7. See the completed delivery in Activity and simulated earnings in Profile.
8. Try Rides → **Request seat**, or **Offer a ride**.

You can also enter Runner mode directly from Errands and accept one of the illustrative requests.

## Data and production safety

- All student profiles, rides, errands, payments and orders shown in the prototype are sample or locally created demo records.
- JavaScript performs **no network requests**; no production backend API is called.
- There is **no real UPI transfer, escrow account, payment gateway, bank processing, settlement or payout**.
- Local state is saved only in the current browser's `localStorage` under `campuspool2_demo_v1` and can be reset from Profile.
- No live location tracking, real student verification, or push notifications.
- This folder is isolated from `index.html`, `server.js`, database files and production configuration.
- Not suitable for real-money orders or unverified real users.

## Visual system

Based on the repo's `DESIGN.md` and `campuspool.css`:

- White canvas, ink `#171717`, taxi yellow `#f4ce37`
- Arial / Helvetica Neue / system sans-serif
- Flat neutral cards and compact corner radii
- Keyboard focus indicators, labelled controls, responsive bottom navigation and reduced-motion support

## Integration recommendations

After design approval, migrate the new UI components into the current frontend incrementally. Reuse the existing identity and authorization model where possible. Add a dedicated backend errand domain, atomic acceptance transitions, rider/runner access controls, refund/dispute workflows and a payment-provider-supported marketplace payout scheme before permitting real-money transactions. Keep the existing ride APIs and bookings unchanged until a dedicated migration/test plan has passed.
