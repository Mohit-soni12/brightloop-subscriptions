const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');
const path = require('node:path');

const DB_PATH = path.join(__dirname, 'brightloop.db');
let dbInstance = null;

function getDb() {
  if (!dbInstance) {
    dbInstance = new DatabaseSync(DB_PATH);
    dbInstance.exec('PRAGMA foreign_keys = ON;');
    dbInstance.exec('PRAGMA journal_mode = WAL;');
    initSchema(dbInstance);
  }
  return dbInstance;
}

function hashPassword(password) {
  const salt = 'brightloop_salt_2026';
  return crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
}

function validatePasswordPolicy(password) {
  // Requirement: more than eight characters (> 8), uppercase, lowercase, special character
  if (!password || password.length <= 8) {
    return { valid: false, message: 'Password must be more than 8 characters long.' };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one uppercase letter.' };
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one lowercase letter.' };
  }
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one special character.' };
  }
  return { valid: true };
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      company_name TEXT,
      role TEXT NOT NULL CHECK(role IN ('admin', 'staff', 'customer')),
      reset_token TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      sales_price REAL NOT NULL,
      cost_price REAL NOT NULL,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS product_variants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      variant_name TEXT NOT NULL,
      price_modifier REAL NOT NULL DEFAULT 0.0
    );

    CREATE TABLE IF NOT EXISTS plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      cost REAL NOT NULL,
      billing_frequency TEXT NOT NULL CHECK(billing_frequency IN ('daily', 'weekly', 'monthly', 'yearly')),
      min_quantity INTEGER NOT NULL DEFAULT 1,
      valid_from DATE,
      valid_to DATE,
      auto_close_on_end INTEGER DEFAULT 0,
      can_pause INTEGER DEFAULT 1,
      can_renew INTEGER DEFAULT 1,
      can_close_early INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS quotation_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      plan_id INTEGER REFERENCES plans(id),
      validity_days INTEGER NOT NULL DEFAULT 30,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS quotation_template_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER NOT NULL REFERENCES quotation_templates(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id),
      variant_id INTEGER REFERENCES product_variants(id),
      quantity INTEGER NOT NULL DEFAULT 1,
      unit_price REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tax_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      rate_percentage REAL NOT NULL,
      is_active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS discount_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('percentage', 'fixed')),
      value REAL NOT NULL,
      min_purchase_amount REAL DEFAULT 0.0,
      min_quantity INTEGER DEFAULT 0,
      start_date DATE,
      end_date DATE,
      max_uses INTEGER DEFAULT 0,
      current_uses INTEGER DEFAULT 0,
      applicable_product_id INTEGER REFERENCES products(id),
      is_active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sub_number TEXT UNIQUE NOT NULL,
      customer_id INTEGER NOT NULL REFERENCES users(id),
      plan_id INTEGER NOT NULL REFERENCES plans(id),
      status TEXT NOT NULL CHECK(status IN ('Draft', 'Quotation', 'Confirmed', 'Active', 'Paused', 'Closed')),
      start_date DATE NOT NULL,
      next_billing_date DATE NOT NULL,
      expiry_date DATE,
      payment_terms TEXT DEFAULT 'Net 30',
      total_amount REAL DEFAULT 0.0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS subscription_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subscription_id INTEGER NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id),
      variant_id INTEGER REFERENCES product_variants(id),
      quantity INTEGER NOT NULL DEFAULT 1,
      unit_price REAL NOT NULL,
      tax_rule_id INTEGER REFERENCES tax_rules(id),
      discount_rule_id INTEGER REFERENCES discount_rules(id)
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_number TEXT UNIQUE NOT NULL,
      subscription_id INTEGER REFERENCES subscriptions(id),
      customer_id INTEGER NOT NULL REFERENCES users(id),
      billing_period_start DATE NOT NULL,
      billing_period_end DATE NOT NULL,
      issue_date DATE NOT NULL,
      due_date DATE NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('Draft', 'Confirmed', 'Paid', 'Cancelled')),
      subtotal REAL NOT NULL DEFAULT 0.0,
      tax_total REAL NOT NULL DEFAULT 0.0,
      discount_total REAL NOT NULL DEFAULT 0.0,
      grand_total REAL NOT NULL DEFAULT 0.0,
      amount_paid REAL NOT NULL DEFAULT 0.0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(subscription_id, billing_period_start, billing_period_end)
    );

    CREATE TABLE IF NOT EXISTS invoice_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id),
      product_name TEXT NOT NULL,
      variant_name TEXT,
      quantity INTEGER NOT NULL,
      unit_price REAL NOT NULL,
      tax_amount REAL NOT NULL DEFAULT 0.0,
      discount_amount REAL NOT NULL DEFAULT 0.0,
      line_total REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payment_number TEXT UNIQUE NOT NULL,
      invoice_id INTEGER NOT NULL REFERENCES invoices(id),
      amount REAL NOT NULL,
      method TEXT NOT NULL,
      payment_date DATE NOT NULL,
      note TEXT,
      recorded_by_user_id INTEGER REFERENCES users(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- High-Performance Indexes for SLA (< 2 seconds)
    CREATE INDEX IF NOT EXISTS idx_subs_status_billing ON subscriptions(status, next_billing_date);
    CREATE INDEX IF NOT EXISTS idx_subs_customer ON subscriptions(customer_id);
    CREATE INDEX IF NOT EXISTS idx_invoices_status_due ON invoices(status, due_date);
    CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(customer_id);
    CREATE INDEX IF NOT EXISTS idx_invoices_sub ON invoices(subscription_id);
    CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
  `);
}

function seedDatabase(db) {
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  if (userCount > 0) return; // Already seeded

  // 1. Users
  const insertUser = db.prepare(`
    INSERT INTO users (email, password_hash, full_name, company_name, role)
    VALUES (?, ?, ?, ?, ?)
  `);

  insertUser.run('admin@brightloop.com', hashPassword('Admin@12345'), 'Alex Vance (Admin)', 'Brightloop HQ', 'admin');
  insertUser.run('staff@brightloop.com', hashPassword('Staff@12345'), 'Sarah Jenkins (Sales Rep)', 'Brightloop HQ', 'staff');
  insertUser.run('finance@brightloop.com', hashPassword('Finance@12345'), 'David Miller (Finance Lead)', 'Brightloop HQ', 'staff');
  
  // Customers
  insertUser.run('john@acme.com', hashPassword('Customer@12345'), 'John Doe', 'Acme Small Shop', 'customer');
  insertUser.run('elena@globaltech.com', hashPassword('Customer@12345'), 'Elena Rostova', 'GlobalTech Enterprise', 'customer');
  insertUser.run('marcus@retailcorp.com', hashPassword('Customer@12345'), 'Marcus Green', 'RetailCorp Stores', 'customer');

  // 2. Products & Variants (Highlighting: Odoo brand adds 560 to price)
  const insertProduct = db.prepare(`
    INSERT INTO products (name, type, sales_price, cost_price, notes)
    VALUES (?, ?, ?, ?, ?)
  `);
  const insertVariant = db.prepare(`
    INSERT INTO product_variants (product_id, variant_name, price_modifier)
    VALUES (?, ?, ?)
  `);

  const p1 = insertProduct.run('Brightloop Business Core', 'software', 499.00, 150.00, 'Primary ERP and workflow engine');
  insertVariant.run(p1.lastInsertRowid, 'Standard Brand', 0.0);
  insertVariant.run(p1.lastInsertRowid, 'Odoo Brand Edition', 560.00); // Specified in problem statement (+560)

  const p2 = insertProduct.run('Advanced Analytics & Reporting', 'addon', 199.00, 40.00, 'Real-time KPI and BI reporting module');
  insertVariant.run(p2.lastInsertRowid, 'Standard Cloud', 0.0);
  insertVariant.run(p2.lastInsertRowid, 'Dedicated High-Speed Node', 150.00);

  const p3 = insertProduct.run('Dedicated Customer Success Manager', 'service', 800.00, 400.00, 'Monthly priority 24/7 SLA');
  insertVariant.run(p3.lastInsertRowid, 'Standard SLA', 0.0);

  // 3. Plans
  const insertPlan = db.prepare(`
    INSERT INTO plans (name, cost, billing_frequency, min_quantity, valid_from, valid_to, auto_close_on_end, can_pause, can_renew, can_close_early)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const planMonthly = insertPlan.run('Monthly Growth Plan', 99.00, 'monthly', 1, '2026-01-01', '2027-12-31', 0, 1, 1, 1);
  const planYearly = insertPlan.run('Annual Enterprise Contract', 999.00, 'yearly', 5, '2026-01-01', '2028-12-31', 0, 1, 1, 1);
  const planWeekly = insertPlan.run('Weekly Pilot Trial', 29.00, 'weekly', 1, '2026-01-01', '2026-12-31', 1, 0, 0, 1);

  // 4. Taxes
  const insertTax = db.prepare(`INSERT INTO tax_rules (name, rate_percentage, is_active) VALUES (?, ?, 1)`);
  insertTax.run('Standard VAT / GST (18%)', 18.0);
  insertTax.run('State Sales Tax (8%)', 8.0);
  insertTax.run('Zero Tax (Export / Exempt)', 0.0);

  // 5. Discounts (Admin rules: fixed or percentage, min qty/purchase, date limits, max uses)
  const insertDiscount = db.prepare(`
    INSERT INTO discount_rules (code, name, type, value, min_purchase_amount, min_quantity, start_date, end_date, max_uses, current_uses, applicable_product_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
  `);
  insertDiscount.run('ENTERPRISE20', 'Enterprise Volume Discount 20%', 'percentage', 20.0, 1000.0, 5, '2026-01-01', '2026-12-31', 50, null);
  insertDiscount.run('FLAT100OFF', 'New Customer Welcome Flat $100', 'fixed', 100.0, 300.0, 1, '2026-01-01', '2026-12-31', 100, null);
  insertDiscount.run('COREUPGRADE', 'Core ERP Seat Promo ($50 Off Core)', 'fixed', 50.0, 400.0, 1, '2026-01-01', '2026-12-31', 200, p1.lastInsertRowid);

  // 6. Quotation Template
  const insertTemplate = db.prepare(`
    INSERT INTO quotation_templates (name, plan_id, validity_days, notes)
    VALUES (?, ?, ?, ?)
  `);
  const t1 = insertTemplate.run('Standard Enterprise Software Package', planYearly.lastInsertRowid, 30, 'Pre-configured annual plan with Core & Analytics addon');

  const insertTemplateLine = db.prepare(`
    INSERT INTO quotation_template_lines (template_id, product_id, variant_id, quantity, unit_price)
    VALUES (?, ?, ?, ?, ?)
  `);
  insertTemplateLine.run(t1.lastInsertRowid, p1.lastInsertRowid, 2, 5, 1059.00); // Core with Odoo Brand (499 + 560 = 1059)
  insertTemplateLine.run(t1.lastInsertRowid, p2.lastInsertRowid, 3, 5, 199.00);

  // 7. Seed Sample Subscriptions (demonstrating Draft, Quotation, Confirmed, Active)
  const insertSub = db.prepare(`
    INSERT INTO subscriptions (sub_number, customer_id, plan_id, status, start_date, next_billing_date, expiry_date, payment_terms, total_amount)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertSubLine = db.prepare(`
    INSERT INTO subscription_lines (subscription_id, product_id, variant_id, quantity, unit_price, tax_rule_id, discount_rule_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  // Active Subscription for Elena (GlobalTech)
  const sub1 = insertSub.run('SUB-2026-0001', 5, planYearly.lastInsertRowid, 'Active', '2026-01-01', '2026-11-01', '2027-01-01', 'Net 30', 5840.00);
  insertSubLine.run(sub1.lastInsertRowid, p1.lastInsertRowid, 2, 5, 1059.00, 1, 1); // With Odoo brand + 18% Tax + 20% discount
  insertSubLine.run(sub1.lastInsertRowid, p2.lastInsertRowid, 3, 5, 199.00, 1, null);

  // Active Subscription for John (Acme Small Shop) due today!
  const sub2 = insertSub.run('SUB-2026-0002', 4, planMonthly.lastInsertRowid, 'Active', '2026-09-01', '2026-10-31', '2027-09-01', 'Due on Receipt', 499.00);
  insertSubLine.run(sub2.lastInsertRowid, p1.lastInsertRowid, 1, 1, 499.00, 1, null);

  // Quotation stage subscription for Marcus (RetailCorp)
  const sub3 = insertSub.run('SUB-2026-0003', 6, planMonthly.lastInsertRowid, 'Quotation', '2026-11-01', '2026-11-01', '2027-11-01', 'Net 15', 698.00);
  insertSubLine.run(sub3.lastInsertRowid, p1.lastInsertRowid, 1, 1, 499.00, 1, null);
  insertSubLine.run(sub3.lastInsertRowid, p2.lastInsertRowid, 3, 1, 199.00, 1, null);

  // 8. Seed Sample Invoices (Paid & Overdue examples for Finance Lead)
  const insertInvoice = db.prepare(`
    INSERT INTO invoices (invoice_number, subscription_id, customer_id, billing_period_start, billing_period_end, issue_date, due_date, status, subtotal, tax_total, discount_total, grand_total, amount_paid)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertInvoiceLine = db.prepare(`
    INSERT INTO invoice_lines (invoice_id, product_id, product_name, variant_name, quantity, unit_price, tax_amount, discount_amount, line_total)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Paid Invoice
  const inv1 = insertInvoice.run('INV-2026-0001', sub1.lastInsertRowid, 5, '2026-01-01', '2027-01-01', '2026-01-01', '2026-01-31', 'Paid', 6290.00, 905.76, 1258.00, 5937.76, 5937.76);
  insertInvoiceLine.run(inv1.lastInsertRowid, p1.lastInsertRowid, 'Brightloop Business Core', 'Odoo Brand Edition', 5, 1059.00, 762.48, 1059.00, 5000.48);
  insertInvoiceLine.run(inv1.lastInsertRowid, p2.lastInsertRowid, 'Advanced Analytics & Reporting', 'Standard Cloud', 5, 199.00, 143.28, 199.00, 937.28);

  // Overdue Invoice for Marcus (RetailCorp)
  const inv2 = insertInvoice.run('INV-2026-0002', null, 6, '2026-09-01', '2026-09-30', '2026-09-01', '2026-09-20', 'Confirmed', 698.00, 125.64, 0.0, 823.64, 0.0);
  insertInvoiceLine.run(inv2.lastInsertRowid, p1.lastInsertRowid, 'Brightloop Business Core', 'Standard Brand', 1, 499.00, 89.82, 0.0, 588.82);
  insertInvoiceLine.run(inv2.lastInsertRowid, p2.lastInsertRowid, 'Advanced Analytics & Reporting', 'Standard Cloud', 1, 199.00, 35.82, 0.0, 234.82);

  // 9. Payment for inv1
  const insertPayment = db.prepare(`
    INSERT INTO payments (payment_number, invoice_id, amount, method, payment_date, note, recorded_by_user_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  insertPayment.run('PAY-2026-0001', inv1.lastInsertRowid, 5937.76, 'Bank Transfer', '2026-01-15', 'Full wire transfer settled ref #TX-898231', 3);
}

module.exports = {
  getDb,
  hashPassword,
  validatePasswordPolicy,
  seedDatabase
};
