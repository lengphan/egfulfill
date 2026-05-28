#!/usr/bin/env python3
"""Update all dashboards with the correct role-based status system."""
import re, os
BASE = '/Users/linhphan/Downloads/.claude'

# ─────────────────────────────────────────────────────────────────────────────
# 1. ORDERS.HTML — Seller View (5 statuses)
# ─────────────────────────────────────────────────────────────────────────────
def update_orders():
    path = os.path.join(BASE, 'orders.html')
    with open(path, 'r', encoding='utf-8') as f:
        html = f.read()

    # ── Badge CSS (replace old .bs/.bq/.bp/.bqc block) ──
    OLD_BADGES = '''.bs{background:#dcfce7;color:#15803d}
.bq{background:#dbeafe;color:#1d4ed8}
.bp{background:#ede9fe;color:#7c3aed}
.bqc{background:#fef3c7;color:#b45309}'''
    NEW_BADGES = '''.b-s-new{background:#eff6ff;color:#1d4ed8}
.b-s-review{background:#fffbeb;color:#b45309}
.b-s-action{background:#fef2f2;color:#dc2626;font-weight:700;border:1px solid #fecaca}
.b-s-prod{background:#f5f3ff;color:#6d28d9}
.b-s-ship{background:#f0fdf4;color:#15803d}
.b-carrier-transit{background:#eef2ff;color:#4338ca;font-size:10.5px}
.b-carrier-outdeliv{background:#fdf4ff;color:#9333ea;font-size:10.5px}
.b-carrier-delivered{background:#f0fdf4;color:#16a34a;font-size:10.5px}
.b-carrier-exception{background:#fef2f2;color:#dc2626;font-size:10.5px}'''
    html = html.replace(OLD_BADGES, NEW_BADGES)

    # ── Stat cards: replace In Queue/Printing/QC/Shipped Today ──
    OLD_STATS = '''    <!-- Quick stats -->
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px">
      <div class="card" style="padding:14px 16px;display:flex;align-items:center;gap:12px">
        <div style="width:36px;height:36px;background:#dbeafe;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="#1d4ed8" stroke-width="1.3"/><path d="M8 4.5v4M8 10.5v1" stroke="#1d4ed8" stroke-width="1.3" stroke-linecap="round"/></svg></div>
        <div><div style="font-size:11px;color:#9ca3af;font-weight:500">In Queue</div><div style="font-size:1.3rem;font-weight:700;color:#191918">3</div></div>
      </div>
      <div class="card" style="padding:14px 16px;display:flex;align-items:center;gap:12px">
        <div style="width:36px;height:36px;background:#ede9fe;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="3" width="12" height="10" rx="1.5" stroke="#7c3aed" stroke-width="1.3"/><path d="M5 7h6M5 10h3" stroke="#7c3aed" stroke-width="1.3" stroke-linecap="round"/></svg></div>
        <div><div style="font-size:11px;color:#9ca3af;font-weight:500">Printing</div><div style="font-size:1.3rem;font-weight:700;color:#191918">2</div></div>
      </div>
      <div class="card" style="padding:14px 16px;display:flex;align-items:center;gap:12px">
        <div style="width:36px;height:36px;background:#fef3c7;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8l3.5 3.5L13 4" stroke="#b45309" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
        <div><div style="font-size:11px;color:#9ca3af;font-weight:500">Quality Check</div><div style="font-size:1.3rem;font-weight:700;color:#191918">1</div></div>
      </div>
      <div class="card" style="padding:14px 16px;display:flex;align-items:center;gap:12px">
        <div style="width:36px;height:36px;background:#dcfce7;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 9l1.5-4h9L14 9H2z" stroke="#16a34a" stroke-width="1.3" stroke-linejoin="round"/><circle cx="5" cy="11.5" r="1" stroke="#16a34a" stroke-width="1.3"/><circle cx="11" cy="11.5" r="1" stroke="#16a34a" stroke-width="1.3"/></svg></div>
        <div><div style="font-size:11px;color:#9ca3af;font-weight:500">Shipped Today</div><div style="font-size:1.3rem;font-weight:700;color:#191918">28</div></div>
      </div>
    </div>'''
    NEW_STATS = '''    <!-- Quick stats (Seller view) -->
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px">
      <div class="card" style="padding:14px 16px;display:flex;align-items:center;gap:12px">
        <div style="width:36px;height:36px;background:#eff6ff;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="#1d4ed8" stroke-width="1.3"/><path d="M8 4.5v4M8 10.5v1" stroke="#1d4ed8" stroke-width="1.3" stroke-linecap="round"/></svg></div>
        <div><div style="font-size:11px;color:#9ca3af;font-weight:500">New</div><div style="font-size:1.3rem;font-weight:700;color:#191918">12</div></div>
      </div>
      <div class="card" style="padding:14px 16px;display:flex;align-items:center;gap:12px;border-color:#fecaca;background:#fff8f8">
        <div style="width:36px;height:36px;background:#fef2f2;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 3v4.5M8 10.5v1" stroke="#dc2626" stroke-width="1.5" stroke-linecap="round"/><circle cx="8" cy="8" r="6.5" stroke="#dc2626" stroke-width="1.3"/></svg></div>
        <div><div style="font-size:11px;color:#dc2626;font-weight:700">Action Needed</div><div style="font-size:1.3rem;font-weight:700;color:#dc2626">2</div></div>
      </div>
      <div class="card" style="padding:14px 16px;display:flex;align-items:center;gap:12px">
        <div style="width:36px;height:36px;background:#f5f3ff;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="3" width="12" height="10" rx="1.5" stroke="#6d28d9" stroke-width="1.3"/><path d="M5 7h6M5 10h3" stroke="#6d28d9" stroke-width="1.3" stroke-linecap="round"/></svg></div>
        <div><div style="font-size:11px;color:#9ca3af;font-weight:500">In Production</div><div style="font-size:1.3rem;font-weight:700;color:#191918">18</div></div>
      </div>
      <div class="card" style="padding:14px 16px;display:flex;align-items:center;gap:12px">
        <div style="width:36px;height:36px;background:#f0fdf4;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 9l1.5-4h9L14 9H2z" stroke="#16a34a" stroke-width="1.3" stroke-linejoin="round"/><circle cx="5" cy="11.5" r="1" stroke="#16a34a" stroke-width="1.3"/><circle cx="11" cy="11.5" r="1" stroke="#16a34a" stroke-width="1.3"/></svg></div>
        <div><div style="font-size:11px;color:#9ca3af;font-weight:500">Shipped Today</div><div style="font-size:1.3rem;font-weight:700;color:#191918">28</div></div>
      </div>
    </div>'''
    html = html.replace(OLD_STATS, NEW_STATS)

    # ── Filter tabs ──
    OLD_TABS = '''          <button class="fb" style="background:#111827;color:#fff;border-color:#111827">All</button>
          <button class="fb"><span style="width:7px;height:7px;border-radius:50%;background:#3b82f6;display:inline-block"></span>In Queue (3)</button>
          <button class="fb"><span style="width:7px;height:7px;border-radius:50%;background:#7c3aed;display:inline-block"></span>Printing (2)</button>
          <button class="fb"><span style="width:7px;height:7px;border-radius:50%;background:#f59e0b;display:inline-block"></span>Quality Check (1)</button>
          <button class="fb"><span style="width:7px;height:7px;border-radius:50%;background:#22c55e;display:inline-block"></span>Shipped (841)</button>'''
    NEW_TABS = '''          <button class="fb" style="background:#111827;color:#fff;border-color:#111827">All</button>
          <button class="fb"><span style="width:7px;height:7px;border-radius:50%;background:#1d4ed8;display:inline-block"></span>New (12)</button>
          <button class="fb"><span style="width:7px;height:7px;border-radius:50%;background:#b45309;display:inline-block"></span>In Review (8)</button>
          <button class="fb" style="color:#dc2626;border-color:#fecaca"><span style="width:7px;height:7px;border-radius:50%;background:#dc2626;display:inline-block;animation:pulse 1.5s infinite"></span>Action Needed (2)</button>
          <button class="fb"><span style="width:7px;height:7px;border-radius:50%;background:#6d28d9;display:inline-block"></span>In Production (18)</button>
          <button class="fb"><span style="width:7px;height:7px;border-radius:50%;background:#15803d;display:inline-block"></span>Shipped (807)</button>'''
    html = html.replace(OLD_TABS, NEW_TABS)

    # ── JS: SC config ──
    OLD_SC = """const SC = {
  shipped:{cls:'bs',label:'Shipped',dot:'#16a34a'},
  queue:  {cls:'bq',label:'In Queue',dot:'#1d4ed8'},
  printing:{cls:'bp',label:'Printing',dot:'#7c3aed'},
  qc:     {cls:'bqc',label:'Quality Check',dot:'#b45309'},
};"""
    NEW_SC = """const SC = {
  new:    {cls:'b-s-new',   label:'New',           dot:'#1d4ed8'},
  review: {cls:'b-s-review',label:'In Review',     dot:'#b45309'},
  action: {cls:'b-s-action',label:'Action Needed', dot:'#dc2626'},
  prod:   {cls:'b-s-prod',  label:'In Production', dot:'#6d28d9'},
  shipped:{cls:'b-s-ship',  label:'Shipped',       dot:'#15803d'},
};
const CARRIER_SC = {
  transit:  {cls:'b-carrier-transit',   label:'In Transit'},
  outdeliv: {cls:'b-carrier-outdeliv',  label:'Out for Delivery'},
  delivered:{cls:'b-carrier-delivered', label:'Delivered'},
  exception:{cls:'b-carrier-exception', label:'Exception'},
};"""
    html = html.replace(OLD_SC, NEW_SC)

    # ── JS: pipeline labels (now seller-facing) ──
    OLD_PIP = """const PIP_IDX = {queue:0, printing:1, qc:2, shipped:3};
const PIP_LABELS = ['In Queue','Printing','Quality Check','Shipped'];"""
    NEW_PIP = """const PIP_IDX = {new:0, review:1, action:1, prod:2, shipped:3};
const PIP_LABELS = ['New','In Review / Action Needed','In Production','Shipped'];"""
    html = html.replace(OLD_PIP, NEW_PIP)

    # ── JS: ORDERS data — remap statuses + add 2 action orders ──
    html = html.replace("status:'queue'", "status:'new'")
    html = html.replace("status:'printing'", "status:'prod'")
    html = html.replace("status:'qc'", "status:'review'")
    # Give 2 orders action status with reason + give shipped orders carrier sub-status
    html = html.replace(
        "{no:8, id:'f7d4851c22a9', cust:'Marco Rossi', del:'Standard', status:'prod'",
        "{no:8, id:'f7d4851c22a9', cust:'Marco Rossi', del:'Standard', status:'action', reason:'File rejected — low resolution', action_hint:'Re-upload artwork at 300 DPI minimum'"
    )
    html = html.replace(
        "{no:11, id:'2a071855da3b', cust:'Yui Tanaka', del:'Standard', status:'review'",
        "{no:11, id:'2a071855da3b', cust:'Yui Tanaka', del:'Standard', status:'action', reason:'Address incomplete — missing unit number', action_hint:'Update shipping address to resume'"
    )
    # Add carrier sub-status to shipped orders
    html = html.replace(
        "{no:5, id:'c4a09128bcde', cust:'Sarah Mitchell', del:'Standard', status:'shipped', src:'WooCommerce'",
        "{no:5, id:'c4a09128bcde', cust:'Sarah Mitchell', del:'Standard', status:'shipped', carrier_status:'delivered', src:'WooCommerce'"
    )
    html = html.replace(
        "{no:7, id:'e6c374a100f2', cust:'Priya Nair', del:'Express', status:'shipped', src:'Amazon'",
        "{no:7, id:'e6c374a100f2', cust:'Priya Nair', del:'Express', status:'shipped', carrier_status:'outdeliv', src:'Amazon'"
    )
    html = html.replace(
        "{no:9, id:'08e5960d33b7', cust:'Chloe Bergmann', del:'Standard', status:'shipped', src:'Manual'",
        "{no:9, id:'08e5960d33b7', cust:'Chloe Bergmann', del:'Standard', status:'shipped', carrier_status:'transit', src:'Manual'"
    )
    html = html.replace(
        "{no:12, id:'3b182966eb4c', cust:'Emma Watson', del:'Standard', status:'shipped', src:'Amazon'",
        "{no:12, id:'3b182966eb4c', cust:'Emma Watson', del:'Standard', status:'shipped', carrier_status:'delivered', src:'Amazon'"
    )
    html = html.replace(
        "{no:14, id:'5d2a4b88ed6e', cust:'Lena Fischer', del:'Express', status:'shipped', src:'Shopify'",
        "{no:14, id:'5d2a4b88ed6e', cust:'Lena Fischer', del:'Express', status:'shipped', carrier_status:'exception', src:'Shopify'"
    )

    # ── JS: renderOrders — replace status cell + add action row styling ──
    OLD_RENDER_STATUS = """    /* Main row */
    rows.push(`<tr class="main-row">"""
    NEW_RENDER_STATUS = """    const isAction = o.status === 'action';
    const carrierSc = o.carrier_status ? CARRIER_SC[o.carrier_status] : null;
    const rowBg = isAction ? 'background:#fff7f7' : '';

    /* Main row */
    rows.push(`<tr class="main-row" style="${rowBg}">"""
    html = html.replace(OLD_RENDER_STATUS, NEW_RENDER_STATUS)

    # Replace status cell rendering to include carrier sub-status and action reason
    OLD_STATUS_CELL = """      <td><span class="badge ${sc.cls}"><span style="width:5px;height:5px;border-radius:50%;background:${sc.dot};display:inline-block;flex-shrink:0"></span>${sc.label}</span></td>"""
    NEW_STATUS_CELL = """      <td>
        <div style="display:flex;flex-direction:column;gap:3px">
          <span class="badge ${sc.cls}"><span style="width:5px;height:5px;border-radius:50%;background:${sc.dot};display:inline-block;flex-shrink:0"></span>${sc.label}</span>
          ${carrierSc ? `<span class="badge ${carrierSc.cls}" style="margin-top:2px"><span style="width:5px;height:5px;border-radius:50%;background:currentColor;opacity:.6;display:inline-block;flex-shrink:0"></span>${carrierSc.label}</span>` : ''}
          ${isAction && o.reason ? `<span style="font-size:10.5px;color:#dc2626;margin-top:1px">⚠ ${o.reason}</span>` : ''}
        </div>
      </td>"""
    html = html.replace(OLD_STATUS_CELL, NEW_STATUS_CELL)

    # Replace actions cell to add Resubmit for action orders
    OLD_ACTIONS_CELL = """      <td>
        <a href="order-detail.html?id=${o.id}" style="display:inline-flex;align-items:center;gap:5px;padding:6px 12px;border-radius:7px;font-size:12.5px;font-weight:600;color:#374151;background:#fff;border:1.5px solid #e5e4e0;text-decoration:none;white-space:nowrap;transition:border-color .15s" onmouseover="this.style.borderColor='#9ca3af'" onmouseout="this.style.borderColor='#e5e4e0'">View Details</a>
      </td>"""
    NEW_ACTIONS_CELL = """      <td>
        <div style="display:flex;align-items:center;gap:5px">
          ${isAction ? `<button onclick="openResubmit('${o.id}')" style="display:inline-flex;align-items:center;gap:4px;padding:6px 11px;border-radius:7px;font-size:12.5px;font-weight:600;color:#dc2626;background:#fef2f2;border:1.5px solid #fecaca;cursor:pointer;font-family:inherit;white-space:nowrap">↩ Resubmit</button>` : ''}
          <a href="order-detail.html?id=${o.id}" style="display:inline-flex;align-items:center;gap:5px;padding:6px 12px;border-radius:7px;font-size:12.5px;font-weight:600;color:#374151;background:#fff;border:1.5px solid #e5e4e0;text-decoration:none;white-space:nowrap;transition:border-color .15s" onmouseover="this.style.borderColor='#9ca3af'" onmouseout="this.style.borderColor='#e5e4e0'">View Details</a>
        </div>
      </td>"""
    html = html.replace(OLD_ACTIONS_CELL, NEW_ACTIONS_CELL)

    # Add openResubmit stub after renderOrders calls
    html = html.replace(
        "function toggleExp(no) {",
        """function openResubmit(id) {
  alert('Resubmit flow for order ' + id + '\\n\\nIn production: this opens a guided re-upload / address correction modal.');
}
function toggleExp(no) {"""
    )

    with open(path, 'w', encoding='utf-8') as f:
        f.write(html)
    print('  ✓ orders.html')


# ─────────────────────────────────────────────────────────────────────────────
# 2. OPERATOR.HTML — Operator View (8 statuses)
# ─────────────────────────────────────────────────────────────────────────────
def update_operator():
    path = os.path.join(BASE, 'operator.html')
    with open(path, 'r', encoding='utf-8') as f:
        html = f.read()

    # ── Add operator badge CSS after existing .b-disc ──
    OLD_DISC = '.b-disc{background:#e5e4e0;color:#6b7280}'
    NEW_DISC = '''.b-disc{background:#e5e4e0;color:#6b7280}
/* ── Operator status badges ── */
.b-op-new{background:#eff6ff;color:#1d4ed8}
.b-op-review{background:#fffbeb;color:#b45309}
.b-op-sentback{background:#fff7ed;color:#c2410c;border:1px solid #fed7aa}
.b-op-resub{background:#fdf4ff;color:#7e22ce;font-weight:700;border:1px solid #e9d5ff}
.b-op-hold{background:#f9fafb;color:#6b7280;border:1px solid #e5e4e0}
.b-op-working{background:#ecfdf5;color:#0d9488}
.b-op-fail{background:#fef2f2;color:#b91c1c;border:1px solid #fecaca}
.b-op-cancel{background:#f9fafb;color:#9ca3af;text-decoration:line-through}'''
    html = html.replace(OLD_DISC, NEW_DISC)

    # ── Replace filter tabs (operator orders section) ──
    OLD_TABS = '''      <button class="tab-btn on" id="ord-tab-all" onclick="setOrderFilter('all',this)">All (43)</button>
      <button class="tab-btn" id="ord-tab-mine" style="border:1.5px solid #111827;color:#191918;font-weight:700" onclick="setOrderFilter('mine',this)">⚡ My Queue (6)</button>
      <button class="tab-btn" id="ord-tab-new" onclick="setOrderFilter('new',this)">New (7)</button>
      <button class="tab-btn" id="ord-tab-prod" onclick="setOrderFilter('prod',this)">In Production (11)</button>
      <button class="tab-btn" id="ord-tab-qc" onclick="setOrderFilter('qc',this)">QC (4)</button>
      <button class="tab-btn" id="ord-tab-packed" onclick="setOrderFilter('packed',this)">Packed (3)</button>
      <button class="tab-btn" id="ord-tab-flagged" onclick="setOrderFilter('flagged',this)" style="color:#dc2626">⚑ Flagged (2)</button>'''
    NEW_TABS = '''      <button class="tab-btn on" id="ord-tab-all" onclick="setOrderFilter('all',this)">All (43)</button>
      <button class="tab-btn" id="ord-tab-new" onclick="setOrderFilter('new',this)">New <span style="background:#dbeafe;color:#1d4ed8;font-size:10px;font-weight:700;padding:1px 6px;border-radius:999px;margin-left:3px">7</span></button>
      <button class="tab-btn" id="ord-tab-review" onclick="setOrderFilter('review',this)">In Review <span style="background:#fef3c7;color:#b45309;font-size:10px;font-weight:700;padding:1px 6px;border-radius:999px;margin-left:3px">5</span></button>
      <button class="tab-btn" id="ord-tab-sentback" onclick="setOrderFilter('sentback',this)">Sent Back <span style="background:#fee2e2;color:#b91c1c;font-size:10px;font-weight:700;padding:1px 6px;border-radius:999px;margin-left:3px">3</span></button>
      <button class="tab-btn" style="font-weight:700" id="ord-tab-resub" onclick="setOrderFilter('resub',this)">⚡ Resubmitted <span style="background:#f3e8ff;color:#7e22ce;font-size:10px;font-weight:700;padding:1px 6px;border-radius:999px;margin-left:3px">2</span></button>
      <button class="tab-btn" id="ord-tab-hold" onclick="setOrderFilter('hold',this)">On Hold <span style="background:#f3f4f6;color:#6b7280;font-size:10px;font-weight:700;padding:1px 6px;border-radius:999px;margin-left:3px">1</span></button>
      <button class="tab-btn" id="ord-tab-working" onclick="setOrderFilter('working',this)">Working <span style="background:#d1fae5;color:#065f46;font-size:10px;font-weight:700;padding:1px 6px;border-radius:999px;margin-left:3px">18</span></button>
      <button class="tab-btn" id="ord-tab-fail" onclick="setOrderFilter('fail',this)" style="color:#dc2626">Send Failed <span style="background:#fee2e2;color:#b91c1c;font-size:10px;font-weight:700;padding:1px 6px;border-radius:999px;margin-left:3px">2</span></button>
      <button class="tab-btn" id="ord-tab-cancel" onclick="setOrderFilter('cancel',this)" style="color:#9ca3af">Cancelled <span style="background:#f3f4f6;color:#9ca3af;font-size:10px;font-weight:700;padding:1px 6px;border-radius:999px;margin-left:3px">5</span></button>'''
    html = html.replace(OLD_TABS, NEW_TABS)

    # ── Replace the panel Approve button area with full action set ──
    OLD_PANEL_BTN = '''            <button class="btn btn-green" style="font-size:12px;flex:1;justify-content:center" id="wh-qv-approve-btn" onclick="whQuickApprove()">✓ Approve</button>'''
    NEW_PANEL_BTN = '''            <div style="display:flex;flex-direction:column;gap:6px;width:100%">
              <div style="display:flex;gap:6px">
                <button class="btn btn-green" style="font-size:12px;flex:1;justify-content:center" onclick="opApprove()">✓ Approve</button>
                <button onclick="opHold()" style="font-size:12px;flex:1;padding:7px;border-radius:8px;background:#f9fafb;border:1.5px solid #e5e4e0;color:#6b7280;cursor:pointer;font-family:inherit;font-weight:600;display:flex;align-items:center;justify-content:center;gap:4px">⏸ Hold</button>
              </div>
              <button onclick="opSendBack()" style="font-size:12px;width:100%;padding:7px;border-radius:8px;background:#fff7ed;border:1.5px solid #fed7aa;color:#c2410c;cursor:pointer;font-family:inherit;font-weight:600;display:flex;align-items:center;justify-content:center;gap:4px">↩ Send Back to Seller</button>
              <div id="op-sendback-reason" style="display:none;margin-top:2px">
                <select style="width:100%;border:1.5px solid #fed7aa;border-radius:7px;padding:7px 10px;font-size:12px;font-family:inherit;background:#fff;color:#374151;outline:none">
                  <option>Bad file — low resolution or wrong format</option>
                  <option>Missing info — product details incomplete</option>
                  <option>Address invalid — cannot be verified</option>
                  <option>Wrong SKU / variant mismatch</option>
                  <option>Other — see note</option>
                </select>
                <button onclick="opConfirmSendBack()" class="btn" style="width:100%;margin-top:6px;background:#c2410c;color:#fff;justify-content:center;font-size:12px">Confirm &amp; Notify Seller</button>
              </div>
            </div>'''
    html = html.replace(OLD_PANEL_BTN, NEW_PANEL_BTN)

    # Add operator action stubs
    if 'function opApprove()' not in html:
        html = html.replace(
            'function whQuickApprove()',
            '''function opApprove() { alert('Order approved — routing to warehouse queue.'); }
function opHold() { alert('Order placed On Hold.\\nReason: internal (stock / decision).'); }
function opSendBack() { const r = document.getElementById('op-sendback-reason'); if(r) r.style.display = r.style.display==='none'?'block':'none'; }
function opConfirmSendBack() { alert('Order sent back to seller with reason selected.'); }
function whQuickApprove()'''
        )

    with open(path, 'w', encoding='utf-8') as f:
        f.write(html)
    print('  ✓ operator.html')


# ─────────────────────────────────────────────────────────────────────────────
# 3. WAREHOUSE.HTML — Warehouse View (3 internal + 4 carrier statuses + tracks)
# ─────────────────────────────────────────────────────────────────────────────
def update_warehouse():
    path = os.path.join(BASE, 'warehouse.html')
    with open(path, 'r', encoding='utf-8') as f:
        html = f.read()

    # ── Add warehouse badge CSS ──
    OLD_DISC_WH = '.b-disc{background:#e5e4e0;color:#6b7280}'
    NEW_DISC_WH = '''.b-disc{background:#e5e4e0;color:#6b7280}
/* ── Warehouse status badges ── */
.b-wh-incoming{background:#eff6ff;color:#1d4ed8}
.b-wh-working{background:#ecfdf5;color:#0d9488}
.b-wh-finished{background:#f0fdf4;color:#15803d;font-weight:700}
.b-wh-transit{background:#eef2ff;color:#4338ca}
.b-wh-outdeliv{background:#fdf4ff;color:#9333ea}
.b-wh-delivered{background:#f0fdf4;color:#16a34a}
.b-wh-exception{background:#fef2f2;color:#dc2626;border:1px solid #fecaca}
/* Track progress bar */
.trk-step{display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:600}
.trk-done{background:#f0fdf4;color:#15803d}
.trk-active{background:#eff6ff;color:#1d4ed8}
.trk-pending{background:#f3f4f6;color:#9ca3af}'''
    html = html.replace(OLD_DISC_WH, NEW_DISC_WH)

    # ── Replace filter tabs ──
    OLD_WH_TABS = '''      <button class="tab-btn on" id="wh-tab-all" onclick="whSetFilter('all',this)">All (6)</button>
      <button class="tab-btn" id="wh-tab-new" onclick="whSetFilter('new',this)">New (2)</button>
      <button class="tab-btn" id="wh-tab-review" onclick="whSetFilter('design-review',this)">Design Review (1)</button>
      <button class="tab-btn" id="wh-tab-approved" onclick="whSetFilter('approved',this)">Approved (1)</button>
      <button class="tab-btn" id="wh-tab-printing" onclick="whSetFilter('printing',this)">Printing (1)</button>
      <button class="tab-btn" id="wh-tab-qc" onclick="whSetFilter('qc',this)">QC (1)</button>
      <button class="tab-btn" id="wh-tab-packed" onclick="whSetFilter('packed',this)">Packed (1)</button>
      <button class="tab-btn" id="wh-tab-shipped" onclick="whSetFilter('shipped',this)">Shipped</button>
      <button class="tab-btn" style="color:#dc2626" id="wh-tab-flagged" onclick="whSetFilter('flagged',this)">⚑ Flagged (1)</button>'''
    NEW_WH_TABS = '''      <button class="tab-btn on" id="wh-tab-all" onclick="whSetFilter('all',this)">All (7)</button>
      <button class="tab-btn" id="wh-tab-new" onclick="whSetFilter('new',this)">Incoming <span style="background:#dbeafe;color:#1d4ed8;font-size:10px;font-weight:700;padding:1px 6px;border-radius:999px;margin-left:3px">2</span></button>
      <button class="tab-btn" id="wh-tab-working" onclick="whSetFilter('working',this)">Working <span style="background:#d1fae5;color:#065f46;font-size:10px;font-weight:700;padding:1px 6px;border-radius:999px;margin-left:3px">2</span></button>
      <button class="tab-btn" id="wh-tab-finished" onclick="whSetFilter('finished',this)">Finished <span style="background:#dcfce7;color:#15803d;font-size:10px;font-weight:700;padding:1px 6px;border-radius:999px;margin-left:3px">1</span></button>
      <div style="width:1px;height:20px;background:#e5e4e0;margin:0 2px;align-self:center"></div>
      <button class="tab-btn" id="wh-tab-transit" onclick="whSetFilter('in_transit',this)">In Transit <span style="background:#e0e7ff;color:#4338ca;font-size:10px;font-weight:700;padding:1px 6px;border-radius:999px;margin-left:3px">1</span></button>
      <button class="tab-btn" id="wh-tab-outdeliv" onclick="whSetFilter('out_for_delivery',this)">Out for Delivery</button>
      <button class="tab-btn" id="wh-tab-delivered" onclick="whSetFilter('delivered',this)">Delivered</button>
      <button class="tab-btn" style="color:#dc2626" id="wh-tab-exception" onclick="whSetFilter('exception',this)">Exception <span style="background:#fee2e2;color:#dc2626;font-size:10px;font-weight:700;padding:1px 6px;border-radius:999px;margin-left:3px">1</span></button>'''
    html = html.replace(OLD_WH_TABS, NEW_WH_TABS)

    # ── Update WH_STATUS_BADGE and WH_STATUS_LABEL ──
    OLD_WH_BADGE = """const WH_STATUS_BADGE = {
  'new':'b-new','design-review':'b-queue','approved':'b-ok',
  'queued':'b-prod','printing':'b-prod','qc':'b-qc',
  'packed':'b-packed','shipped':'b-shipped','flagged':'b-flagged'
};
const WH_STATUS_LABEL = {
  'new':'New','design-review':'Design Review','approved':'Approved',
  'queued':'Queued','printing':'Printing','qc':'QC',
  'packed':'Packed','shipped':'Shipped','flagged':'⚑ Flagged'
};"""
    NEW_WH_BADGE = """const WH_STATUS_BADGE = {
  'new':'b-wh-incoming','working':'b-wh-working','finished':'b-wh-finished',
  'in_transit':'b-wh-transit','out_for_delivery':'b-wh-outdeliv',
  'delivered':'b-wh-delivered','exception':'b-wh-exception',
  /* legacy fallbacks */
  'design-review':'b-wh-incoming','approved':'b-wh-working',
  'queued':'b-wh-working','printing':'b-wh-working','qc':'b-wh-working',
  'packed':'b-wh-finished','shipped':'b-wh-transit','flagged':'b-wh-exception'
};
const WH_STATUS_LABEL = {
  'new':'Incoming','working':'Working','finished':'Finished',
  'in_transit':'In Transit','out_for_delivery':'Out for Delivery',
  'delivered':'Delivered','exception':'Exception',
  'design-review':'Incoming','approved':'Working',
  'queued':'Working','printing':'Working','qc':'Working',
  'packed':'Finished','shipped':'In Transit','flagged':'Exception'
};"""
    html = html.replace(OLD_WH_BADGE, NEW_WH_BADGE)

    # ── Update WH_ORDERS data statuses ──
    html = html.replace("status:'design-review'", "status:'new', tracks:{inventory:{in:false,out:false},design:'not_started',label:'not_started',scan:'not_started'}")
    html = html.replace("status:'new',", "status:'new', tracks:{inventory:{in:false,out:false},design:'not_started',label:'not_started',scan:'not_started'},")
    html = html.replace("status:'queued'", "status:'working', tracks:{inventory:{in:true,out:false},design:'sent_to_trello',label:'not_started',scan:'not_started'}")
    html = html.replace("status:'printing'", "status:'working', tracks:{inventory:{in:true,out:false},design:'in_design',label:'not_started',scan:'not_started'}")
    html = html.replace("status:'qc'", "status:'working', tracks:{inventory:{in:true,out:false},design:'design_ready',label:'label_ready',scan:'not_started'}")
    html = html.replace("status:'flagged'", "status:'exception', tracks:{inventory:{in:true,out:false},design:'design_ready',label:'not_started',scan:'not_started'}")

    # ── Add tracks panel into quick view body ──
    OLD_QV_ITEMS_END = """    ${o.note ? `<div style="margin-top:10px;padding:8px 10px;background:#fff5f5;border-radius:7px;border:1px solid #fecaca;font-size:12px;color:#dc2626"><strong>⚑ Note:</strong> ${o.note}</div>` : ''}"""
    NEW_QV_ITEMS_END = """    ${o.status === 'working' && o.tracks ? `
    <div style="margin-top:12px;border-top:1px solid #f3f3f1;padding-top:12px">
      <div style="font-size:10px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Tracks</div>
      <div style="display:flex;flex-direction:column;gap:6px">
        <div style="display:flex;align-items:center;gap:6px">
          <span style="font-size:11px;font-weight:600;color:#6b7280;width:58px;flex-shrink:0">Inventory</span>
          <span class="trk-step ${o.tracks.inventory.in?'trk-done':'trk-pending'}">${o.tracks.inventory.in?'✓ IN':'— IN'}</span>
          <span class="trk-step ${o.tracks.inventory.out?'trk-done':'trk-pending'}">${o.tracks.inventory.out?'✓ OUT':'— OUT'}</span>
          ${!o.tracks.inventory.out?'<span style="font-size:10px;color:#9ca3af">informational</span>':''}
        </div>
        <div style="display:flex;align-items:center;gap:6px">
          <span style="font-size:11px;font-weight:600;color:#6b7280;width:58px;flex-shrink:0">Design</span>
          ${['not_started','sent_to_trello','in_design','design_ready'].map(s=>`<span class="trk-step ${s===o.tracks.design?'trk-active':(['sent_to_trello','in_design','design_ready'].indexOf(s)<['sent_to_trello','in_design','design_ready'].indexOf(o.tracks.design)?'trk-done':'trk-pending')}">${s==='not_started'?'Not Started':s==='sent_to_trello'?'→ Trello':s==='in_design'?'In Design':'✓ Ready'}</span>`).join('')}
        </div>
        <div style="display:flex;align-items:center;gap:6px">
          <span style="font-size:11px;font-weight:600;color:#6b7280;width:58px;flex-shrink:0">Label</span>
          <span class="trk-step ${o.tracks.label==='label_ready'?'trk-done':'trk-pending'}">${o.tracks.label==='label_ready'?'✓ Ready':'Not Started'}</span>
        </div>
        <div style="display:flex;align-items:center;gap:6px">
          <span style="font-size:11px;font-weight:600;color:#6b7280;width:58px;flex-shrink:0">Scan</span>
          <span class="trk-step ${o.tracks.scan==='scanned'?'trk-done':'trk-pending'}">${o.tracks.scan==='scanned'?'✓ Scanned':'Not Started'}</span>
        </div>
        ${(o.tracks.design==='design_ready'&&o.tracks.label==='label_ready'&&o.tracks.scan==='scanned')?
          '<div style="margin-top:6px;padding:7px 10px;background:#f0fdf4;border-radius:7px;border:1px solid #bbf7d0;font-size:12px;color:#15803d;font-weight:600;display:flex;align-items:center;gap:5px">✓ All tracks complete — auto-finishing</div>'
          :'<div style="margin-top:6px;padding:5px 8px;background:#f9f9f8;border-radius:6px;font-size:11px;color:#9ca3af">Finishes automatically when all required tracks complete</div>'}
      </div>
    </div>` : ''}
    ${o.note ? `<div style="margin-top:10px;padding:8px 10px;background:#fff5f5;border-radius:7px;border:1px solid #fecaca;font-size:12px;color:#dc2626"><strong>⚑ Note:</strong> ${o.note}</div>` : ''}"""
    html = html.replace(OLD_QV_ITEMS_END, NEW_QV_ITEMS_END)

    # ── Update approve/push button logic for new statuses ──
    OLD_APP_LOGIC = """  if (o.status === 'design-review') { appBtn.textContent = '✓ Approve'; appBtn.style.display = ''; appBtn.className = 'btn btn-green'; }
  else if (o.status === 'approved') { appBtn.textContent = '→ Push to Queue'; appBtn.style.display = ''; appBtn.className = 'btn btn-dk'; }
  else { appBtn.style.display = 'none'; }"""
    NEW_APP_LOGIC = """  if (o.status === 'new') { appBtn.textContent = '→ Start Working'; appBtn.style.display = ''; appBtn.className = 'btn btn-dk'; }
  else if (o.status === 'working') { appBtn.textContent = '✓ Mark Finished'; appBtn.style.display = ''; appBtn.className = 'btn btn-green'; }
  else { appBtn.style.display = 'none'; }"""
    html = html.replace(OLD_APP_LOGIC, NEW_APP_LOGIC)

    with open(path, 'w', encoding='utf-8') as f:
        f.write(html)
    print('  ✓ warehouse.html')


# ─────────────────────────────────────────────────────────────────────────────
# 4. ADMIN.HTML — Admin View (all 13 + special filters)
# ─────────────────────────────────────────────────────────────────────────────
def update_admin():
    path = os.path.join(BASE, 'admin.html')
    with open(path, 'r', encoding='utf-8') as f:
        html = f.read()

    # ── Add ALL status badges after .b-disc ──
    OLD_DISC_ADM = '.b-disc{background:#e5e4e0;color:#6b7280}'
    NEW_DISC_ADM = '''.b-disc{background:#e5e4e0;color:#6b7280}
/* ── All 13 role statuses + admin-only ── */
.b-s-new{background:#eff6ff;color:#1d4ed8}
.b-op-review{background:#fffbeb;color:#b45309}
.b-op-sentback{background:#fff7ed;color:#c2410c;border:1px solid #fed7aa}
.b-op-resub{background:#fdf4ff;color:#7e22ce;font-weight:700;border:1px solid #e9d5ff}
.b-op-hold{background:#f9fafb;color:#6b7280;border:1px solid #e5e4e0}
.b-wh-working{background:#ecfdf5;color:#0d9488}
.b-wh-finished{background:#f0fdf4;color:#15803d;font-weight:700}
.b-wh-transit{background:#eef2ff;color:#4338ca}
.b-wh-outdeliv{background:#fdf4ff;color:#9333ea}
.b-wh-delivered{background:#f0fdf4;color:#16a34a}
.b-wh-exception{background:#fef2f2;color:#dc2626;border:1px solid #fecaca}
.b-op-fail{background:#fef2f2;color:#b91c1c;border:1px solid #fecaca}
.b-op-cancel{background:#f9fafb;color:#9ca3af}
/* Admin-only filter chips */
.adm-chip{display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;border:1.5px solid transparent;transition:all .15s;font-family:inherit}
.adm-chip:hover{opacity:.85}'''
    html = html.replace(OLD_DISC_ADM, NEW_DISC_ADM)

    # ── Replace filter tabs ──
    OLD_ADM_TABS = '''      <button class="tab-btn on" id="wh-tab-all" onclick="whSetFilter('all',this)">All (6)</button>
      <button class="tab-btn" id="wh-tab-new" onclick="whSetFilter('new',this)">New (2)</button>
      <button class="tab-btn" id="wh-tab-review" onclick="whSetFilter('design-review',this)">Design Review (1)</button>
      <button class="tab-btn" id="wh-tab-approved" onclick="whSetFilter('approved',this)">Approved (1)</button>
      <button class="tab-btn" id="wh-tab-printing" onclick="whSetFilter('printing',this)">Printing (1)</button>
      <button class="tab-btn" id="wh-tab-qc" onclick="whSetFilter('qc',this)">QC (1)</button>
      <button class="tab-btn" id="wh-tab-packed" onclick="whSetFilter('packed',this)">Packed (1)</button>
      <button class="tab-btn" id="wh-tab-shipped" onclick="whSetFilter('shipped',this)">Shipped</button>
      <button class="tab-btn" style="color:#dc2626" id="wh-tab-flagged" onclick="whSetFilter('flagged',this)">⚑ Flagged (1)</button>'''
    NEW_ADM_TABS = '''      <!-- Admin: all 13 statuses -->
      <button class="tab-btn on" onclick="whSetFilter('all',this)">All (87)</button>
      <button class="tab-btn" onclick="whSetFilter('new',this)">New (12)</button>
      <button class="tab-btn" onclick="whSetFilter('review',this)">In Review (8)</button>
      <button class="tab-btn" onclick="whSetFilter('sentback',this)">Sent Back (3)</button>
      <button class="tab-btn" onclick="whSetFilter('resub',this)" style="font-weight:600">⚡ Resubmitted (2)</button>
      <button class="tab-btn" onclick="whSetFilter('hold',this)">On Hold (1)</button>
      <button class="tab-btn" onclick="whSetFilter('working',this)">Working (18)</button>
      <button class="tab-btn" onclick="whSetFilter('finished',this)">Finished (9)</button>
      <button class="tab-btn" onclick="whSetFilter('transit',this)">In Transit (14)</button>
      <button class="tab-btn" onclick="whSetFilter('outdeliv',this)">Out for Delivery (6)</button>
      <button class="tab-btn" onclick="whSetFilter('delivered',this)">Delivered (807)</button>
      <button class="tab-btn" onclick="whSetFilter('exception',this)" style="color:#dc2626">Exception (3)</button>
      <button class="tab-btn" onclick="whSetFilter('fail',this)" style="color:#dc2626">Send Failed (2)</button>
      <button class="tab-btn" onclick="whSetFilter('cancel',this)" style="color:#9ca3af">Cancelled (5)</button>'''
    html = html.replace(OLD_ADM_TABS, NEW_ADM_TABS)

    # ── Add admin-only special filter row after the tabs div ──
    AFTER_TABS_MARKER = NEW_ADM_TABS
    SPECIAL_FILTERS = '''
      <!-- Admin-only special filters -->
      <div style="display:flex;align-items:center;gap:6px;padding:10px 0 2px;border-top:1px solid #f3f3f1;flex-wrap:wrap">
        <span style="font-size:10.5px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.06em;margin-right:4px">Admin only:</span>
        <button class="adm-chip" style="background:#fef2f2;color:#dc2626;border-color:#fecaca">🚨 Escalations (3)</button>
        <button class="adm-chip" style="background:#f8fafc;color:#475569;border-color:#e2e8f0">⬜ Bypassed (7)</button>
        <button class="adm-chip" style="background:#fffbeb;color:#b45309;border-color:#fde68a">💰 Refunds (2)</button>
        <button class="adm-chip" style="background:#fdf4ff;color:#7e22ce;border-color:#e9d5ff">🔁 Reprints (4)</button>
        <button class="adm-chip" style="background:#fff7ed;color:#c2410c;border-color:#fed7aa">⏱ Aging (6)</button>
        <div style="margin-left:auto"><button class="btn btn-out" style="font-size:12px;padding:5px 12px">⬇ Override Status</button></div>
      </div>'''
    html = html.replace(AFTER_TABS_MARKER, AFTER_TABS_MARKER + SPECIAL_FILTERS)

    # ── Update WH_STATUS_BADGE and WH_STATUS_LABEL in admin ──
    OLD_ADM_BADGE = """const WH_STATUS_BADGE = {
  'new':'b-new','design-review':'b-queue','approved':'b-ok',
  'queued':'b-prod','printing':'b-prod','qc':'b-qc',
  'packed':'b-packed','shipped':'b-shipped','flagged':'b-flagged'
};
const WH_STATUS_LABEL = {
  'new':'New','design-review':'Design Review','approved':'Approved',
  'queued':'Queued','printing':'Printing','qc':'QC',
  'packed':'Packed','shipped':'Shipped','flagged':'⚑ Flagged'
};"""
    NEW_ADM_BADGE = """const WH_STATUS_BADGE = {
  'new':'b-s-new','review':'b-op-review','sentback':'b-op-sentback',
  'resub':'b-op-resub','hold':'b-op-hold','working':'b-wh-working',
  'finished':'b-wh-finished','in_transit':'b-wh-transit',
  'out_for_delivery':'b-wh-outdeliv','delivered':'b-wh-delivered',
  'exception':'b-wh-exception','fail':'b-op-fail','cancel':'b-op-cancel',
  /* legacy */
  'design-review':'b-op-review','approved':'b-wh-working',
  'queued':'b-wh-working','printing':'b-wh-working','qc':'b-wh-working',
  'packed':'b-wh-finished','shipped':'b-wh-transit','flagged':'b-wh-exception'
};
const WH_STATUS_LABEL = {
  'new':'New','review':'In Review','sentback':'Sent Back',
  'resub':'Resubmitted','hold':'On Hold','working':'Working',
  'finished':'Finished','in_transit':'In Transit',
  'out_for_delivery':'Out for Delivery','delivered':'Delivered',
  'exception':'Exception','fail':'Send Failed','cancel':'Cancelled',
  'design-review':'In Review','approved':'Working',
  'queued':'Working','printing':'Working','qc':'Working',
  'packed':'Finished','shipped':'In Transit','flagged':'Exception'
};"""
    html = html.replace(OLD_ADM_BADGE, NEW_ADM_BADGE)

    with open(path, 'w', encoding='utf-8') as f:
        f.write(html)
    print('  ✓ admin.html')


print('Updating status systems across all dashboards...')
update_orders()
update_operator()
update_warehouse()
update_admin()
print('Done.')
