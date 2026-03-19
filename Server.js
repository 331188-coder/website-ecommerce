// 0. Create PaymentIntent for Stripe EMBEDDED components
//    The frontend Payment Element uses this (no redirect needed)
app.post('/api/stripe/create-payment-intent', async (req, res) => {
  try {
    const { color, qty } = req.body;
    const amount = 1900 * (parseInt(qty) || 1); // $19 per unit in cents

    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency: 'usd',
      automatic_payment_methods: { enabled: true }, // enables card, Apple Pay, Google Pay
      metadata: { color, qty: String(qty || 1), product: 'CARVAULT Seat Organizer' },
      description: `CARVAULT Seat Organizer — ${color} x${qty || 1}`,
    });

    res.json({ clientSecret: paymentIntent.client_secret });
  } catch (err) {
    console.error('PaymentIntent error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Also listen for payment_intent.succeeded webhook event
// Add 'payment_intent.succeeded' to your Stripe webhook events list

// ============================================================
// CARVAULT BACKEND — server.js
// Handles: Stripe payments, PayPal payments, order emails,
//          AliExpress order webhook notifications
//
// SETUP (run these commands in your terminal):
//   npm init -y
//   npm install express stripe @paypal/checkout-server-sdk nodemailer cors dotenv
//   node server.js
// ============================================================

require('dotenv').config();
const express    = require('express');
const stripe     = require('stripe')(process.env.STRIPE_SECRET_KEY);
const paypal     = require('@paypal/checkout-server-sdk');
const nodemailer = require('nodemailer');
const cors       = require('cors');

const app = express();

// ── CORS — allow your frontend domain ──────────────────────
app.use(cors({
  origin: [
    'http://localhost:3000',
    'https://carvault.com',       // ← replace with your domain
    'https://www.carvault.com',
  ]
}));

// ── Raw body needed for Stripe webhook signature check ──────
app.use('/webhook/stripe', express.raw({ type: 'application/json' }));
app.use(express.json());

// ── Serve your frontend HTML ────────────────────────────────
const path = require('path');
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// PAYPAL SETUP
// ============================================================
function getPayPalClient() {
  const env = process.env.NODE_ENV === 'production'
    ? new paypal.core.LiveEnvironment(
        process.env.PAYPAL_CLIENT_ID,
        process.env.PAYPAL_CLIENT_SECRET
      )
    : new paypal.core.SandboxEnvironment(
        process.env.PAYPAL_CLIENT_ID,
        process.env.PAYPAL_CLIENT_SECRET
      );
  return new paypal.core.PayPalHttpClient(env);
}

// ============================================================
// EMAIL SETUP (Gmail example — works with any SMTP)
// ============================================================
const mailer = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_FROM,     // your Gmail address
    pass: process.env.EMAIL_PASSWORD, // Gmail App Password (not your login password)
                                      // Generate at: myaccount.google.com/apppasswords
  }
});

async function sendOrderEmail(order) {
  // Email to YOU (store owner)
  await mailer.sendMail({
    from: process.env.EMAIL_FROM,
    to:   process.env.EMAIL_OWNER,
    subject: `🛒 New CARVAULT Order — $${order.amount} — ${order.color}`,
    html: `
      <h2>New Order!</h2>
      <p><strong>Product:</strong> CARVAULT Seat Gap Organizer — ${order.color}</p>
      <p><strong>Qty:</strong> ${order.qty}</p>
      <p><strong>Amount:</strong> $${order.amount}</p>
      <p><strong>Customer:</strong> ${order.customerName}</p>
      <p><strong>Email:</strong> ${order.customerEmail}</p>
      <p><strong>Ship to:</strong><br>
        ${order.address.line1}<br>
        ${order.address.city}, ${order.address.state} ${order.address.postal_code}<br>
        ${order.address.country}
      </p>
      <p><strong>Payment ID:</strong> ${order.paymentId}</p>
      <hr>
      <p>👉 <a href="https://www.aliexpress.com/item/YOUR_ALIEXPRESS_PRODUCT_ID.html">
        Click here to place on AliExpress
      </a></p>
      <p>Ship to customer address above. Paste AliExpress order ID in your tracker.</p>
    `
  });

  // Confirmation email to CUSTOMER
  await mailer.sendMail({
    from: `"CARVAULT" <${process.env.EMAIL_FROM}>`,
    to:   order.customerEmail,
    subject: `Your CARVAULT order is confirmed! 🚗`,
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto">
        <h1 style="color:#111">Order Confirmed</h1>
        <p>Thanks ${order.customerName}! Your CARVAULT Seat Gap Organizer (${order.color}) is on its way.</p>
        <table style="width:100%;border-collapse:collapse;margin:20px 0">
          <tr style="background:#f5f5f5">
            <td style="padding:12px">Product</td>
            <td style="padding:12px">CARVAULT Seat Gap Organizer — ${order.color}</td>
          </tr>
          <tr>
            <td style="padding:12px">Quantity</td>
            <td style="padding:12px">${order.qty}</td>
          </tr>
          <tr style="background:#f5f5f5">
            <td style="padding:12px">Total</td>
            <td style="padding:12px"><strong>$${order.amount}</strong></td>
          </tr>
          <tr>
            <td style="padding:12px">Ship to</td>
            <td style="padding:12px">${order.address.line1}, ${order.address.city}</td>
          </tr>
        </table>
        <p>Estimated delivery: <strong>7–14 business days</strong></p>
        <p>Questions? Reply to this email.</p>
        <p style="color:#999;font-size:12px">CARVAULT · carvault.com</p>
      </div>
    `
  });
}

// ============================================================
// STRIPE ROUTES
// ============================================================

// 1. Create a Stripe Checkout Session
app.post('/api/stripe/create-session', async (req, res) => {
  try {
    const { color, qty, customerEmail } = req.body;
    const unitPrice = 1900; // $19.00 in cents

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      customer_email: customerEmail || undefined,
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: `CARVAULT Seat Gap Organizer — ${color}`,
            description: 'Suede PU Leather · Universal Fit · Zero Rattle',
            images: ['https://carvault.com/product.jpg'], // optional: your product image URL
          },
          unit_amount: unitPrice,
        },
        quantity: qty || 1,
      }],
      mode: 'payment',
      shipping_address_collection: {
        allowed_countries: ['US', 'CA', 'GB', 'AU', 'DE', 'FR', 'NL', 'SE', 'NO'],
      },
      success_url: `${process.env.FRONTEND_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${process.env.FRONTEND_URL}/`,
      metadata: { color, qty: String(qty || 1) },
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe session error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 2. Stripe Webhook — fires AFTER payment succeeds
app.post('/webhook/stripe', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle embedded Payment Element success
  if (event.type === 'payment_intent.succeeded') {
    const pi       = event.data.object;
    const shipping = pi.shipping;
    const order    = {
      paymentId:     pi.id,
      paymentMethod: 'stripe-embedded',
      color:         pi.metadata.color,
      qty:           pi.metadata.qty,
      amount:        (pi.amount / 100).toFixed(2),
      customerEmail: pi.receipt_email || 'not provided',
      customerName:  shipping?.name   || 'Customer',
      address: {
        line1:       shipping?.address?.line1        || 'Collected via Stripe',
        city:        shipping?.address?.city         || '',
        state:       shipping?.address?.state        || '',
        postal_code: shipping?.address?.postal_code  || '',
        country:     shipping?.address?.country      || '',
      }
    };
    console.log('✅ Embedded Stripe payment succeeded:', order);
    await sendOrderEmail(order);
    saveOrder(order);
  }

  if (event.type === 'checkout.session.completed') {
    const session  = event.data.object;
    const shipping = session.shipping_details;

    const order = {
      paymentId:     session.id,
      paymentMethod: 'stripe',
      color:         session.metadata.color,
      qty:           session.metadata.qty,
      amount:        (session.amount_total / 100).toFixed(2),
      customerEmail: session.customer_details?.email,
      customerName:  shipping?.name || 'Customer',
      address: {
        line1:       shipping?.address?.line1 || '',
        city:        shipping?.address?.city  || '',
        state:       shipping?.address?.state || '',
        postal_code: shipping?.address?.postal_code || '',
        country:     shipping?.address?.country || '',
      }
    };

    console.log('✅ Stripe order received:', order);
    await sendOrderEmail(order);

    // Save to local orders log (append to orders.json)
    saveOrder(order);
  }

  }

  res.json({ received: true });
});

// ============================================================
// PAYPAL ROUTES
// ============================================================

// 1. Create PayPal Order
app.post('/api/paypal/create-order', async (req, res) => {
  try {
    const { color, qty } = req.body;
    const total = (19 * (qty || 1)).toFixed(2);
    const client = getPayPalClient();

    const request = new paypal.orders.OrdersCreateRequest();
    request.prefer('return=representation');
    request.requestBody({
      intent: 'CAPTURE',
      purchase_units: [{
        amount: {
          currency_code: 'USD',
          value: total,
          breakdown: {
            item_total: { currency_code: 'USD', value: total }
          }
        },
        items: [{
          name:        `CARVAULT Seat Gap Organizer — ${color}`,
          unit_amount: { currency_code: 'USD', value: '19.00' },
          quantity:    String(qty || 1),
          category:    'PHYSICAL_GOODS',
        }],
        shipping: { type: 'SHIPPING' },
        description: `CARVAULT ${color} x${qty}`,
      }],
      application_context: {
        brand_name:          'CARVAULT',
        shipping_preference: 'GET_FROM_FILE', // customer enters shipping in PayPal
        user_action:         'PAY_NOW',
        return_url:          `${process.env.FRONTEND_URL}/success`,
        cancel_url:          `${process.env.FRONTEND_URL}/`,
      },
    });

    const order = await client.execute(request);
    res.json({ id: order.result.id });
  } catch (err) {
    console.error('PayPal create order error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 2. Capture PayPal Order (fires after customer approves)
app.post('/api/paypal/capture-order', async (req, res) => {
  try {
    const { orderID, color, qty } = req.body;
    const client  = getPayPalClient();
    const request = new paypal.orders.OrdersCaptureRequest(orderID);
    request.requestBody({});

    const capture = await client.execute(request);
    const result  = capture.result;
    const payer   = result.payer;
    const unit    = result.purchase_units[0];
    const ship    = unit.shipping;

    const order = {
      paymentId:     result.id,
      paymentMethod: 'paypal',
      color,
      qty:           String(qty || 1),
      amount:        unit.payments.captures[0].amount.value,
      customerEmail: payer.email_address,
      customerName:  `${payer.name.given_name} ${payer.name.surname}`,
      address: {
        line1:       ship?.address?.address_line_1 || '',
        city:        ship?.address?.admin_area_2   || '',
        state:       ship?.address?.admin_area_1   || '',
        postal_code: ship?.address?.postal_code    || '',
        country:     ship?.address?.country_code   || '',
      }
    };

    console.log('✅ PayPal order captured:', order);
    await sendOrderEmail(order);
    saveOrder(order);

    res.json({ status: 'success', order });
  } catch (err) {
    console.error('PayPal capture error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// ORDER LOG (saves to orders.json locally)
// ============================================================
const fs = require('fs');
function saveOrder(order) {
  const file = path.join(__dirname, 'orders.json');
  let orders = [];
  if (fs.existsSync(file)) {
    try { orders = JSON.parse(fs.readFileSync(file, 'utf8')); } catch(e) {}
  }
  orders.push({ ...order, timestamp: new Date().toISOString() });
  fs.writeFileSync(file, JSON.stringify(orders, null, 2));
}

// ── View orders (protect this in production!) ───────────────
app.get('/admin/orders', (req, res) => {
  const key = req.query.key;
  if (key !== process.env.ADMIN_KEY) return res.status(403).send('Forbidden');
  const file = path.join(__dirname, 'orders.json');
  if (!fs.existsSync(file)) return res.json([]);
  res.json(JSON.parse(fs.readFileSync(file, 'utf8')));
});

// ── Health check ─────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date() }));

// ── Start ────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚗 CARVAULT backend running on port ${PORT}`));
