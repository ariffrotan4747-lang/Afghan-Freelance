import express, { Request, Response } from 'express';
import path from 'path';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// In-memory runtime state for demo/server ledger & idempotency
interface PaymentSession {
  sessionId: string;
  orderId: string;
  orderNumber: string;
  amount: number;
  currency: 'AFN' | 'USD';
  serviceTitle: string;
  clientEmail: string;
  status: 'pending' | 'paid' | 'failed' | 'cancelled';
  createdAt: string;
  paymentUrl: string;
  isSandbox: boolean;
}

const paymentSessions = new Map<string, PaymentSession>();
const processedWebhookEventIds = new Set<string>();

// Platform dynamic settings
let platformSettings = {
  commissionPercent: 10,
  exchangeRateAfnPerUsd: 70.5,
  demoMode: true,
  minWithdrawalAfn: 1000,
  minWithdrawalUsd: 15,
  maintenanceMode: false,
};

const adminContactInbox: Array<{
  id: string;
  name: string;
  email: string;
  subject: string;
  message: string;
  createdAt: string;
  status: 'unread' | 'read' | 'replied';
}> = [];

// ==========================================
// 1. Health & System Diagnostic API
// ==========================================
app.get('/api/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'Afghan Freelance Core Backend',
    version: '1.0.0',
  });
});

app.get('/api/system-status', (req: Request, res: Response) => {
  const hasHesabKey = Boolean(process.env.HESABPAY_API_KEY && process.env.HESABPAY_API_KEY.length > 5);
  const hesabUrl = process.env.HESABPAY_API_URL || 'https://api-sandbox.hesab.com';
  const hasFirebaseProject = Boolean(process.env.FIREBASE_PROJECT_ID);

  res.json({
    backend: {
      status: 'operational',
      uptime: process.uptime(),
      port: PORT,
      nodeVersion: process.version,
    },
    hesabpay: {
      isConfigured: hasHesabKey,
      apiUrl: hesabUrl,
      mode: hasHesabKey ? (hesabUrl.includes('sandbox') ? 'Official Sandbox' : 'Official Production') : 'Demo Mode (Simulation Ready)',
      hasWebhookSecret: Boolean(process.env.HESABPAY_WEBHOOK_SECRET),
    },
    firebase: {
      isConfigured: hasFirebaseProject,
      projectId: process.env.FIREBASE_PROJECT_ID || 'afghan-freelance-default',
    },
    settings: platformSettings,
    metrics: {
      activeSessions: paymentSessions.size,
      inboxCount: adminContactInbox.length,
    },
  });
});

// ==========================================
// 2. Settings & Exchange Rate API
// ==========================================
app.get('/api/settings', (req: Request, res: Response) => {
  res.json(platformSettings);
});

app.post('/api/settings', (req: Request, res: Response) => {
  const { commissionPercent, exchangeRateAfnPerUsd, demoMode, maintenanceMode } = req.body;
  if (typeof commissionPercent === 'number' && commissionPercent >= 0 && commissionPercent <= 50) {
    platformSettings.commissionPercent = commissionPercent;
  }
  if (typeof exchangeRateAfnPerUsd === 'number' && exchangeRateAfnPerUsd > 0) {
    platformSettings.exchangeRateAfnPerUsd = exchangeRateAfnPerUsd;
  }
  if (typeof demoMode === 'boolean') {
    platformSettings.demoMode = demoMode;
  }
  if (typeof maintenanceMode === 'boolean') {
    platformSettings.maintenanceMode = maintenanceMode;
  }
  res.json({ success: true, settings: platformSettings });
});

// ==========================================
// 3. Official HesabPay Integration Endpoints
// ==========================================
/**
 * Create Payment Session
 * Endpoint: POST /api/payments/hesabpay/create-session
 */
app.post('/api/payments/hesabpay/create-session', async (req: Request, res: Response) => {
  try {
    const { orderId, orderNumber, amount, currency, serviceTitle, clientEmail, clientName } = req.body;

    if (!orderId || !amount || !currency) {
      return res.status(400).json({ error: 'Missing required order fields: orderId, amount, currency' });
    }

    const sessionId = `hesab_sess_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const apiKey = process.env.HESABPAY_API_KEY;
    const apiUrl = process.env.HESABPAY_API_URL || 'https://api-sandbox.hesab.com';
    const baseUrl = process.env.APP_URL || `http://localhost:${PORT}`;

    const successUrl = `${baseUrl}/orders?status=success&session_id=${sessionId}&order_id=${orderId}`;
    const failureUrl = `${baseUrl}/orders?status=failed&session_id=${sessionId}&order_id=${orderId}`;

    let checkoutUrl = '';
    let isLiveApiSuccess = false;

    // If real API key is configured, call official HesabPay endpoint
    if (apiKey && !platformSettings.demoMode) {
      try {
        const response = await fetch(`${apiUrl}/api/v1/payment/create-session`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            'Accept': 'application/json',
          },
          body: JSON.stringify({
            amount: Number(amount),
            currency: currency === 'USD' ? 'USD' : 'AFN',
            order_id: orderId,
            description: `Afghan Freelance: ${serviceTitle || 'Service Order'}`,
            success_url: successUrl,
            cancel_url: failureUrl,
            client_reference_id: sessionId,
            customer_email: clientEmail || 'client@afghanfreelance.org',
            customer_name: clientName || 'Afghan Freelance Client',
          }),
        });

        if (response.ok) {
          const data = await response.json();
          checkoutUrl = data.payment_url || data.checkout_url || data.url;
          isLiveApiSuccess = true;
        } else {
          console.warn('HesabPay Live API call failed, falling back to sandbox demo session:', response.status);
        }
      } catch (apiErr) {
        console.warn('HesabPay connection error, using sandbox fallback:', apiErr);
      }
    }

    // Fallback: Hosted Sandbox Checkout within app
    if (!checkoutUrl) {
      checkoutUrl = `${baseUrl}/orders?checkout_mode=hesabpay_hosted&session_id=${sessionId}&order_id=${orderId}&amount=${amount}&currency=${currency}&title=${encodeURIComponent(serviceTitle || 'Service')}`;
    }

    const sessionData: PaymentSession = {
      sessionId,
      orderId,
      orderNumber: orderNumber || `AF-${Date.now().toString().slice(-6)}`,
      amount: Number(amount),
      currency: currency === 'USD' ? 'USD' : 'AFN',
      serviceTitle: serviceTitle || 'Order',
      clientEmail: clientEmail || '',
      status: 'pending',
      createdAt: new Date().toISOString(),
      paymentUrl: checkoutUrl,
      isSandbox: !isLiveApiSuccess,
    };

    paymentSessions.set(sessionId, sessionData);

    return res.json({
      success: true,
      sessionId,
      paymentUrl: checkoutUrl,
      isSandbox: sessionData.isSandbox,
      commissionPercent: platformSettings.commissionPercent,
    });
  } catch (error: any) {
    console.error('Error creating HesabPay session:', error);
    res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
});

/**
 * HesabPay Official Webhook Handler
 * Endpoint: POST /api/payments/hesabpay/webhook
 */
app.post('/api/payments/hesabpay/webhook', (req: Request, res: Response) => {
  try {
    const signature = req.headers['x-hesabpay-signature'] || req.headers['x-signature'];
    const webhookSecret = process.env.HESABPAY_WEBHOOK_SECRET;

    // Optional cryptographic signature check when secret is configured
    if (webhookSecret && signature) {
      const hmac = crypto.createHmac('sha256', webhookSecret);
      const computedSignature = hmac.update(JSON.stringify(req.body)).digest('hex');
      if (computedSignature !== signature) {
        return res.status(401).json({ error: 'Invalid Webhook Signature' });
      }
    }

    const eventId = req.body.event_id || req.body.id || `evt_${Date.now()}`;
    if (processedWebhookEventIds.has(eventId)) {
      return res.json({ received: true, message: 'Event already processed (Idempotent)' });
    }
    processedWebhookEventIds.add(eventId);

    const { session_id, order_id, status } = req.body;
    const session = paymentSessions.get(session_id);

    if (session) {
      if (status === 'completed' || status === 'paid' || status === 'success') {
        session.status = 'paid';
      } else if (status === 'failed') {
        session.status = 'failed';
      }
    }

    res.json({ received: true, orderId: order_id, sessionStatus: session?.status || 'processed' });
  } catch (err: any) {
    console.error('Webhook error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Verify / Fetch Payment Session Status
 */
app.get('/api/payments/hesabpay/status/:sessionId', (req: Request, res: Response) => {
  const { sessionId } = req.params;
  const session = paymentSessions.get(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  res.json(session);
});

/**
 * Simulation Endpoint for Demo Mode
 */
app.post('/api/payments/simulate-success', (req: Request, res: Response) => {
  const { sessionId, orderId } = req.body;
  const session = paymentSessions.get(sessionId);
  if (session) {
    session.status = 'paid';
  }
  res.json({
    success: true,
    message: 'Payment verified and confirmed via HesabPay simulation gateway.',
    orderId,
    status: 'paid',
  });
});

// ==========================================
// 4. Contact Form / Admin Inbox
// ==========================================
app.post('/api/contact', (req: Request, res: Response) => {
  const { name, email, subject, message } = req.body;
  if (!name || !email || !message) {
    return res.status(400).json({ error: 'Name, email, and message are required.' });
  }

  const newEntry = {
    id: `msg_${Date.now()}`,
    name,
    email,
    subject: subject || 'General Inquiry',
    message,
    createdAt: new Date().toISOString(),
    status: 'unread' as const,
  };

  adminContactInbox.unshift(newEntry);
  res.json({ success: true, message: 'Message received by Afghan Freelance team', entryId: newEntry.id });
});

app.get('/api/contact', (req: Request, res: Response) => {
  res.json({ entries: adminContactInbox });
});

// ==========================================
// 5. Vite Middleware & Asset Serving
// ==========================================
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Afghan Freelance] Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
