# E-commerce LINE Login, customer accounts, and reviews

## Configure LINE Login

1. In LINE Developers, create or select a **LINE Login** channel and set its callback URL to:
   `https://<your-frontend-domain>/api/social/oauth/line/callback`
2. Set these backend environment variables (Plesk → Node.js → Custom environment variables):
   - `APP_PUBLIC_URL`: the frontend origin, such as `https://app.example.com` (no path).
   - `LINE_LOGIN_CHANNEL_ID` and `LINE_LOGIN_CHANNEL_SECRET`: credentials from the LINE Login channel.
   - `ECOMMERCE_AUTH_PROXY_SECRET`: a randomly generated secret of at least 32 characters.
3. Set the same `ECOMMERCE_AUTH_PROXY_SECRET` in the frontend/Vercel project environment. It is server-only; do not use a `NEXT_PUBLIC_` prefix.
4. Redeploy/restart the backend and frontend. The backend applies migration `043_ecommerce_customers_reviews.sql` automatically when `AUTO_MIGRATE=true`.

The storefront exposes LINE Login after the channel and secrets are configured. The flow uses a one-time state value, PKCE, an HttpOnly state cookie, and an opaque HttpOnly customer session cookie. The LINE channel only requests the `profile` scope; it does not request LINE email.

## Customer data and checkout

The LINE identity is shared across POSWITHAI shops. Saved addresses and order history are scoped to the current shop's organization, so one shop cannot read another shop's customer data. Guest checkout remains available. When signed in, a customer may save an address during checkout; the default address is prefilled on future visits. Customers can review their order history, track orders, and remove saved addresses from **บัญชีของฉัน**.

## Product reviews

Reviews are public and appear immediately. Only a signed-in customer with a paid order for the same product in the current shop can submit one review per purchased order line. The backend verifies the order, store, payment status, product, and customer identity; review eligibility is never accepted from client-provided ownership claims.
