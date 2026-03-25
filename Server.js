// ============================================================
// CARVAULT BACKEND — server.js
// Stripe Embedded + PayPal + Full customer address collection
// Order emails to you + customer confirmation
// ============================================================
require('dotenv').config();

const express    = require('express');
const stripe     = require('stripe')(process.env.STRIPE_SECRET_KEY);
const paypal     = require('@paypal/checkout-server-sdk');
const nodemailer = require('nodemailer');
const cors       = require('cors');
const path       = require('path');
const fs         = require('fs');

const app = express();

// CORS — allow your Firebase + custom domain
app.use(cors({
  origin: [
    'http://localhost:5000',
    'http://localhost:3000',
    'https://carvault.web.app',
    'https://carvault.firebaseapp.com',
    'https://carvault.com',
    'https://www.carvault.com',
  ]
}));

app.use('/webhook/stripe', express.raw({ type: 'application/json' }));
app.use(express.json());

// ── PAYPAL ───────────────────────────────────────────────────
function paypalClient() {
  const isLive = process.env.NODE_ENV === 'production';
  const env = isLive
    ? new paypal.core.LiveEnvironment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_CLIENT_SECRET)
    : new paypal.core.SandboxEnvironment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_CLIENT_SECRET);
  return new paypal.core.PayPalHttpClient(env);
}

// ── EMAIL ────────────────────────────────────────────────────
const mailer = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.EMAIL_FROM, pass: process.env.EMAIL_PASSWORD }
});

function genOrderId() {
  return 'CV-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2,5).toUpperCase();
}

function saveOrder(order) {
  const file = path.join(__dirname, 'orders.json');
  let orders = [];
  try { if (fs.existsSync(file)) orders = JSON.parse(fs.readFileSync(file,'utf8')); } catch(e){}
  orders.unshift(order);
  fs.writeFileSync(file, JSON.stringify(orders, null, 2));
}

async function sendOrderEmail(order) {
  const addr = [order.address.line1, order.address.line2, order.address.city,
    order.address.state, order.address.postal_code, order.address.country].filter(Boolean).join(', ');

  // Email to YOU
  await mailer.sendMail({
    from: process.env.EMAIL_FROM,
    to: process.env.EMAIL_OWNER,
    subject: `New CARVAULT Order #${order.orderId} — ${order.color} — $${order.amount}`,
    html: `<div style="font-family:sans-serif;max-width:600px">
      <h2 style="color:#3399ff">New Order — Ship Now</h2>
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="padding:8px;background:#f5f5f5;width:140px"><b>Order ID</b></td><td style="padding:8px">#${order.orderId}</td></tr>
        <tr><td style="padding:8px"><b>Product</b></td><td style="padding:8px">CARVAULT Seat Organizer — ${order.color}</td></tr>
        <tr><td style="padding:8px;background:#f5f5f5"><b>Quantity</b></td><td style="padding:8px;background:#f5f5f5">${order.qty}</td></tr>
        <tr><td style="padding:8px"><b>Amount</b></td><td style="padding:8px;color:#3399ff;font-size:18px"><b>$${order.amount}</b></td></tr>
        <tr><td style="padding:8px;background:#f5f5f5"><b>Payment</b></td><td style="padding:8px;background:#f5f5f5">${order.paymentMethod}</td></tr>
        <tr><td style="padding:8px"><b>Name</b></td><td style="padding:8px">${order.customerName}</td></tr>
        <tr><td style="padding:8px;background:#f5f5f5"><b>Email</b></td><td style="padding:8px;background:#f5f5f5">${order.customerEmail}</td></tr>
        <tr><td style="padding:8px"><b>Phone</b></td><td style="padding:8px">${order.customerPhone || '—'}</td></tr>
        <tr><td style="padding:8px;background:#f5f5f5"><b>Ship To</b></td><td style="padding:8px;background:#f5f5f5">${addr}</td></tr>
      </table>
      <div style="background:#e8f5e9;border-radius:8px;padding:16px;margin-top:20px">
        <b>👉 Place on AliExpress:</b><br>
        <a href="https://www.aliexpress.com/item/YOUR_PRODUCT_ID.html">Click here to order</a><br>
        <small>Ship to: ${addr}</small>
      </div>
      <p style="color:#999;font-size:12px;margin-top:16px">Order time: ${order.timestamp}</p>
    </div>`
  });

  // Confirmation to customer
  await mailer.sendMail({
    from: `"CARVAULT" <${process.env.EMAIL_FROM}>`,
    to: order.customerEmail,
    subject: `Order Confirmed — CARVAULT #${order.orderId}`,
    html: `<div style="font-family:sans-serif;max-width:560px;margin:0 auto">
      <div style="background:#0a0f10;padding:24px;text-align:center">
        <h1 style="color:#ede9e2;font-size:22px;margin:0;letter-spacing:.2em">CAR<span style="color:#3399ff">VAULT</span></h1>
      </div>
      <div style="padding:32px;background:#fff">
        <h2 style="color:#111">Order Confirmed ✓</h2>
        <p style="color:#555">Hi ${order.customerName}, your order is confirmed and being processed.</p>
        <table style="width:100%;border-collapse:collapse;margin:20px 0;background:#f8f8f8;border-radius:8px;overflow:hidden">
          <tr><td style="padding:10px 16px;color:#555">Product</td><td style="padding:10px 16px">CARVAULT Seat Organizer — ${order.color}</td></tr>
          <tr style="background:#f0f0f0"><td style="padding:10px 16px;color:#555">Quantity</td><td style="padding:10px 16px">${order.qty}</td></tr>
          <tr><td style="padding:10px 16px;color:#555">Total</td><td style="padding:10px 16px;font-weight:bold;color:#3399ff;font-size:16px">$${order.amount}</td></tr>
          <tr style="background:#f0f0f0"><td style="padding:10px 16px;color:#555">Order ID</td><td style="padding:10px 16px">#${order.orderId}</td></tr>
          <tr><td style="padding:10px 16px;color:#555">Ship To</td><td style="padding:10px 16px">${addr}</td></tr>
        </table>
        <div style="background:#e8f0fe;border-radius:8px;padding:16px;margin:20px 0">
          <b style="color:#3399ff">Estimated Delivery: 7–14 business days</b><br>
          <small style="color:#555">You will receive a tracking number once shipped.</small>
        </div>
        <p style="color:#999;font-size:12px">Questions? Reply to this email anytime.</p>
      </div>
      <div style="background:#f5f5f5;padding:16px;text-align:center">
        <p style="color:#999;font-size:11px;margin:0">CARVAULT · carvault.com</p>
      </div>
    </div>`
  });
}

// ════════════════════════════════════════════════════════════
// STRIPE
// ════════════════════════════════════════════════════════════
app.post('/api/stripe/create-payment-intent', async (req, res) => {
  try {
    const { color, qty } = req.body;
    const pi = await stripe.paymentIntents.create({
      amount: 1900 * (parseInt(qty) || 1),
      currency: 'usd',
      automatic_payment_methods: { enabled: true },
      metadata: { color, qty: String(qty || 1) },
    });
    res.json({ clientSecret: pi.client_secret });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/webhook/stripe', async (req, res) => {
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'payment_intent.succeeded') {
    const pi = event.data.object;
    const ship = pi.shipping;
    const order = {
      orderId: genOrderId(), paymentId: pi.id, paymentMethod: 'stripe',
      color: pi.metadata.color || '—', qty: pi.metadata.qty || '1',
      amount: (pi.amount/100).toFixed(2),
      customerEmail: pi.receipt_email || '', customerName: ship?.name || 'Customer', customerPhone: '',
      address: { line1: ship?.address?.line1||'', line2: ship?.address?.line2||'',
        city: ship?.address?.city||'', state: ship?.address?.state||'',
        postal_code: ship?.address?.postal_code||'', country: ship?.address?.country||'US' },
      timestamp: new Date().toISOString()
    };
    saveOrder(order); await sendOrderEmail(order);
  }
  res.json({ received: true });
});

// ════════════════════════════════════════════════════════════
// PAYPAL
// ════════════════════════════════════════════════════════════
app.post('/api/paypal/create-order', async (req, res) => {
  try {
    const { color, qty } = req.body;
    const total = (19 * (parseInt(qty)||1)).toFixed(2);
    const request = new paypal.orders.OrdersCreateRequest();
    request.prefer('return=representation');
    request.requestBody({
      intent: 'CAPTURE',
      purchase_units: [{ amount: { currency_code:'USD', value:total,
        breakdown:{item_total:{currency_code:'USD',value:total}} },
        items:[{name:`CARVAULT Seat Organizer — ${color}`,unit_amount:{currency_code:'USD',value:'19.00'},quantity:String(qty||1),category:'PHYSICAL_GOODS'}]
      }],
      application_context: { brand_name:'CARVAULT', shipping_preference:'GET_FROM_FILE',
        user_action:'PAY_NOW', return_url:`${process.env.FRONTEND_URL}/?payment=success`,
        cancel_url:`${process.env.FRONTEND_URL}/` }
    });
    const o = await paypalClient().execute(request);
    res.json({ id: o.result.id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/paypal/capture-order', async (req, res) => {
  try {
    const { orderID, color, qty } = req.body;
    const req2 = new paypal.orders.OrdersCaptureRequest(orderID);
    req2.requestBody({});
    const cap   = await paypalClient().execute(req2);
    const r     = cap.result;
    const ship  = r.purchase_units[0].shipping;
    const order = {
      orderId: genOrderId(), paymentId: r.id, paymentMethod: 'paypal',
      color: color||'—', qty: String(qty||1),
      amount: r.purchase_units[0].payments.captures[0].amount.value,
      customerEmail: r.payer.email_address||'', customerName: ship?.name||`${r.payer.name.given_name} ${r.payer.name.surname}`, customerPhone:'',
      address:{ line1:ship?.address?.address_line_1||'', line2:ship?.address?.address_line_2||'',
        city:ship?.address?.admin_area_2||'', state:ship?.address?.admin_area_1||'',
        postal_code:ship?.address?.postal_code||'', country:ship?.address?.country_code||'US' },
      timestamp: new Date().toISOString()
    };
    saveOrder(order); await sendOrderEmail(order);
    res.json({ status:'success', orderId:order.orderId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── ADMIN ─────────────────────────────────────────────────────
app.get('/admin/orders', (req, res) => {
  if (req.query.key !== process.env.ADMIN_KEY) return res.status(403).json({ error:'Forbidden' });
  const file = path.join(__dirname,'orders.json');
  if (!fs.existsSync(file)) return res.json({ count:0, total:'0.00', orders:[] });
  const orders = JSON.parse(fs.readFileSync(file,'utf8'));
  res.json({ count:orders.length, total:orders.reduce((s,o)=>s+parseFloat(o.amount||0),0).toFixed(2), orders });
});

app.get('/health', (_,res) => res.json({ status:'ok', time:new Date().toISOString() }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`CARVAULT backend on :${PORT}`));
