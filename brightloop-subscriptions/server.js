const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const url = require('node:url');
const crypto = require('node:crypto');
const { getDb, hashPassword, validatePasswordPolicy, seedDatabase } = require('./database');
const { runBillingCycle } = require('./billing_engine');

const PORT = process.env.PORT || 3000;
const sessions = new Map(); // token -> user session

// Initialize and seed database on startup
const db = getDb();
seedDatabase(db);

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  res.end(JSON.stringify(data));
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function getAuthUser(req) {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return null;
  const token = authHeader.replace(/^Bearer\s+/i, '');
  return sessions.get(token) || null;
}

const mimeTypes = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
};

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const method = req.method;

  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    return res.end();
  }

  try {
    // -------------------------------------------------------------
    // API: AUTHENTICATION & RBAC
    // -------------------------------------------------------------
    if (pathname === '/api/auth/register' && method === 'POST') {
      const { email, password, full_name, company_name } = await parseJsonBody(req);
      if (!email || !password || !full_name) {
        return sendJson(res, 400, { error: 'Email, password, and name are required.' });
      }

      // Password policy check: > 8 chars, uppercase, lowercase, special char
      const policy = validatePasswordPolicy(password);
      if (!policy.valid) {
        return sendJson(res, 400, { error: policy.message });
      }

      // Unique email check
      const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase().trim());
      if (existing) {
        return sendJson(res, 400, { error: 'An account with this email already exists.' });
      }

      const stmt = db.prepare(`
        INSERT INTO users (email, password_hash, full_name, company_name, role)
        VALUES (?, ?, ?, ?, 'customer')
      `);
      const result = stmt.run(email.toLowerCase().trim(), hashPassword(password), full_name, company_name || null);
      
      const token = crypto.randomUUID();
      const user = { id: result.lastInsertRowid, email: email.toLowerCase().trim(), full_name, role: 'customer' };
      sessions.set(token, user);

      return sendJson(res, 201, { message: 'Customer account registered successfully', token, user });
    }

    if (pathname === '/api/auth/login' && method === 'POST') {
      const { email, password } = await parseJsonBody(req);
      const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email?.toLowerCase().trim());
      if (!user || user.password_hash !== hashPassword(password || '')) {
        return sendJson(res, 401, { error: 'Invalid email or password.' });
      }

      const token = crypto.randomUUID();
      const safeUser = { id: user.id, email: user.email, full_name: user.full_name, company_name: user.company_name, role: user.role };
      sessions.set(token, safeUser);

      return sendJson(res, 200, { message: 'Logged in successfully', token, user: safeUser });
    }

    if (pathname === '/api/auth/me' && method === 'GET') {
      const user = getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'Unauthorized' });
      return sendJson(res, 200, { user });
    }

    if (pathname === '/api/auth/reset-password' && method === 'POST') {
      const { email, new_password } = await parseJsonBody(req);
      const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email?.toLowerCase().trim());
      if (!user) {
        return sendJson(res, 404, { error: 'User not found with this email address.' });
      }
      if (new_password) {
        const policy = validatePasswordPolicy(new_password);
        if (!policy.valid) return sendJson(res, 400, { error: policy.message });
        db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(new_password), user.id);
        return sendJson(res, 200, { message: 'Password reset successfully. You can now log in.' });
      }
      // Simulate sending reset link
      const resetToken = crypto.randomBytes(20).toString('hex');
      db.prepare('UPDATE users SET reset_token = ? WHERE id = ?').run(resetToken, user.id);
      return sendJson(res, 200, { 
        message: 'Password reset link sent to your registered email.',
        reset_link: `/reset-password?token=${resetToken}&email=${encodeURIComponent(user.email)}`
      });
    }

    // Only the admin can add a new member of staff
    if (pathname === '/api/auth/add-staff' && method === 'POST') {
      const user = getAuthUser(req);
      if (!user || user.role !== 'admin') {
        return sendJson(res, 403, { error: 'Forbidden: Only the admin can add a new member of staff.' });
      }
      const { email, password, full_name, role } = await parseJsonBody(req);
      if (!email || !password || !full_name) {
        return sendJson(res, 400, { error: 'Email, password, and full name are required.' });
      }
      const policy = validatePasswordPolicy(password);
      if (!policy.valid) return sendJson(res, 400, { error: policy.message });

      const targetRole = role === 'admin' ? 'admin' : 'staff';
      try {
        const stmt = db.prepare('INSERT INTO users (email, password_hash, full_name, role) VALUES (?, ?, ?, ?)');
        const result = stmt.run(email.toLowerCase().trim(), hashPassword(password), full_name, targetRole);
        return sendJson(res, 201, { message: `Staff member (${targetRole}) created successfully.`, id: result.lastInsertRowid });
      } catch (err) {
        return sendJson(res, 400, { error: 'Email already exists or error creating staff.' });
      }
    }

    // -------------------------------------------------------------
    // API: PRODUCTS & VARIANTS
    // -------------------------------------------------------------
    if (pathname === '/api/products' && method === 'GET') {
      const products = db.prepare('SELECT * FROM products ORDER BY id DESC').all();
      const variants = db.prepare('SELECT * FROM product_variants').all();
      const variantMap = {};
      for (const v of variants) {
        if (!variantMap[v.product_id]) variantMap[v.product_id] = [];
        variantMap[v.product_id].push(v);
      }
      const result = products.map(p => ({
        ...p,
        variants: variantMap[p.id] || []
      }));
      return sendJson(res, 200, result);
    }

    if (pathname === '/api/products' && method === 'POST') {
      const user = getAuthUser(req);
      if (!user || user.role === 'customer') return sendJson(res, 403, { error: 'Forbidden' });
      const { name, type, sales_price, cost_price, notes, variants } = await parseJsonBody(req);
      if (!name || sales_price == null) return sendJson(res, 400, { error: 'Name and sales price required.' });

      const ins = db.prepare('INSERT INTO products (name, type, sales_price, cost_price, notes) VALUES (?, ?, ?, ?, ?)');
      const resP = ins.run(name, type || 'software', parseFloat(sales_price), parseFloat(cost_price || 0), notes || '');
      const productId = resP.lastInsertRowid;

      if (Array.isArray(variants)) {
        const insV = db.prepare('INSERT INTO product_variants (product_id, variant_name, price_modifier) VALUES (?, ?, ?)');
        for (const v of variants) {
          insV.run(productId, v.variant_name, parseFloat(v.price_modifier || 0));
        }
      }
      return sendJson(res, 201, { message: 'Product created successfully', id: productId });
    }

    // -------------------------------------------------------------
    // API: PLANS
    // -------------------------------------------------------------
    if (pathname === '/api/plans' && method === 'GET') {
      const plans = db.prepare('SELECT * FROM plans ORDER BY id ASC').all();
      return sendJson(res, 200, plans);
    }

    if (pathname === '/api/plans' && method === 'POST') {
      const user = getAuthUser(req);
      if (!user || user.role !== 'admin') return sendJson(res, 403, { error: 'Forbidden: Only admin can create plans.' });
      const p = await parseJsonBody(req);
      const ins = db.prepare(`
        INSERT INTO plans (name, cost, billing_frequency, min_quantity, valid_from, valid_to, auto_close_on_end, can_pause, can_renew, can_close_early)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const resPlan = ins.run(
        p.name, parseFloat(p.cost), p.billing_frequency, parseInt(p.min_quantity || 1),
        p.valid_from || null, p.valid_to || null,
        p.auto_close_on_end ? 1 : 0,
        p.can_pause !== false ? 1 : 0,
        p.can_renew !== false ? 1 : 0,
        p.can_close_early !== false ? 1 : 0
      );
      return sendJson(res, 201, { message: 'Plan created successfully', id: resPlan.lastInsertRowid });
    }

    // -------------------------------------------------------------
    // API: QUOTATION TEMPLATES
    // -------------------------------------------------------------
    if (pathname === '/api/quotation-templates' && method === 'GET') {
      const templates = db.prepare(`
        SELECT qt.*, p.name as plan_name, p.billing_frequency, p.cost as plan_cost
        FROM quotation_templates qt
        LEFT JOIN plans p ON qt.plan_id = p.id
      `).all();
      return sendJson(res, 200, templates);
    }

    // -------------------------------------------------------------
    // API: SUBSCRIPTIONS & QUOTATIONS
    // -------------------------------------------------------------
    if (pathname === '/api/subscriptions' && method === 'GET') {
      const user = getAuthUser(req);
      let query = `
        SELECT s.*, u.full_name as customer_name, u.email as customer_email, u.company_name,
               p.name as plan_name, p.billing_frequency, p.can_pause, p.can_renew, p.can_close_early
        FROM subscriptions s
        JOIN users u ON s.customer_id = u.id
        JOIN plans p ON s.plan_id = p.id
      `;
      let params = [];
      if (user && user.role === 'customer') {
        query += ' WHERE s.customer_id = ?';
        params.push(user.id);
      }
      query += ' ORDER BY s.id DESC';
      const subscriptions = db.prepare(query).all(...params);

      // Attach lines for each
      const getLines = db.prepare(`
        SELECT sl.*, p.name as product_name, pv.variant_name, pv.price_modifier
        FROM subscription_lines sl
        JOIN products p ON sl.product_id = p.id
        LEFT JOIN product_variants pv ON sl.variant_id = pv.id
        WHERE sl.subscription_id = ?
      `);
      const enriched = subscriptions.map(s => ({
        ...s,
        lines: getLines.all(s.id)
      }));

      return sendJson(res, 200, enriched);
    }

    if (pathname === '/api/subscriptions' && method === 'POST') {
      const user = getAuthUser(req);
      if (!user || user.role === 'customer') return sendJson(res, 403, { error: 'Forbidden' });
      const data = await parseJsonBody(req);
      const { customer_id, plan_id, status, start_date, expiry_date, payment_terms, lines } = data;

      if (!customer_id || !plan_id || !lines || lines.length === 0) {
        return sendJson(res, 400, { error: 'Customer, Plan, and product lines are required.' });
      }

      const countSub = db.prepare('SELECT COUNT(*) as cnt FROM subscriptions').get().cnt;
      const subNumber = `SUB-${new Date().getFullYear()}-${(countSub + 1).toString().padStart(4, '0')}`;
      const startDate = start_date || new Date().toISOString().split('T')[0];
      const initialStatus = status || 'Draft';

      const insSub = db.prepare(`
        INSERT INTO subscriptions (sub_number, customer_id, plan_id, status, start_date, next_billing_date, expiry_date, payment_terms, total_amount)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0.0)
      `);
      const subRes = insSub.run(
        subNumber, customer_id, plan_id, initialStatus,
        startDate, startDate, expiry_date || null, payment_terms || 'Net 30'
      );
      const subId = subRes.lastInsertRowid;

      let grandTotal = 0;
      const insLine = db.prepare(`
        INSERT INTO subscription_lines (subscription_id, product_id, variant_id, quantity, unit_price, tax_rule_id, discount_rule_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      for (const l of lines) {
        const prod = db.prepare('SELECT sales_price FROM products WHERE id = ?').get(l.product_id);
        let unitPrice = l.unit_price || prod.sales_price;
        if (l.variant_id) {
          const v = db.prepare('SELECT price_modifier FROM product_variants WHERE id = ?').get(l.variant_id);
          if (v) unitPrice += v.price_modifier;
        }
        const qty = l.quantity || 1;
        grandTotal += unitPrice * qty;
        insLine.run(subId, l.product_id, l.variant_id || null, qty, unitPrice, l.tax_rule_id || 1, l.discount_rule_id || null);
      }

      db.prepare('UPDATE subscriptions SET total_amount = ? WHERE id = ?').run(grandTotal, subId);

      return sendJson(res, 201, { message: 'Subscription/Quotation created successfully', id: subId, sub_number: subNumber });
    }

    // Transition Subscription State
    if (pathname.startsWith('/api/subscriptions/') && pathname.endsWith('/transition') && method === 'POST') {
      const parts = pathname.split('/');
      const subId = parts[3];
      const { new_status } = await parseJsonBody(req);
      const allowed = ['Draft', 'Quotation', 'Confirmed', 'Active', 'Paused', 'Closed'];
      if (!allowed.includes(new_status)) {
        return sendJson(res, 400, { error: 'Invalid subscription status.' });
      }

      const sub = db.prepare('SELECT s.*, p.can_pause, p.can_close_early, p.can_renew FROM subscriptions s JOIN plans p ON s.plan_id = p.id WHERE s.id = ?').get(subId);
      if (!sub) return sendJson(res, 404, { error: 'Subscription not found' });

      // Plan policy validation
      if (new_status === 'Paused' && !sub.can_pause) {
        return sendJson(res, 400, { error: 'This plan does not permit pausing.' });
      }
      if (new_status === 'Closed' && sub.status === 'Active' && !sub.can_close_early) {
        return sendJson(res, 400, { error: 'This plan does not permit early closure.' });
      }

      db.prepare('UPDATE subscriptions SET status = ? WHERE id = ?').run(new_status, subId);
      return sendJson(res, 200, { message: `Subscription moved to ${new_status}`, sub_id: subId, status: new_status });
    }

    // -------------------------------------------------------------
    // API: BILLING DAY & INVOICES
    // -------------------------------------------------------------
    if (pathname === '/api/billing/run' && method === 'POST') {
      const user = getAuthUser(req);
      if (!user || user.role === 'customer') return sendJson(res, 403, { error: 'Forbidden' });
      const { target_date } = await parseJsonBody(req);
      const cycleResult = runBillingCycle(target_date);
      return sendJson(res, 200, { message: 'Billing cycle executed successfully', ...cycleResult });
    }

    if (pathname === '/api/invoices' && method === 'GET') {
      const user = getAuthUser(req);
      let query = `
        SELECT i.*, u.full_name as customer_name, u.email as customer_email, u.company_name,
               s.sub_number,
               CASE WHEN i.status != 'Paid' AND i.due_date < date('now') THEN 1 ELSE 0 END as is_overdue
        FROM invoices i
        JOIN users u ON i.customer_id = u.id
        LEFT JOIN subscriptions s ON i.subscription_id = s.id
      `;
      let params = [];
      if (user && user.role === 'customer') {
        query += ' WHERE i.customer_id = ?';
        params.push(user.id);
      }
      query += ' ORDER BY i.id DESC';
      const invoices = db.prepare(query).all(...params);
      return sendJson(res, 200, invoices);
    }

    if (pathname.startsWith('/api/invoices/') && method === 'GET') {
      const id = pathname.split('/')[3];
      const inv = db.prepare(`
        SELECT i.*, u.full_name as customer_name, u.email as customer_email, u.company_name, s.sub_number,
               CASE WHEN i.status != 'Paid' AND i.due_date < date('now') THEN 1 ELSE 0 END as is_overdue
        FROM invoices i
        JOIN users u ON i.customer_id = u.id
        LEFT JOIN subscriptions s ON i.subscription_id = s.id
        WHERE i.id = ?
      `).get(id);

      if (!inv) return sendJson(res, 404, { error: 'Invoice not found' });
      const lines = db.prepare('SELECT * FROM invoice_lines WHERE invoice_id = ?').all(id);
      const payments = db.prepare('SELECT * FROM payments WHERE invoice_id = ?').all(id);
      return sendJson(res, 200, { invoice: inv, lines, payments });
    }

    if (pathname.startsWith('/api/invoices/') && pathname.endsWith('/confirm') && method === 'POST') {
      const id = pathname.split('/')[3];
      db.prepare("UPDATE invoices SET status = 'Confirmed' WHERE id = ? AND status = 'Draft'").run(id);
      return sendJson(res, 200, { message: 'Invoice confirmed and issued.' });
    }

    if (pathname.startsWith('/api/invoices/') && pathname.endsWith('/cancel') && method === 'POST') {
      const id = pathname.split('/')[3];
      db.prepare("UPDATE invoices SET status = 'Cancelled' WHERE id = ?").run(id);
      return sendJson(res, 200, { message: 'Invoice cancelled.' });
    }

    // -------------------------------------------------------------
    // API: PAYMENTS
    // -------------------------------------------------------------
    if (pathname === '/api/payments' && method === 'POST') {
      const user = getAuthUser(req);
      const { invoice_id, amount, method: payMethod, payment_date, note } = await parseJsonBody(req);
      if (!invoice_id || !amount || !payMethod) {
        return sendJson(res, 400, { error: 'Invoice ID, amount, and payment method are required.' });
      }

      const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoice_id);
      if (!inv) return sendJson(res, 404, { error: 'Invoice not found' });
      if (inv.status === 'Cancelled') return sendJson(res, 400, { error: 'Cannot pay a cancelled invoice.' });

      const countP = db.prepare('SELECT COUNT(*) as cnt FROM payments').get().cnt;
      const payNumber = `PAY-${new Date().getFullYear()}-${(countP + 1).toString().padStart(4, '0')}`;
      const payDate = payment_date || new Date().toISOString().split('T')[0];

      const insPay = db.prepare(`
        INSERT INTO payments (payment_number, invoice_id, amount, method, payment_date, note, recorded_by_user_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      insPay.run(payNumber, invoice_id, parseFloat(amount), payMethod, payDate, note || '', user?.id || null);

      // Update invoice amount_paid & status
      const newPaid = parseFloat((inv.amount_paid + parseFloat(amount)).toFixed(2));
      let newStatus = inv.status;
      if (newPaid >= inv.grand_total) {
        newStatus = 'Paid';
      } else if (newPaid > 0 && inv.status === 'Draft') {
        newStatus = 'Confirmed';
      }

      db.prepare('UPDATE invoices SET amount_paid = ?, status = ? WHERE id = ?').run(newPaid, newStatus, invoice_id);

      return sendJson(res, 201, { message: 'Payment recorded successfully', payment_number: payNumber, new_amount_paid: newPaid, status: newStatus });
    }

    // -------------------------------------------------------------
    // API: DISCOUNTS & TAXES (Admin controls)
    // -------------------------------------------------------------
    if (pathname === '/api/discounts' && method === 'GET') {
      const discounts = db.prepare('SELECT * FROM discount_rules ORDER BY id DESC').all();
      return sendJson(res, 200, discounts);
    }

    if (pathname === '/api/discounts' && method === 'POST') {
      const user = getAuthUser(req);
      if (!user || user.role !== 'admin') {
        return sendJson(res, 403, { error: 'Forbidden: Only the admin can create discount rules.' });
      }
      const d = await parseJsonBody(req);
      const ins = db.prepare(`
        INSERT INTO discount_rules (code, name, type, value, min_purchase_amount, min_quantity, start_date, end_date, max_uses, applicable_product_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const resD = ins.run(
        d.code.toUpperCase(), d.name, d.type, parseFloat(d.value),
        parseFloat(d.min_purchase_amount || 0), parseInt(d.min_quantity || 0),
        d.start_date || null, d.end_date || null, parseInt(d.max_uses || 0),
        d.applicable_product_id || null
      );
      return sendJson(res, 201, { message: 'Discount rule created successfully', id: resD.lastInsertRowid });
    }

    if (pathname === '/api/taxes' && method === 'GET') {
      const taxes = db.prepare('SELECT * FROM tax_rules').all();
      return sendJson(res, 200, taxes);
    }

    if (pathname === '/api/taxes' && method === 'POST') {
      const user = getAuthUser(req);
      if (!user || user.role !== 'admin') return sendJson(res, 403, { error: 'Forbidden: Only admin can create tax rules.' });
      const { name, rate_percentage } = await parseJsonBody(req);
      const ins = db.prepare('INSERT INTO tax_rules (name, rate_percentage) VALUES (?, ?)');
      const resT = ins.run(name, parseFloat(rate_percentage));
      return sendJson(res, 201, { message: 'Tax rule created', id: resT.lastInsertRowid });
    }

    // -------------------------------------------------------------
    // API: FINANCE LEAD ANALYTICS & DASHBOARD (< 2s Response SLA)
    // -------------------------------------------------------------
    if (pathname === '/api/analytics/dashboard' && method === 'GET') {
      const startTime = performance.now();

      // 1. Active Subscriptions
      const activeSubsRow = db.prepare("SELECT COUNT(*) as count, COALESCE(SUM(total_amount), 0) as total_value FROM subscriptions WHERE status = 'Active'").get();

      // 2. Revenue Collected (All Paid / partially paid sums)
      const collectedRow = db.prepare("SELECT COALESCE(SUM(amount), 0) as total_collected FROM payments").get();

      // 3. Outstanding / Owed on Confirmed Invoices
      const outstandingRow = db.prepare(`
        SELECT COALESCE(SUM(grand_total - amount_paid), 0) as total_outstanding, COUNT(*) as invoice_count
        FROM invoices 
        WHERE status IN ('Draft', 'Confirmed') AND grand_total > amount_paid
      `).get();

      // 4. Overdue Invoices
      const overdueRow = db.prepare(`
        SELECT COUNT(*) as overdue_count, COALESCE(SUM(grand_total - amount_paid), 0) as overdue_amount
        FROM invoices
        WHERE status != 'Paid' AND status != 'Cancelled' AND due_date < date('now')
      `).get();

      // 5. Overdue Detailed Chase List
      const overdueList = db.prepare(`
        SELECT i.id, i.invoice_number, i.due_date, i.grand_total, i.amount_paid,
               (i.grand_total - i.amount_paid) as balance_due,
               u.full_name as customer_name, u.company_name, u.email as customer_email,
               CAST((julianday('now') - julianday(i.due_date)) AS INTEGER) as days_overdue
        FROM invoices i
        JOIN users u ON i.customer_id = u.id
        WHERE i.status != 'Paid' AND i.status != 'Cancelled' AND i.due_date < date('now')
        ORDER BY i.due_date ASC
        LIMIT 50
      `).all();

      // 6. Subscriptions by status breakdown
      const statusBreakdown = db.prepare('SELECT status, COUNT(*) as count FROM subscriptions GROUP BY status').all();

      // 7. Recent Invoices
      const recentInvoices = db.prepare(`
        SELECT i.*, u.full_name as customer_name, u.company_name
        FROM invoices i
        JOIN users u ON i.customer_id = u.id
        ORDER BY i.id DESC
        LIMIT 10
      `).all();

      const durationMs = (performance.now() - startTime).toFixed(2);

      return sendJson(res, 200, {
        active_subscriptions_count: activeSubsRow.count,
        active_subscriptions_value: activeSubsRow.total_value,
        total_revenue_collected: collectedRow.total_collected,
        total_outstanding_owed: outstandingRow.total_outstanding,
        overdue_invoices_count: overdueRow.overdue_count,
        overdue_invoices_amount: overdueRow.overdue_amount,
        overdue_chase_list: overdueList,
        subscriptions_by_status: statusBreakdown,
        recent_invoices: recentInvoices,
        performance_sla: {
          execution_time_ms: `${durationMs}ms`,
          under_two_seconds: parseFloat(durationMs) < 2000
        }
      });
    }

    // -------------------------------------------------------------
    // STATIC FILE SERVING (PUBLIC SPA)
    // -------------------------------------------------------------
    let filePath = path.join(__dirname, 'public', pathname === '/' ? 'index.html' : pathname);
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(__dirname, 'public', 'index.html');
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, content) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404 Not Found');
      } else {
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content, 'utf-8');
      }
    });

  } catch (error) {
    console.error('Server error:', error);
    sendJson(res, 500, { error: error.message || 'Internal Server Error' });
  }
});

server.listen(PORT, () => {
  console.log(`Brightloop Subscription Management Server listening on port ${PORT}`);
});

module.exports = { server, db };

