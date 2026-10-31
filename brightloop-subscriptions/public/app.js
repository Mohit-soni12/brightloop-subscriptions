// State
let currentUser = { email: 'admin@brightloop.com', role: 'admin', full_name: 'Alex Vance', token: null };
let cacheData = {
  products: [],
  plans: [],
  taxes: [],
  discounts: [],
  subscriptions: [],
  invoices: []
};

// Toast Notifications
function showToast(message, type = 'success') {
  const container = document.getElementById('toastBox');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast-msg ${type}`;
  let tag = '[OK]';
  if (type === 'danger') tag = '[Error]';
  if (type === 'info') tag = '[Notice]';

  toast.innerHTML = `<span style="font-weight: 800; font-size: 0.75rem; letter-spacing: 0.05em;">${tag}</span> <span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// Initialization on DOM Load
document.addEventListener('DOMContentLoaded', async () => {
  setupTabs();
  setupModals();
  setupPersonaBar();
  setupSearchFilters();
  
  await switchUser('admin@brightloop.com');
  await loadMetadata();
  await refreshActiveTab();

  // Form Submissions
  document.getElementById('btnSubmitNewSub')?.addEventListener('click', submitNewSubscription);
  document.getElementById('btnSubmitPayment')?.addEventListener('click', submitPayment);
  document.getElementById('btnSubmitAddStaff')?.addEventListener('click', submitAddStaff);
  document.getElementById('btnSubmitDiscount')?.addEventListener('click', submitDiscount);
});

// Tab Titles
const tabTitles = {
  dashboard: 'Executive Finance & Operations Overview',
  subscriptions: 'Subscription Contracts & Quotations',
  invoices: 'Automated Billing Day Engine & Invoices',
  payments: 'Payments Ledger & Cashflow',
  catalog: 'Products, Variants & Plans',
  'admin-center': 'Administration & System Access Control',
  discounts: 'Admin Engine: Discounts & Taxes',
  portal: 'Customer Self-Service Portal'
};

function setupTabs() {
  const links = document.querySelectorAll('.nav-link');
  links.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      switchTab(link.getAttribute('data-tab'));
    });
  });
}

function switchTab(tabId) {
  document.querySelectorAll('.nav-link').forEach(t => {
    t.classList.toggle('active', t.getAttribute('data-tab') === tabId);
  });
  document.querySelectorAll('.tab-pane').forEach(c => {
    c.style.display = c.id === `tab-${tabId}` ? 'block' : 'none';
  });
  const pageTitle = document.getElementById('pageTitle');
  if (pageTitle && tabTitles[tabId]) {
    pageTitle.textContent = tabTitles[tabId];
  }
  refreshActiveTab();
}

// Simple 3-Mode View Switcher (Admin | Staff | Customer)
function setupPersonaBar() {
  const buttons = document.querySelectorAll('.pill-btn');

  buttons.forEach(btn => {
    btn.addEventListener('click', async () => {
      buttons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const role = btn.getAttribute('data-role');

      let email = 'admin@brightloop.com';
      if (role === 'staff') email = 'staff@brightloop.com';
      if (role === 'customer') email = 'elena@globaltech.com';

      await switchUser(email);
      showToast(`Switched to ${btn.textContent.trim()} Mode`, 'info');
      await refreshActiveTab();
    });
  });
}

// Switch User & Login API
async function switchUser(email) {
  let password = 'Password@12345';
  if (email.startsWith('admin')) password = 'Admin@12345';
  else if (email.startsWith('staff')) password = 'Staff@12345';
  else if (email.startsWith('finance')) password = 'Finance@12345';
  else if (email.startsWith('elena') || email.startsWith('john')) password = 'Customer@12345';

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (res.ok) {
      currentUser = { ...data.user, token: data.token };
      updateRoleUI();
    }
  } catch (err) {
    console.error('Login error:', err);
  }
}

function updateRoleUI() {
  const btnAddStaff = document.getElementById('btnAddStaffModal');
  if (btnAddStaff) {
    // Rule: Only Admin can add staff
    btnAddStaff.style.display = currentUser.role === 'admin' ? 'inline-flex' : 'none';
  }

  // Update sidebar profile card
  const userNameEl = document.getElementById('sidebarUserName');
  const userRoleEl = document.getElementById('sidebarUserRole');
  const userAvatarEl = document.getElementById('sidebarAvatar');

  if (userNameEl) userNameEl.textContent = currentUser.full_name || 'User';
  if (userRoleEl) {
    let roleText = 'Admin Account';
    if (currentUser.role === 'staff') roleText = 'Staff Account';
    if (currentUser.role === 'customer') roleText = 'Customer Portal';
    userRoleEl.textContent = roleText;
  }
  if (userAvatarEl && currentUser.full_name) {
    userAvatarEl.textContent = currentUser.full_name.charAt(0).toUpperCase();
  }

  // Sync active pill button
  document.querySelectorAll('.pill-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-role') === currentUser.role);
  });

  // If customer, switch directly to customer portal
  if (currentUser.role === 'customer') {
    const portalName = document.getElementById('portalCustomerName');
    if (portalName) portalName.textContent = `${currentUser.full_name} (${currentUser.company_name || 'Customer'})`;
    switchTab('portal');
  } else {
    // If Admin or Staff, and currently on portal, switch back to dashboard
    const activeTab = document.querySelector('.nav-link.active')?.getAttribute('data-tab');
    if (activeTab === 'portal') {
      switchTab('dashboard');
    }
  }
}

function getAuthHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${currentUser.token || ''}`
  };
}

async function refreshActiveTab() {
  const activeTab = document.querySelector('.nav-link.active')?.getAttribute('data-tab');
  if (activeTab === 'dashboard') await loadDashboard();
  else if (activeTab === 'subscriptions') await loadSubscriptions();
  else if (activeTab === 'invoices') await loadInvoices();
  else if (activeTab === 'payments') await loadPayments();
  else if (activeTab === 'catalog') await loadCatalog();
  else if (activeTab === 'discounts') await loadDiscountsAndTaxes();
  else if (activeTab === 'portal') await loadCustomerPortal();
}

// Metadata pre-loading for dropdowns
async function loadMetadata() {
  try {
    const [pRes, plRes, tRes, dRes] = await Promise.all([
      fetch('/api/products'),
      fetch('/api/plans'),
      fetch('/api/taxes'),
      fetch('/api/discounts')
    ]);
    cacheData.products = await pRes.json();
    cacheData.plans = await plRes.json();
    cacheData.taxes = await tRes.json();
    cacheData.discounts = await dRes.json();

    populateProductAndPlanSelects();
  } catch (err) {
    console.error('Error loading metadata:', err);
  }
}

function populateProductAndPlanSelects() {
  const planSelect = document.getElementById('subPlanSelect');
  if (planSelect) {
    planSelect.innerHTML = cacheData.plans.map(p => 
      `<option value="${p.id}">${p.name} ($${p.cost} / ${p.billing_frequency})</option>`
    ).join('');
  }

  const custSelect = document.getElementById('subCustomerSelect');
  if (custSelect) {
    custSelect.innerHTML = `
      <option value="4">John Doe (Acme Small Shop)</option>
      <option value="5">Elena Rostova (GlobalTech Enterprise)</option>
      <option value="6">Marcus Green (RetailCorp Stores)</option>
    `;
  }

  populateSubLineRow(document.querySelector('.sub-line-row'));
}

function populateSubLineRow(row) {
  if (!row) return;
  const prodSelect = row.querySelector('.sub-line-product');
  const variantSelect = row.querySelector('.sub-line-variant');
  const taxSelect = row.querySelector('.sub-line-tax');
  const qtyInput = row.querySelector('.sub-line-qty');

  prodSelect.innerHTML = cacheData.products.map(p => `<option value="${p.id}">${p.name} ($${p.sales_price})</option>`).join('');
  taxSelect.innerHTML = cacheData.taxes.map(t => `<option value="${t.id}">${t.name}</option>`).join('');

  function updateVariants() {
    const selProd = cacheData.products.find(p => p.id == prodSelect.value);
    if (selProd && selProd.variants && selProd.variants.length > 0) {
      variantSelect.innerHTML = selProd.variants.map(v => 
        `<option value="${v.id}" data-mod="${v.price_modifier}">${v.variant_name} (+${v.price_modifier > 0 ? '$' + v.price_modifier : '$0'})</option>`
      ).join('');
      variantSelect.disabled = false;
    } else {
      variantSelect.innerHTML = '<option value="" data-mod="0">Standard (No Variant)</option>';
      variantSelect.disabled = true;
    }
    updateLivePriceCalc();
  }

  prodSelect.addEventListener('change', updateVariants);
  variantSelect.addEventListener('change', updateLivePriceCalc);
  qtyInput.addEventListener('input', updateLivePriceCalc);
  taxSelect.addEventListener('change', updateLivePriceCalc);

  updateVariants();
}

// Live Price Calculator in Modal
function updateLivePriceCalc() {
  const row = document.querySelector('.sub-line-row');
  if (!row) return;
  const prodSelect = row.querySelector('.sub-line-product');
  const variantSelect = row.querySelector('.sub-line-variant');
  const qtyInput = row.querySelector('.sub-line-qty');
  const taxSelect = row.querySelector('.sub-line-tax');

  const selProd = cacheData.products.find(p => p.id == prodSelect.value);
  if (!selProd) return;

  const basePrice = selProd.sales_price;
  const selOpt = variantSelect.selectedOptions[0];
  const mod = selOpt ? parseFloat(selOpt.getAttribute('data-mod') || 0) : 0;
  const unitPrice = basePrice + mod;
  const qty = parseInt(qtyInput.value || 1);

  const selTax = cacheData.taxes.find(t => t.id == taxSelect.value);
  const taxRate = selTax ? selTax.rate_percentage : 0;

  const subtotal = unitPrice * qty;
  const taxAmount = (subtotal * taxRate) / 100;
  const total = subtotal + taxAmount;

  document.getElementById('calcBasePrice').textContent = `$${basePrice.toFixed(2)}`;
  document.getElementById('calcVariantModifier').textContent = mod > 0 ? `+$${mod.toFixed(2)}` : '$0.00';
  document.getElementById('calcUnitPrice').textContent = `$${unitPrice.toFixed(2)} (x${qty})`;
  document.getElementById('calcEstTax').textContent = `+$${taxAmount.toFixed(2)} (${taxRate}%)`;
  document.getElementById('calcTotalAmount').textContent = `$${total.toFixed(2)}`;
}

// Real-Time Search Filters
function setupSearchFilters() {
  const searchSubs = document.getElementById('searchSubsInput');
  if (searchSubs) {
    searchSubs.addEventListener('input', (e) => {
      renderSubscriptionsTable(e.target.value);
    });
  }

  const searchInvs = document.getElementById('searchInvoicesInput');
  if (searchInvs) {
    searchInvs.addEventListener('input', (e) => {
      renderInvoicesTable(e.target.value);
    });
  }

  const filterStatus = document.getElementById('filterSubStatus');
  if (filterStatus) {
    filterStatus.addEventListener('change', () => {
      renderSubscriptionsTable(searchSubs ? searchSubs.value : '');
    });
  }
}

// -------------------------------------------------------------
// TAB 1: DASHBOARD
// -------------------------------------------------------------
async function loadDashboard() {
  const res = await fetch('/api/analytics/dashboard', { headers: getAuthHeaders() });
  const data = await res.json();

  document.getElementById('kpiActiveSubs').textContent = data.active_subscriptions_count;
  document.getElementById('kpiCollected').textContent = `$${data.total_revenue_collected.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
  document.getElementById('kpiOutstanding').textContent = `$${data.total_outstanding_owed.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
  document.getElementById('kpiOverdue').textContent = `$${data.overdue_invoices_amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
  document.getElementById('kpiOverdueCount').textContent = `${data.overdue_invoices_count} overdue invoices`;

  if (data.performance_sla) {
    document.getElementById('slaText').textContent = `Query Latency: ${data.performance_sla.execution_time_ms} (SLA < 2s Passed)`;
  }

  // Render Overdue Chase List
  const tbody = document.querySelector('#tableOverdueList tbody');
  if (!data.overdue_chase_list || data.overdue_chase_list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color: var(--text-muted); padding: 2rem;">🎉 No overdue invoices! All payments are current.</td></tr>';
  } else {
    tbody.innerHTML = data.overdue_chase_list.map(inv => `
      <tr>
        <td><strong>${inv.invoice_number}</strong></td>
        <td>
          <span style="font-weight: 700;">${inv.company_name || inv.customer_name}</span><br>
          <small style="color:var(--text-muted);">${inv.customer_email}</small>
        </td>
        <td>${inv.due_date}</td>
        <td><span class="badge badge-overdue">${inv.days_overdue} days overdue</span></td>
        <td>$${inv.grand_total.toFixed(2)}</td>
        <td style="color: var(--danger); font-weight: 800; font-size: 1rem;">$${inv.balance_due.toFixed(2)}</td>
        <td>
          <button class="btn btn-primary btn-sm" onclick="openRecordPaymentFor('${inv.id}', ${inv.balance_due})">
            Record Settlement
          </button>
        </td>
      </tr>
    `).join('');
  }
}

// -------------------------------------------------------------
// TAB 2: SUBSCRIPTIONS
// -------------------------------------------------------------
async function loadSubscriptions() {
  const res = await fetch('/api/subscriptions', { headers: getAuthHeaders() });
  cacheData.subscriptions = await res.json();
  renderSubscriptionsTable();
}

function renderSubscriptionsTable(searchTerm = '') {
  const statusFilter = document.getElementById('filterSubStatus')?.value || 'ALL';
  let list = cacheData.subscriptions;

  if (statusFilter !== 'ALL') {
    list = list.filter(s => s.status === statusFilter);
  }

  if (searchTerm) {
    const q = searchTerm.toLowerCase();
    list = list.filter(s => 
      s.sub_number.toLowerCase().includes(q) || 
      (s.company_name && s.company_name.toLowerCase().includes(q)) ||
      (s.customer_name && s.customer_name.toLowerCase().includes(q))
    );
  }

  const tbody = document.querySelector('#tableSubscriptions tbody');
  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; color: var(--text-muted); padding: 2.5rem;">No matching subscriptions found.</td></tr>';
    return;
  }

  tbody.innerHTML = list.map(s => `
    <tr>
      <td><strong>${s.sub_number}</strong></td>
      <td>
        <span style="font-weight: 700;">${s.company_name || s.customer_name}</span><br>
        <small style="color:var(--text-muted);">${s.customer_email}</small>
      </td>
      <td>${s.plan_name}</td>
      <td><span class="badge badge-draft">${s.billing_frequency.toUpperCase()}</span></td>
      <td>${s.start_date}</td>
      <td><strong style="color: #4338ca;">${s.next_billing_date}</strong></td>
      <td><span class="badge badge-${s.status.toLowerCase()}">${s.status}</span></td>
      <td style="font-weight: 800;">$${s.total_amount.toFixed(2)}</td>
      <td>
        <div style="display: flex; gap: 0.35rem; flex-wrap: wrap;">
          ${s.status === 'Draft' ? `<button class="btn btn-outline btn-sm" onclick="transitionSub(${s.id}, 'Quotation')">Send Quote</button>` : ''}
          ${s.status === 'Quotation' ? `<button class="btn btn-outline btn-sm" onclick="transitionSub(${s.id}, 'Confirmed')">Confirm</button>` : ''}
          ${s.status === 'Confirmed' ? `<button class="btn btn-success btn-sm" onclick="transitionSub(${s.id}, 'Active')">Activate Contract</button>` : ''}
          ${s.status === 'Active' && s.can_pause ? `<button class="btn btn-outline btn-sm" onclick="transitionSub(${s.id}, 'Paused')">Pause</button>` : ''}
          ${s.status === 'Paused' ? `<button class="btn btn-success btn-sm" onclick="transitionSub(${s.id}, 'Active')">Resume</button>` : ''}
          ${s.status === 'Active' && s.can_close_early ? `<button class="btn btn-danger btn-sm" onclick="transitionSub(${s.id}, 'Closed')">Close</button>` : ''}
        </div>
      </td>
    </tr>
  `).join('');
}

async function transitionSub(id, newStatus) {
  try {
    const res = await fetch(`/api/subscriptions/${id}/transition`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ new_status: newStatus })
    });
    const data = await res.json();
    if (res.ok) {
      showToast(`Subscription status moved to ${newStatus}`, 'success');
      await loadSubscriptions();
      await loadDashboard();
    } else {
      showToast(`Policy restriction: ${data.error}`, 'danger');
    }
  } catch (err) {
    showToast('Failed to update subscription status.', 'danger');
  }
}

// -------------------------------------------------------------
// TAB 3: INVOICES & BILLING DAY
// -------------------------------------------------------------
async function loadInvoices() {
  const res = await fetch('/api/invoices', { headers: getAuthHeaders() });
  cacheData.invoices = await res.json();
  renderInvoicesTable();
}

function renderInvoicesTable(searchTerm = '') {
  let list = cacheData.invoices;
  if (searchTerm) {
    const q = searchTerm.toLowerCase();
    list = list.filter(inv => 
      inv.invoice_number.toLowerCase().includes(q) ||
      (inv.company_name && inv.company_name.toLowerCase().includes(q)) ||
      (inv.customer_name && inv.customer_name.toLowerCase().includes(q))
    );
  }

  const tbody = document.querySelector('#tableInvoices tbody');
  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="11" style="text-align:center; color: var(--text-muted); padding: 2.5rem;">No invoices generated yet. Click "Execute Billing Day" above!</td></tr>';
    return;
  }

  tbody.innerHTML = list.map(inv => `
    <tr>
      <td><strong>${inv.invoice_number}</strong></td>
      <td>${inv.sub_number || 'Direct Contract'}</td>
      <td>
        <span style="font-weight: 700;">${inv.company_name || inv.customer_name}</span>
      </td>
      <td><small>${inv.billing_period_start} &rarr; ${inv.billing_period_end}</small></td>
      <td>${inv.due_date}</td>
      <td>$${inv.subtotal.toFixed(2)}</td>
      <td style="color: var(--text-muted);">+$${inv.tax_total.toFixed(2)}</td>
      <td style="color: var(--success);">-${inv.discount_total > 0 ? '$' + inv.discount_total.toFixed(2) : '$0.00'}</td>
      <td style="font-weight: 800; font-size: 0.95rem;">$${inv.grand_total.toFixed(2)}</td>
      <td>
        <span class="badge badge-${inv.status.toLowerCase()}">${inv.status}</span>
        ${inv.is_overdue ? '<span class="badge badge-overdue">OVERDUE</span>' : ''}
      </td>
      <td>
        <div style="display: flex; gap: 0.35rem; flex-wrap: wrap;">
          <button class="btn btn-outline btn-sm" onclick="viewPrintableInvoice(${inv.id})">Preview Invoice</button>
          ${inv.status === 'Draft' ? `<button class="btn btn-primary btn-sm" onclick="confirmInvoice(${inv.id})">Confirm</button>` : ''}
          ${inv.status !== 'Paid' && inv.status !== 'Cancelled' ? `<button class="btn btn-success btn-sm" onclick="openRecordPaymentFor(${inv.id}, ${inv.grand_total - inv.amount_paid})">Settle</button>` : ''}
          ${inv.status === 'Draft' ? `<button class="btn btn-danger btn-sm" onclick="cancelInvoice(${inv.id})">Cancel</button>` : ''}
        </div>
      </td>
    </tr>
  `).join('');
}

async function handleBillingDay() {
  const btn = document.getElementById('btnTriggerBillingDay');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span>Executing billing cycle...</span>';
  }

  try {
    const res = await fetch('/api/billing/run', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ target_date: new Date().toISOString().split('T')[0] })
    });
    const data = await res.json();

    const banner = document.getElementById('billingDayBanner');
    if (banner) {
      banner.style.display = 'block';
      banner.innerHTML = `
        <strong>Billing Day Cycle Completed Successfully</strong><br>
        • <strong>${data.processed}</strong> new recurring invoice(s) generated with auto-calculated taxes &amp; discounts.<br>
        • Idempotency Safety: <strong>${data.skippedAlreadyBilled}</strong> subscriptions already billed for this cycle were skipped (zero double-billing guarantee).
      `;
    }

    showToast(`Billing Day Complete: ${data.processed} invoice(s) generated`, 'success');
    await loadInvoices();
    await loadDashboard();
  } catch (err) {
    showToast('Billing day execution failed.', 'danger');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<span>Execute Billing Day Run</span>';
    }
  }
}

function triggerBillingDayQuick() {
  switchTab('invoices');
  handleBillingDay();
}

async function confirmInvoice(id) {
  await fetch(`/api/invoices/${id}/confirm`, { method: 'POST', headers: getAuthHeaders() });
  showToast('Invoice confirmed and issued.', 'success');
  await loadInvoices();
}

async function cancelInvoice(id) {
  if (!confirm('Are you sure you want to cancel this invoice?')) return;
  await fetch(`/api/invoices/${id}/cancel`, { method: 'POST', headers: getAuthHeaders() });
  showToast('Invoice cancelled.', 'info');
  await loadInvoices();
}

// -------------------------------------------------------------
// PRINTABLE INVOICE VIEW
// -------------------------------------------------------------
async function viewPrintableInvoice(id) {
  const res = await fetch(`/api/invoices/${id}`, { headers: getAuthHeaders() });
  const data = await res.json();
  const inv = data.invoice;

  const html = `
    <div style="padding: 1.5rem; font-family: sans-serif; color: #1e293b;">
      <div style="display: flex; justify-content: space-between; border-bottom: 2px solid #6366f1; padding-bottom: 1.25rem; margin-bottom: 1.5rem;">
        <div>
          <h1 style="color: #4f46e5; margin: 0; font-size: 1.75rem; font-weight: 800;">Brightloop Software</h1>
          <p style="margin: 0.2rem 0; font-size: 0.85rem; color: #64748b;">Enterprise Subscription &amp; Cloud Platform</p>
          <p style="margin: 0; font-size: 0.85rem; color: #64748b;">billing@brightloop.com | +1 (800) 555-LOOP</p>
        </div>
        <div style="text-align: right;">
          <h2 style="margin: 0; font-size: 1.3rem; letter-spacing: 0.05em; color: #0f172a;">TAX INVOICE</h2>
          <p style="margin: 0.2rem 0; font-weight: 700; color: #4f46e5; font-size: 1rem;">${inv.invoice_number}</p>
          <p style="margin: 0; font-size: 0.85rem; color: #64748b;">Status: <strong>${inv.status.toUpperCase()}</strong></p>
        </div>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 2rem; margin-bottom: 1.5rem;">
        <div>
          <h4 style="margin: 0 0 0.4rem 0; font-size: 0.75rem; text-transform: uppercase; color: #64748b; letter-spacing: 0.05em;">Customer Details:</h4>
          <p style="margin: 0; font-weight: 700; font-size: 1rem; color: #0f172a;">${inv.company_name || inv.customer_name}</p>
          <p style="margin: 0.1rem 0; font-size: 0.85rem;">Attn: ${inv.customer_name}</p>
          <p style="margin: 0; font-size: 0.85rem; color: #64748b;">${inv.customer_email}</p>
        </div>
        <div style="text-align: right;">
          <p style="margin: 0.2rem 0; font-size: 0.85rem;"><strong>Issue Date:</strong> ${inv.issue_date}</p>
          <p style="margin: 0.2rem 0; font-size: 0.85rem;"><strong>Due Date:</strong> ${inv.due_date}</p>
          <p style="margin: 0.2rem 0; font-size: 0.85rem;"><strong>Billing Cycle:</strong> ${inv.billing_period_start} &rarr; ${inv.billing_period_end}</p>
          <p style="margin: 0.2rem 0; font-size: 0.85rem;"><strong>Subscription Ref:</strong> ${inv.sub_number || 'Direct'}</p>
        </div>
      </div>

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 1.5rem;">
        <thead>
          <tr style="background: #f8fafc; border-bottom: 2px solid #e2e8f0;">
            <th style="padding: 0.65rem; text-align: left; font-size: 0.8rem;">Item Description</th>
            <th style="padding: 0.65rem; text-align: right; font-size: 0.8rem;">Qty</th>
            <th style="padding: 0.65rem; text-align: right; font-size: 0.8rem;">Unit Price</th>
            <th style="padding: 0.65rem; text-align: right; font-size: 0.8rem;">Tax</th>
            <th style="padding: 0.65rem; text-align: right; font-size: 0.8rem;">Discount</th>
            <th style="padding: 0.65rem; text-align: right; font-size: 0.8rem;">Line Total</th>
          </tr>
        </thead>
        <tbody>
          ${data.lines.map(l => `
            <tr style="border-bottom: 1px solid #e2e8f0;">
              <td style="padding: 0.75rem 0.65rem; font-size: 0.85rem;">
                <strong>${l.product_name}</strong>
                ${l.variant_name ? `<br><small style="color: #6366f1; font-weight: 700;">Variant: ${l.variant_name}</small>` : ''}
              </td>
              <td style="padding: 0.75rem 0.65rem; text-align: right; font-size: 0.85rem;">${l.quantity}</td>
              <td style="padding: 0.75rem 0.65rem; text-align: right; font-size: 0.85rem;">$${l.unit_price.toFixed(2)}</td>
              <td style="padding: 0.75rem 0.65rem; text-align: right; font-size: 0.85rem;">+$${l.tax_amount.toFixed(2)}</td>
              <td style="padding: 0.75rem 0.65rem; text-align: right; font-size: 0.85rem; color: #10b981;">-${l.discount_amount > 0 ? '$' + l.discount_amount.toFixed(2) : '$0.00'}</td>
              <td style="padding: 0.75rem 0.65rem; text-align: right; font-size: 0.85rem; font-weight: 700;">$${l.line_total.toFixed(2)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <div style="display: flex; justify-content: flex-end; margin-bottom: 1.5rem;">
        <div style="width: 280px; background: #f8fafc; padding: 1.25rem; border-radius: 8px;">
          <div style="display: flex; justify-content: space-between; padding: 0.25rem 0; font-size: 0.85rem;">
            <span>Subtotal:</span>
            <span>$${inv.subtotal.toFixed(2)}</span>
          </div>
          <div style="display: flex; justify-content: space-between; padding: 0.25rem 0; font-size: 0.85rem; color: #10b981;">
            <span>Discount Applied:</span>
            <span>-$${inv.discount_total.toFixed(2)}</span>
          </div>
          <div style="display: flex; justify-content: space-between; padding: 0.25rem 0; font-size: 0.85rem;">
            <span>Tax Total:</span>
            <span>+$${inv.tax_total.toFixed(2)}</span>
          </div>
          <div style="display: flex; justify-content: space-between; padding: 0.5rem 0; border-top: 2px solid #0f172a; font-size: 1.15rem; font-weight: 800; color: #0f172a;">
            <span>Grand Total:</span>
            <span>$${inv.grand_total.toFixed(2)}</span>
          </div>
          <div style="display: flex; justify-content: space-between; padding: 0.25rem 0; font-size: 0.85rem; color: #64748b;">
            <span>Amount Paid:</span>
            <span>$${inv.amount_paid.toFixed(2)}</span>
          </div>
          <div style="display: flex; justify-content: space-between; padding: 0.4rem 0; font-size: 1rem; font-weight: 800; color: ${inv.grand_total - inv.amount_paid > 0 ? '#ef4444' : '#10b981'};">
            <span>Balance Due:</span>
            <span>$${(inv.grand_total - inv.amount_paid).toFixed(2)}</span>
          </div>
        </div>
      </div>

      <div style="background: #f1f5f9; padding: 1rem; border-radius: 6px; font-size: 0.8rem; color: #475569;">
        <strong>Bank Wire Instructions:</strong><br>
        Brightloop Software Inc. • Account: 089-394-118 • Routing: 121000358<br>
        Please reference invoice number <strong>${inv.invoice_number}</strong> on all payments.
      </div>
    </div>
  `;

  document.getElementById('printableInvoiceArea').innerHTML = html;
  document.getElementById('modalInvoiceView').classList.add('open');
}

// -------------------------------------------------------------
// TAB 4: PAYMENTS
// -------------------------------------------------------------
async function loadPayments() {
  const res = await fetch('/api/invoices', { headers: getAuthHeaders() });
  const invoices = await res.json();
  const tbody = document.querySelector('#tablePayments tbody');

  const payPromises = invoices.map(inv => fetch(`/api/invoices/${inv.id}`, { headers: getAuthHeaders() }).then(r => r.json()));
  const allDetails = await Promise.all(payPromises);

  const payments = [];
  allDetails.forEach(d => {
    if (d.payments && d.payments.length > 0) {
      d.payments.forEach(p => {
        payments.push({
          ...p,
          invoice_number: d.invoice.invoice_number,
          customer_name: d.invoice.company_name || d.invoice.customer_name
        });
      });
    }
  });

  if (payments.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color: var(--text-muted); padding: 2.5rem;">No payments registered yet.</td></tr>';
    return;
  }

  tbody.innerHTML = payments.map(p => `
    <tr>
      <td><strong>${p.payment_number}</strong></td>
      <td>${p.invoice_number}</td>
      <td>${p.customer_name}</td>
      <td><span class="badge badge-draft">${p.method}</span></td>
      <td>${p.payment_date}</td>
      <td style="color: var(--success); font-weight: 800; font-size: 0.95rem;">+$${p.amount.toFixed(2)}</td>
      <td><small>${p.note || 'None'}</small></td>
    </tr>
  `).join('');
}

function openRecordPaymentFor(invoiceId, balanceDue = 0) {
  const select = document.getElementById('paymentInvoiceSelect');
  select.innerHTML = `<option value="${invoiceId}">Invoice #${invoiceId} (Balance Due: $${balanceDue.toFixed(2)})</option>`;
  document.getElementById('paymentAmountInput').value = balanceDue > 0 ? balanceDue : '';
  document.getElementById('paymentDateInput').value = new Date().toISOString().split('T')[0];
  document.getElementById('modalPayment').classList.add('open');
}

async function openRecordPaymentModal() {
  const res = await fetch('/api/invoices', { headers: getAuthHeaders() });
  const invs = await res.json();
  const unpaid = invs.filter(i => i.status !== 'Paid' && i.status !== 'Cancelled');
  const select = document.getElementById('paymentInvoiceSelect');
  select.innerHTML = unpaid.map(i => `<option value="${i.id}">${i.invoice_number} - ${i.company_name || i.customer_name} (Due: $${(i.grand_total - i.amount_paid).toFixed(2)})</option>`).join('');
  if (unpaid[0]) {
    document.getElementById('paymentAmountInput').value = (unpaid[0].grand_total - unpaid[0].amount_paid).toFixed(2);
  }
  document.getElementById('paymentDateInput').value = new Date().toISOString().split('T')[0];
  document.getElementById('modalPayment').classList.add('open');
}

async function submitPayment(e) {
  e.preventDefault();
  const invoice_id = document.getElementById('paymentInvoiceSelect').value;
  const amount = document.getElementById('paymentAmountInput').value;
  const method = document.getElementById('paymentMethodSelect').value;
  const payment_date = document.getElementById('paymentDateInput').value;
  const note = document.getElementById('paymentNoteInput').value;

  try {
    const res = await fetch('/api/payments', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ invoice_id, amount, method, payment_date, note })
    });
    const data = await res.json();
    if (res.ok) {
      showToast(`Payment ${data.payment_number} registered successfully!`, 'success');
      document.getElementById('modalPayment').classList.remove('open');
      await refreshActiveTab();
      await loadDashboard();
    } else {
      showToast(`Error: ${data.error}`, 'danger');
    }
  } catch (err) {
    showToast('Failed to record payment.', 'danger');
  }
}

// -------------------------------------------------------------
// TAB 5: PRODUCTS & PLANS
// -------------------------------------------------------------
async function loadCatalog() {
  const [pRes, plRes] = await Promise.all([
    fetch('/api/products', { headers: getAuthHeaders() }),
    fetch('/api/plans', { headers: getAuthHeaders() })
  ]);
  const products = await pRes.json();
  const plans = await plRes.json();

  document.querySelector('#tableProducts tbody').innerHTML = products.map(p => `
    <tr>
      <td><strong>${p.name}</strong><br><small style="color:var(--text-muted);">${p.notes || ''}</small></td>
      <td><span class="badge badge-draft">${p.type}</span></td>
      <td style="font-weight: 700;">$${p.sales_price.toFixed(2)}</td>
      <td>
        ${p.variants && p.variants.length > 0 ? p.variants.map(v => 
          `<span style="display:inline-block; background:#eef2ff; color:#4338ca; border:1px solid #c7d2fe; padding:0.2rem 0.5rem; border-radius:6px; font-size:0.75rem; margin-right:0.35rem; font-weight:700;">
            ${v.variant_name} (+${v.price_modifier > 0 ? '$' + v.price_modifier : '$0'})
           </span>`
        ).join('') : '<span style="color:var(--text-muted); font-size:0.75rem;">None</span>'}
      </td>
    </tr>
  `).join('');

  document.querySelector('#tablePlans tbody').innerHTML = plans.map(p => `
    <tr>
      <td><strong>${p.name}</strong></td>
      <td><span class="badge badge-confirmed">${p.billing_frequency.toUpperCase()}</span></td>
      <td style="font-weight: 700;">$${p.cost.toFixed(2)}</td>
      <td>
        <small style="color:var(--text-muted);">
          ${p.can_pause ? '✓ Pause ' : ''}
          ${p.can_renew ? '✓ Renew ' : ''}
          ${p.auto_close_on_end ? '• Auto-close on end' : ''}
        </small>
      </td>
    </tr>
  `).join('');
}

// -------------------------------------------------------------
// TAB 6: DISCOUNTS & TAXES
// -------------------------------------------------------------
async function loadDiscountsAndTaxes() {
  const [dRes, tRes] = await Promise.all([
    fetch('/api/discounts', { headers: getAuthHeaders() }),
    fetch('/api/taxes', { headers: getAuthHeaders() })
  ]);
  const discounts = await dRes.json();
  const taxes = await tRes.json();

  document.querySelector('#tableDiscounts tbody').innerHTML = discounts.map(d => `
    <tr>
      <td><strong>${d.code}</strong><br><small>${d.name}</small></td>
      <td style="font-weight: 800; color: #4f46e5;">${d.type === 'percentage' ? d.value + '%' : '$' + d.value}</td>
      <td>Min Qty: ${d.min_quantity || 0} / $${d.min_purchase_amount || 0}</td>
      <td>${d.current_uses} / ${d.max_uses > 0 ? d.max_uses : '∞'} used</td>
      <td><small>${d.start_date || 'Any'} &rarr; ${d.end_date || 'Any'}</small></td>
    </tr>
  `).join('');

  document.querySelector('#tableTaxes tbody').innerHTML = taxes.map(t => `
    <tr>
      <td><strong>${t.name}</strong></td>
      <td><span class="badge badge-active">${t.rate_percentage}%</span></td>
    </tr>
  `).join('');
}

// -------------------------------------------------------------
// TAB 7: CUSTOMER PORTAL
// -------------------------------------------------------------
async function loadCustomerPortal() {
  const [sRes, iRes] = await Promise.all([
    fetch('/api/subscriptions', { headers: getAuthHeaders() }),
    fetch('/api/invoices', { headers: getAuthHeaders() })
  ]);
  const mySubs = await sRes.json();
  const myInvoices = await iRes.json();

  document.querySelector('#tablePortalSubs tbody').innerHTML = mySubs.length === 0 ? 
    '<tr><td colspan="6" style="text-align:center; color: var(--text-muted); padding: 2.5rem;">No subscriptions active for your account.</td></tr>' :
    mySubs.map(s => `
      <tr>
        <td><strong>${s.sub_number}</strong></td>
        <td>${s.plan_name} ($${s.total_amount.toFixed(2)})</td>
        <td>${s.start_date}</td>
        <td><strong>${s.next_billing_date}</strong></td>
        <td><span class="badge badge-${s.status.toLowerCase()}">${s.status}</span></td>
        <td>
          ${s.status === 'Active' && s.can_pause ? `<button class="btn btn-outline btn-sm" onclick="transitionSub(${s.id}, 'Paused')">Request Pause</button>` : ''}
          ${s.status === 'Paused' ? `<button class="btn btn-success btn-sm" onclick="transitionSub(${s.id}, 'Active')">Resume Service</button>` : ''}
        </td>
      </tr>
    `).join('');

  document.querySelector('#tablePortalInvoices tbody').innerHTML = myInvoices.length === 0 ?
    '<tr><td colspan="5" style="text-align:center; color: var(--text-muted); padding: 2.5rem;">No billing invoices found.</td></tr>' :
    myInvoices.map(inv => `
      <tr>
        <td><strong>${inv.invoice_number}</strong></td>
        <td>${inv.billing_period_start} &rarr; ${inv.billing_period_end}</td>
        <td style="font-weight: 800;">$${inv.grand_total.toFixed(2)}</td>
        <td><span class="badge badge-${inv.status.toLowerCase()}">${inv.status}</span></td>
        <td>
          <button class="btn btn-outline btn-sm" onclick="viewPrintableInvoice(${inv.id})">Download PDF</button>
          ${inv.status !== 'Paid' && inv.status !== 'Cancelled' ? `<button class="btn btn-primary btn-sm" onclick="openRecordPaymentFor(${inv.id}, ${inv.grand_total - inv.amount_paid})">Pay Online</button>` : ''}
        </td>
      </tr>
    `).join('');
}

// -------------------------------------------------------------
// MODALS
// -------------------------------------------------------------
function setupModals() {
  document.querySelectorAll('.closeModal').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.modal-backdrop').forEach(m => m.classList.remove('open'));
    });
  });

  document.getElementById('btnAddStaffModal')?.addEventListener('click', () => {
    document.getElementById('modalAddStaff').classList.add('open');
  });
}

function openNewSubModal() {
  document.getElementById('modalNewSub').classList.add('open');
  updateLivePriceCalc();
}

async function submitNewSubscription(e) {
  e.preventDefault();
  const customer_id = document.getElementById('subCustomerSelect').value;
  const plan_id = document.getElementById('subPlanSelect').value;
  const status = document.getElementById('subInitialStatus').value;
  const payment_terms = document.getElementById('subPaymentTerms').value;

  const row = document.querySelector('.sub-line-row');
  const product_id = row.querySelector('.sub-line-product').value;
  const variant_id = row.querySelector('.sub-line-variant').value || null;
  const quantity = parseInt(row.querySelector('.sub-line-qty').value || 1);
  const tax_rule_id = row.querySelector('.sub-line-tax').value || null;

  try {
    const res = await fetch('/api/subscriptions', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        customer_id,
        plan_id,
        status,
        payment_terms,
        lines: [{ product_id, variant_id, quantity, tax_rule_id }]
      })
    });
    const data = await res.json();
    if (res.ok) {
      showToast(`Subscription ${data.sub_number} created!`, 'success');
      document.getElementById('modalNewSub').classList.remove('open');
      await loadSubscriptions();
      await loadDashboard();
    } else {
      showToast(`Error: ${data.error}`, 'danger');
    }
  } catch (err) {
    showToast('Failed to create subscription.', 'danger');
  }
}

async function submitAddStaff(e) {
  e.preventDefault();
  const full_name = document.getElementById('staffNameInput').value;
  const email = document.getElementById('staffEmailInput').value;
  const password = document.getElementById('staffPasswordInput').value;
  const role = document.getElementById('staffRoleSelect').value;

  try {
    const res = await fetch('/api/auth/add-staff', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ full_name, email, password, role })
    });
    const data = await res.json();
    if (res.ok) {
      showToast(data.message, 'success');
      document.getElementById('modalAddStaff').classList.remove('open');
    } else {
      showToast(`Policy: ${data.error}`, 'danger');
    }
  } catch (err) {
    showToast('Error creating staff account.', 'danger');
  }
}

async function submitDiscount(e) {
  e.preventDefault();
  const code = document.getElementById('discCode').value;
  const name = document.getElementById('discName').value;
  const type = document.getElementById('discType').value;
  const value = document.getElementById('discVal').value;
  const min_quantity = document.getElementById('discMinQty').value;
  const max_uses = document.getElementById('discMaxUses').value;

  try {
    const res = await fetch('/api/discounts', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ code, name, type, value, min_quantity, max_uses })
    });
    const data = await res.json();
    if (res.ok) {
      showToast('Discount rule created successfully!', 'success');
      document.getElementById('modalDiscount').classList.remove('open');
      await loadDiscountsAndTaxes();
    } else {
      showToast(`Error: ${data.error}`, 'danger');
    }
  } catch (err) {
    showToast('Failed to save discount rule.', 'danger');
  }
}
